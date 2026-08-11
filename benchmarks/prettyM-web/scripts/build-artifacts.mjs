import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  artifactFiles,
  artifactSetConfig,
  checkoutSources,
  componentOrder,
  readBuildDatabase,
  selectBuild,
} from "./artifact-build-lib.mjs";
import {
  canonicalJson,
  fileRecord,
  fileRecords,
  inside,
  sha256,
  validateSeed,
} from "./artifact-set-lib.mjs";
import {
  checkoutReceipt,
  parsePathAssignment,
  readToolchainConfig,
  resolveBuildCheckoutPaths,
} from "./toolchain-config-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildEnvironment = {
  ...process.env,
  NPM_CONFIG_CACHE:
    process.env.NPM_CONFIG_CACHE ?? join(appRoot, "_artifacts/npm-cache"),
};
const virCompiler = {
  runtimeBuild: ["npm", ["run", "build:demo:release"]],
  packageBuild: ["lake", ["exe", "vir_irpkg"]],
  runtimeBundler: "node_modules/.bin/esbuild",
  runtimeSource: "web/src/vir-runtime.js",
  releaseWasm: "web/public/vir-upstream.wasm",
  debugWasm: "web/public/vir-upstream.dev.wasm",
};

function usage() {
  console.log(`Usage: node scripts/build-artifacts.mjs [options] BUILD

Build every component of a catalogued artifact from exact local Git checkouts,
validate the producer packages, and atomically assemble _artifacts/seed.

  --database PATH       build database (default: artifact-builds.json)
  --checkout NAME=PATH override one catalog checkout; repeat as needed
  --toolchain [NAME=]PATH
                        select FIR by default, or a named FIR/VIR toolchain
  --toolchain-config PATH
                        read toolchains and checkout paths from JSON
  --sources-dir PATH    fallback checkout root (default: _sources)
  --prepare             run catalogued producer setup before building
  --plan                verify checkouts and print the plan without building
  --list                list catalogued builds
  -h, --help            show this help`);
}

function parseArgs(argv) {
  const options = {
    database: "artifact-builds.json",
    checkouts: new Map(),
    toolchains: new Map(),
    toolchainConfig: null,
    sourcesDir: "_sources",
    prepare: false,
    plan: false,
    list: false,
    buildId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") options.database = argv[++index];
    else if (argument === "--checkout") {
      const { name, path } = parsePathAssignment(argv[++index], {
        label: "--checkout",
      });
      if (options.checkouts.has(name))
        throw new Error(`duplicate checkout: ${name}`);
      options.checkouts.set(name, path);
    } else if (argument === "--toolchain") {
      const { name, path } = parsePathAssignment(argv[++index], {
        defaultName: "fir",
        label: "--toolchain",
      });
      if (options.toolchains.has(name))
        throw new Error(`duplicate toolchain: ${name}`);
      options.toolchains.set(name, path);
    } else if (argument === "--toolchain-config") {
      options.toolchainConfig = argv[++index];
    } else if (argument === "--sources-dir") {
      options.sourcesDir = argv[++index];
    } else if (argument === "--prepare") options.prepare = true;
    else if (argument === "--plan") options.plan = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else if (argument.startsWith("-"))
      throw new Error(`unknown argument: ${argument}`);
    else if (options.buildId)
      throw new Error("only one build ID may be selected");
    else options.buildId = argument;
  }
  return options;
}

function run(
  command,
  args,
  { cwd, env = buildEnvironment, capture = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? 1}${detail}`,
    );
  }
  return capture ? result.stdout.trim() : "";
}

function normalizedRepository(repository) {
  const trimmed = repository.replace(/\/+$/, "").replace(/\.git$/, "");
  const githubScp = /^git@github\.com:(.+)$/.exec(trimmed);
  if (githubScp) return `https://github.com/${githubScp[1]}`;
  const githubSsh = /^ssh:\/\/git@github\.com\/(.+)$/.exec(trimmed);
  if (githubSsh) return `https://github.com/${githubSsh[1]}`;
  return trimmed;
}

async function verifyCheckout(checkoutId, path, selectedSource) {
  if (!(await stat(path).catch(() => null))?.isDirectory()) {
    throw new Error(`checkout ${checkoutId} is not a directory: ${path}`);
  }
  const root = resolve(
    run("git", ["-C", path, "rev-parse", "--show-toplevel"], { capture: true }),
  );
  if (root !== path)
    throw new Error(
      `checkout ${checkoutId} must point at its Git root: ${root}`,
    );
  const origin = run("git", ["-C", path, "remote", "get-url", "origin"], {
    capture: true,
  });
  if (
    normalizedRepository(origin) !==
    normalizedRepository(selectedSource.repository)
  ) {
    throw new Error(
      `checkout ${checkoutId} origin mismatch: ` +
        `expected ${selectedSource.repository}, got ${origin}`,
    );
  }
  const revision = run("git", ["-C", path, "rev-parse", "HEAD"], {
    capture: true,
  });
  if (revision !== selectedSource.revision) {
    throw new Error(
      `checkout ${checkoutId} revision mismatch: expected ${selectedSource.revision}, got ${revision}`,
    );
  }
  const dirty = run("git", ["-C", path, "status", "--porcelain"], {
    capture: true,
  });
  if (dirty !== "") throw new Error(`checkout ${checkoutId} is dirty: ${path}`);
  return {
    path,
    revision,
    sourceId: selectedSource.id,
    repository: selectedSource.repository,
  };
}

