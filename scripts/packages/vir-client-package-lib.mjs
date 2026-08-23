import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { runSync } from "../process-utils.mjs";

export function parseProducerArguments(
  argv,
  { checkoutRoles, packageRoles = [], defaultProducer, usage },
) {
  const expectedCheckouts = new Set(checkoutRoles);
  const expectedPackages = new Set(packageRoles);
  const options = { output: null, checkouts: new Map(), packages: new Map() };
  const take = (index, option) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${option} requires a value`);
    }
    return value;
  };
  const assignment = (value, option) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`${option} requires NAME=PATH`);
    }
    return {
      name: value.slice(0, separator),
      path: value.slice(separator + 1),
    };
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      if (options.output !== null) throw new Error("duplicate --output");
      options.output = take(index++, argument);
    } else if (argument === "--checkout") {
      const { name, path } = assignment(take(index++, argument), argument);
      if (!expectedCheckouts.has(name)) {
        throw new Error(`unknown checkout role: ${name}`);
      }
      if (options.checkouts.has(name)) {
        throw new Error(`duplicate checkout role: ${name}`);
      }
      options.checkouts.set(name, path);
    } else if (argument === "--package") {
      const { name, path } = assignment(take(index++, argument), argument);
      if (!expectedPackages.has(name)) {
        throw new Error(`unknown dependency package: ${name}`);
      }
      if (options.packages.has(name)) {
        throw new Error(`duplicate dependency package: ${name}`);
      }
      options.packages.set(name, path);
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage);
      return null;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (options.output === null) throw new Error("pass --output PATH");
  if (defaultProducer !== undefined && !options.checkouts.has("producer")) {
    options.checkouts.set("producer", defaultProducer);
  }
  for (const role of expectedCheckouts) {
    if (!options.checkouts.has(role)) {
      throw new Error(`missing checkout role: ${role}`);
    }
  }
  for (const role of expectedPackages) {
    if (!options.packages.has(role)) {
      throw new Error(`missing dependency package: ${role}`);
    }
  }
  return options;
}

function git(root, args) {
  return runSync("git", ["-C", root, ...args], { capture: true });
}

export function gitIdentity(root, label) {
  if (git(root, ["status", "--porcelain"]) !== "") {
    throw new Error(`${label} checkout must be clean`);
  }
  return { commit: git(root, ["rev-parse", "HEAD"]), dirty: false };
}

export async function readMatchingWorkloadPackage(
  path,
  { kind, source, label },
) {
  const root = await realpath(resolve(path));
  const build = JSON.parse(await readFile(join(root, "BUILD.json"), "utf8"));
  if (
    build.schemaVersion !== 1 ||
    build.kind !== kind ||
    build.source?.commit !== source.commit ||
    build.source?.dirty !== false
  ) {
    throw new Error(
      `workload package does not match the exact clean ${label} checkout`,
    );
  }
  return { root, build };
}

export async function checkoutRoot(path, role) {
  const root = await realpath(resolve(path));
  if (git(root, ["rev-parse", "--show-toplevel"]) !== root) {
    throw new Error(`${role} must be a Git checkout root: ${root}`);
  }
  return root;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fileRecord(root, path) {
  const bytes = await readFile(join(root, path));
  return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

export async function requireFreshOutput(path) {
  const output = resolve(path);
  if ((await lstat(output).catch(() => null)) !== null) {
    throw new Error(`output directory already exists: ${output}`);
  }
  return output;
}

export async function writeChecksums(output, paths) {
  const checksums = await Promise.all(
    paths.map(
      async (path) => `${sha256(await readFile(join(output, path)))}  ${path}`,
    ),
  );
  await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  runSync("sha256sum", ["--check", "SHA256SUMS"], { cwd: output });
}

export async function buildVirBrowserRuntime({
  producer,
  runtime,
  output,
  environment = {},
}) {
  const wasiSdk = await realpath(
    resolve(
      environment.WASI_SDK_PATH ??
        process.env.WASI_SDK_PATH ??
        join(producer, ".tools/wasi-sdk"),
    ),
  );
  if (!(await stat(join(wasiSdk, "bin/clang++")).catch(() => null))?.isFile()) {
    throw new Error(`VIR WASI SDK is not installed: ${wasiSdk}`);
  }
  const esbuild = resolve(
    environment.VIR_ESBUILD ??
      process.env.VIR_ESBUILD ??
      join(producer, "node_modules/.bin/esbuild"),
  );
  if (!(await stat(esbuild).catch(() => null))?.isFile()) {
    throw new Error(`VIR esbuild is not installed: ${esbuild}`);
  }
  const packageLock = JSON.parse(
    await readFile(join(producer, "package-lock.json"), "utf8"),
  );
  const expectedEsbuild = packageLock.packages?.["node_modules/esbuild"]?.version;
  const actualEsbuild = runSync(esbuild, ["--version"], { capture: true });
  if (typeof expectedEsbuild !== "string" || actualEsbuild !== expectedEsbuild) {
    throw new Error(
      `VIR esbuild version mismatch: expected ${expectedEsbuild}, got ${actualEsbuild}`,
    );
  }

  await mkdir(join(output, "lean-vir/js"), { recursive: true });
  await mkdir(join(output, "lean-vir/wasm"), { recursive: true });
  runSync("npm", ["run", "build:demo:release"], {
    cwd: producer,
    env: {
      ...process.env,
      LEAN4_SRC: runtime,
      VIR_SKIP_PACKAGES: "1",
      ...environment,
      WASI_SDK_PATH: wasiSdk,
    },
  });
  runSync("lake", ["build", "vir_irpkg"], { cwd: producer });
  runSync(
    esbuild,
    [
      join(producer, "web/src/vir-runtime.js"),
      "--bundle",
      "--format=esm",
      "--platform=browser",
      "--target=es2020",
      "--minify",
      `--outfile=${join(output, "lean-vir/js/vir-runtime.js")}`,
    ],
    { cwd: producer },
  );
  await copyFile(
    join(producer, "web/public/vir-upstream.wasm"),
    join(output, "lean-vir/wasm/vir-upstream.wasm"),
  );
  return { wasiSdk: basename(wasiSdk) };
}

export async function readToolchain(root) {
  return (await readFile(join(root, "lean-toolchain"), "utf8")).trim();
}

export async function requireToolchain(root, label, expected) {
  const actual = await readToolchain(root);
  if (actual !== expected) {
    throw new Error(`${label} must use ${expected}, got ${actual}`);
  }
  return actual;
}