function checkoutFor(component, role, resolvedCheckouts) {
  const checkoutId = component.producer.checkouts[role];
  const checkout = resolvedCheckouts[checkoutId];
  if (!checkout)
    throw new Error(`producer checkout role ${role} is not resolved`);
  return checkout.path;
}

async function resetOutput(output) {
  await rm(output, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
}

async function buildVir(component, output, resolvedCheckouts) {
  const vir = checkoutFor(component, "producer", resolvedCheckouts);
  const workload = checkoutFor(component, "workload", resolvedCheckouts);
  await resetOutput(output);
  await mkdir(join(output, "lean-vir/js"), { recursive: true });
  await mkdir(join(output, "lean-vir/wasm"), { recursive: true });

  run(virCompiler.runtimeBuild[0], virCompiler.runtimeBuild[1], { cwd: vir });
  const releaseWasm = join(vir, virCompiler.releaseWasm);
  const debugWasm = join(vir, virCompiler.debugWasm);
  const [releaseRecord, debugRecord] = await Promise.all([
    fileRecord(releaseWasm),
    fileRecord(debugWasm),
  ]);
  if (releaseRecord.sha256 === debugRecord.sha256) {
    throw new Error("VIR release and debug Wasm are byte-identical");
  }

  const workloadConfig = component.artifact.workload;
  const workloadSource = resolve(workload, workloadConfig.source.file);
  const packagePath = join(output, workloadConfig.file);
  const reportName = workloadConfig.file.endsWith(".irpkg")
    ? `${workloadConfig.file.slice(0, -".irpkg".length)}.report.md`
    : `${workloadConfig.file}.report.md`;
  const reportPath = join(output, reportName);
  run(
    virCompiler.packageBuild[0],
    [
      ...virCompiler.packageBuild[1],
      packagePath,
      reportPath,
      "--target",
      workloadSource,
      ...workloadConfig.exports,
    ],
    { cwd: vir },
  );
  const esbuild = join(vir, virCompiler.runtimeBundler);
  if (!(await stat(esbuild).catch(() => null))?.isFile()) {
    throw new Error(`VIR esbuild is missing; rerun with --prepare: ${esbuild}`);
  }
  run(
    esbuild,
    [
      join(vir, virCompiler.runtimeSource),
      "--bundle",
      "--format=esm",
      "--platform=browser",
      "--target=es2020",
      "--minify",
      `--outfile=${join(output, "lean-vir/js/vir-runtime.js")}`,
    ],
    { cwd: vir },
  );
  await cp(releaseWasm, join(output, "lean-vir/wasm/vir-upstream.wasm"));
}

async function buildFirNative(component, output, resolvedCheckouts) {
  const fir = checkoutFor(component, "producer", resolvedCheckouts);
  await resetOutput(output);
  run("bash", [component.producer.entrypoint, output], { cwd: fir });
}

async function buildFirLlvm(component, output, resolvedCheckouts, packages) {
  const fir = checkoutFor(component, "producer", resolvedCheckouts);
  await resetOutput(output);
  run("bash", [component.producer.entrypoint, output], {
    cwd: fir,
    env: {
      ...buildEnvironment,
      FIR_PRETTY_M_NATIVE_PACKAGE: packages[component.dependencies?.[0]],
    },
  });
}

async function validateFiles(componentId, component, output) {
  const physicalOutput = await realpath(output);
  for (const packagePath of Object.keys(component.producer.files)) {
    const target = resolve(output, packagePath);
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `${componentId} producer omitted regular file ${packagePath}`,
      );
    }
    const physicalTarget = await realpath(target);
    const local = relative(physicalOutput, physicalTarget);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error(
        `${componentId} producer file escapes its package: ${packagePath}`,
      );
    }
  }
}

async function validateVir(component, output, resolvedCheckouts) {
  const vir = checkoutFor(component, "producer", resolvedCheckouts);
  const workload = checkoutFor(component, "workload", resolvedCheckouts);
  const packagePath = join(output, component.artifact.workload.file);
  const body = run(
    process.execPath,
    ["scripts/inspect-irpkg.mjs", "--json", packagePath],
    { cwd: vir, capture: true },
  );
  const inspected = JSON.parse(body);
  const metadata = inspected.manifest?.metadata;
  if (
    inspected.package?.version !== component.artifact.workload.packageFormat ||
    inspected.manifest?.version !==
      component.artifact.workload.manifestVersion ||
    metadata?.leanVersion !== component.artifact.lean.version ||
    metadata?.leanGithash !== component.artifact.lean.commit
  ) {
    throw new Error("VIR package metadata does not match the build database");
  }
  const exports = new Set(
    (inspected.manifest?.exports ?? []).map((entry) => entry.entry),
  );
  for (const name of component.artifact.workload.exports) {
    if (!exports.has(name))
      throw new Error(`VIR package is missing export ${name}`);
  }
  const expectedSource = resolve(
    workload,
    component.artifact.workload.source.file,
  );
  const target = (metadata?.targets ?? []).find(
    (candidate) => candidate.source === expectedSource,
  );
  if (
    !target ||
    JSON.stringify(target.roots) !==
      JSON.stringify(component.artifact.workload.exports)
  ) {
    throw new Error("VIR package target does not match the workload checkout");
  }
}

async function validateNative(component, output, resolvedCheckouts) {
  const build = JSON.parse(
    await readFile(join(output, component.producer.manifest), "utf8"),
  );
  const sourceId = component.producer.checkouts.producer;
  if (
    build.sourceCommit !== resolvedCheckouts[sourceId].revision ||
    build.sourceDirty !== false ||
    build.capabilities?.inputLayout?.leanVersion !==
      component.artifact.lean.version
  ) {
    throw new Error(
      "native FIR package metadata does not match the build database",
    );
  }
  const artifact = await fileRecord(join(output, build.artifact?.file ?? ""));
  if (
    artifact.bytes !== build.artifact?.bytes ||
    artifact.sha256 !== build.artifact?.sha256
  ) {
    throw new Error("native FIR package artifact does not match BUILD.json");
  }
  run("sha256sum", ["-c", "--quiet", "SHA256SUMS"], { cwd: output });
}

async function validateLlvm(component, output) {
  const manifest = JSON.parse(
    await readFile(join(output, component.producer.manifest), "utf8"),
  );
  if (
    manifest.toolchain?.lean?.version !== component.artifact.lean.version ||
    manifest.toolchain?.lean?.commit !== component.artifact.lean.commit
  ) {
    throw new Error("LLVM package metadata does not match the build database");
  }
  run("sha256sum", ["-c", "--quiet", "SHA256SUMS"], { cwd: output });
}

async function validatePackage(
  componentId,
  component,
  output,
  resolvedCheckouts,
) {
  await validateFiles(componentId, component, output);
  if (component.producer.adapter === "vir") {
    await validateVir(component, output, resolvedCheckouts);
  } else if (component.producer.adapter === "fir-native") {
    await validateNative(component, output, resolvedCheckouts);
  } else if (component.producer.adapter === "fir-llvm") {
    await validateLlvm(component, output);
  }
}

async function replaceSeed(next, seed) {
  const previous = `${seed}.previous`;
  await rm(previous, { recursive: true, force: true });
  const existing = await stat(seed).catch(() => null);
  if (existing) await rename(seed, previous);
  try {
    await rename(next, seed);
  } catch (error) {
    if (existing) await rename(previous, seed);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databasePath = inside(
    appRoot,
    options.database,
    "read artifact build database",
  );
  const databaseBytes = await readFile(databasePath);
  const database = await readBuildDatabase(databasePath);
  if (options.list) {
    for (const [buildId, build] of Object.entries(database.builds)) {
      console.log(`${buildId}\t${build.artifactSet.setId}`);
    }
    return;
  }
  if (!options.buildId) throw new Error("select a build ID or pass --list");

  const build = selectBuild(database, options.buildId);
  const examplePath = inside(
    appRoot,
    `examples/${build.example.id}/example.json`,
    "read example manifest",
  );
  const exampleBytes = await readFile(examplePath);
  const sources = checkoutSources(database, options.buildId);
  const sourcesDir = inside(
    appRoot,
    options.sourcesDir,
    "read artifact sources",
  );
  const toolchainConfig = await readToolchainConfig(
    appRoot,
    options.toolchainConfig,
  );
  const checkoutSelection = resolveBuildCheckoutPaths(build, sources, {
    sourcesDir,
    checkouts: options.checkouts,
    toolchains: options.toolchains,
    config: toolchainConfig,
  });
  const toolchainRoles = checkoutSelection.toolchainRoles;
  const resolvedCheckouts = {};
  for (const [checkoutId, selectedSource] of Object.entries(sources)) {
    resolvedCheckouts[checkoutId] = await verifyCheckout(
      checkoutId,
      checkoutSelection.paths.get(checkoutId),
      selectedSource,
    );
  }

  const order = componentOrder(build);
  console.log(`build: ${options.buildId}`);
  console.log(`artifact set: ${build.artifactSet.setId}`);
  if (toolchainConfig.path) {
    console.log(`toolchain config: ${toolchainConfig.path}`);
  }
  for (const [name, checkoutId] of toolchainRoles) {
    console.log(`toolchain ${name}: ${resolvedCheckouts[checkoutId].path}`);
  }
  for (const [checkoutId, checkout] of Object.entries(resolvedCheckouts)) {
    console.log(
      `checkout ${checkoutId}: ${checkout.path} @ ${checkout.revision}`,
    );
  }
  console.log(`components: ${order.join(" -> ")}`);
  if (options.plan) return;

  const buildRoot = inside(
    appRoot,
    `_artifacts/builds/${options.buildId}`,
    "build artifacts",
  );
  const packages = {};
  for (const componentId of order) {
    const component = build.components[componentId];
    if (options.prepare) {
      if (component.producer.adapter === "vir") {
        const path = checkoutFor(component, "producer", resolvedCheckouts);
        run("npm", ["install"], { cwd: path });
        run("npm", ["run", "setup"], { cwd: path });
      } else {
        for (const setup of component.producer.setup ?? []) {
          const path = checkoutFor(
            component,
            setup.checkout,
            resolvedCheckouts,
          );
          run(setup.command, setup.args, { cwd: path });
        }
      }
    }
    const output = join(buildRoot, "packages", componentId);
    console.log(`building ${componentId} with ${component.producer.adapter}`);
    if (component.producer.adapter === "vir") {
      await buildVir(component, output, resolvedCheckouts);
    } else if (component.producer.adapter === "fir-native") {
      await buildFirNative(component, output, resolvedCheckouts);
    } else if (component.producer.adapter === "fir-llvm") {
      await buildFirLlvm(component, output, resolvedCheckouts, packages);
    }
    await validatePackage(componentId, component, output, resolvedCheckouts);
    packages[componentId] = output;
  }

  for (const [checkoutId, selectedSource] of Object.entries(sources)) {
    await verifyCheckout(
      checkoutId,
      resolvedCheckouts[checkoutId].path,
      selectedSource,
    );
  }

  const nextSeed = join(buildRoot, "seed.next");
  await rm(nextSeed, { recursive: true, force: true });
  await mkdir(nextSeed, { recursive: true });
  for (const componentId of order) {
    const component = build.components[componentId];
    for (const [packagePath, destination] of Object.entries(
      component.producer.files,
    )) {
      const target = join(nextSeed, destination);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(packages[componentId], packagePath), target);
    }
  }
  await validateSeed(nextSeed, artifactSetConfig(database, options.buildId));
  const records = await fileRecords(nextSeed, artifactFiles(build));
  const seed = inside(appRoot, "_artifacts/seed", "replace artifact seed");
  await replaceSeed(nextSeed, seed);

  const receipt = {
    schemaVersion: 2,
    kind: "browser-benchmarks/source-build-receipt",
    build: options.buildId,
    artifactSet: build.artifactSet.setId,
    database: {
      file: relative(appRoot, databasePath),
      sha256: sha256(databaseBytes),
    },
    example: {
      id: build.example.id,
      file: relative(appRoot, examplePath),
      sha256: sha256(exampleBytes),
    },
    checkoutResolution: {
      configUsed: toolchainConfig.path !== null,
      checkoutOverrides: [...options.checkouts.keys()].sort(),
      toolchainOverrides: [...options.toolchains.keys()].sort(),
    },
    toolchains: Object.fromEntries(
      [...toolchainRoles].map(([name, checkoutId]) => [
        name,
        {
          checkout: checkoutId,
          ...checkoutReceipt(resolvedCheckouts[checkoutId]),
        },
      ]),
    ),
    sources: Object.fromEntries(
      Object.entries(resolvedCheckouts).map(([checkoutId, checkout]) => [
        checkoutId,
        checkoutReceipt(checkout),
      ]),
    ),
    components: Object.fromEntries(
      order.map((componentId) => [
        componentId,
        {
          adapter: build.components[componentId].producer.adapter,
          files: Object.fromEntries(
            Object.entries(build.components[componentId].producer.files).map(
              ([, destination]) => [destination, records[destination]],
            ),
          ),
        },
      ]),
    ),
  };
  await writeFile(join(buildRoot, "BUILD.json"), canonicalJson(receipt));
  console.log(`assembled validated seed: ${relative(appRoot, seed)}`);
  console.log(
    `build receipt: ${relative(appRoot, join(buildRoot, "BUILD.json"))}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
