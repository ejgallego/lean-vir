#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const defaultProducer = resolve(scriptRoot, "..");
const expectedRoles = new Set(["producer", "runtime", "client"]);

function usage() {
  console.log(`Usage: scripts/export-lean-zip-browser-package.mjs [options]

Build a client-native VIR runtime and lean-zip package into a fresh directory.

  --output PATH                 fresh caller-owned output directory
  --checkout producer=PATH      exact VIR checkout
  --checkout runtime=PATH       exact Lean source checkout
  --checkout client=PATH        exact lean-zip checkout
  --package workload=PATH       lean-zip source/oracle package`);
}

function parseArgs(argv) {
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
    return { name: value.slice(0, separator), path: value.slice(separator + 1) };
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      if (options.output !== null) throw new Error("duplicate --output");
      options.output = take(index++, argument);
    } else if (argument === "--checkout") {
      const { name, path } = assignment(take(index++, argument), argument);
      if (!expectedRoles.has(name)) throw new Error(`unknown checkout role: ${name}`);
      if (options.checkouts.has(name)) throw new Error(`duplicate checkout role: ${name}`);
      options.checkouts.set(name, path);
    } else if (argument === "--package") {
      const { name, path } = assignment(take(index++, argument), argument);
      if (name !== "workload") throw new Error(`unknown dependency package: ${name}`);
      if (options.packages.has(name)) throw new Error(`duplicate dependency package: ${name}`);
      options.packages.set(name, path);
    } else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (options.output === null) throw new Error("pass --output PATH");
  options.checkouts.set("producer", options.checkouts.get("producer") ?? defaultProducer);
  for (const role of expectedRoles) {
    if (!options.checkouts.has(role)) throw new Error(`missing checkout role: ${role}`);
  }
  if (!options.packages.has("workload")) {
    throw new Error("missing dependency package: workload");
  }
  return options;
}

function run(command, args, { cwd, env = process.env, capture = false } = {}) {
  const value = execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
  return typeof value === "string" ? value.trim() : "";
}

function git(root, args) {
  return run("git", ["-C", root, ...args], { capture: true });
}

function gitIdentity(root, label) {
  const status = git(root, ["status", "--porcelain"]);
  if (status !== "") throw new Error(`${label} checkout must be clean`);
  return { commit: git(root, ["rev-parse", "HEAD"]), dirty: false };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileRecord(root, path) {
  const bytes = await readFile(join(root, path));
  return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

async function checkoutRoot(path, role) {
  const root = await realpath(resolve(path));
  if (git(root, ["rev-parse", "--show-toplevel"]) !== root) {
    throw new Error(`${role} must be a Git checkout root: ${root}`);
  }
  return root;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = resolve(options.output);
  if ((await lstat(output).catch(() => null)) !== null) {
    throw new Error(`output directory already exists: ${output}`);
  }
  const producer = await checkoutRoot(options.checkouts.get("producer"), "producer");
  const runtime = await checkoutRoot(options.checkouts.get("runtime"), "runtime");
  const client = await checkoutRoot(options.checkouts.get("client"), "client");
  const sourceIdentities = {
    vir: gitIdentity(producer, "VIR"),
    lean: gitIdentity(runtime, "Lean"),
    leanZip: gitIdentity(client, "lean-zip"),
  };
  const workload = await realpath(resolve(options.packages.get("workload")));
  const workloadBuild = JSON.parse(await readFile(join(workload, "BUILD.json"), "utf8"));
  if (
    workloadBuild.kind !== "lean-zip/browser-benchmark-source" ||
    workloadBuild.source?.commit !== git(client, ["rev-parse", "HEAD"]) ||
    workloadBuild.source?.dirty !== false
  ) {
    throw new Error("workload package does not match the exact clean lean-zip checkout");
  }
  for (const [root, label] of [[producer, "VIR"], [client, "lean-zip"]]) {
    const toolchain = (await readFile(join(root, "lean-toolchain"), "utf8")).trim();
    if (toolchain !== "leanprover/lean4:v4.33.0") {
      throw new Error(`${label} must use Lean 4.33 final, got ${toolchain}`);
    }
  }
  const wasiSdk = await realpath(join(producer, ".tools/wasi-sdk"));
  if (!(await lstat(join(wasiSdk, "bin/clang++")).catch(() => null))?.isFile()) {
    throw new Error(`VIR WASI SDK is not installed: ${wasiSdk}`);
  }
  const esbuild = join(producer, "node_modules/.bin/esbuild");
  if (!(await lstat(esbuild).catch(() => null))?.isFile()) {
    throw new Error(`VIR esbuild is not installed: ${esbuild}`);
  }

  await mkdir(join(output, "lean-vir/js"), { recursive: true });
  await mkdir(join(output, "lean-vir/wasm"), { recursive: true });
  try {
    run("npm", ["run", "build:demo:release"], {
      cwd: producer,
      env: {
        ...process.env,
        LEAN4_SRC: runtime,
        VIR_NATIVE_EXTERN_MANIFEST: join(client, "lean-vir-native-externs.json"),
        VIR_SKIP_PACKAGES: "1",
        WASI_SDK_PATH: wasiSdk,
      },
    });
    run("lake", ["build", "Vir", "vir_irpkg"], { cwd: producer });
    run("lake", ["build", "Zip.Wasm.Entry"], { cwd: client });

    const packageFile = "lean-zip.irpkg";
    const reportFile = "lean-zip.report.md";
    run(
      "lake",
      [
        "env",
        join(producer, ".lake/build/bin/vir_irpkg"),
        join(output, packageFile),
        join(output, reportFile),
        "--target-marked",
        join(producer, "fixtures/lean-zip/VirLeanZipAcceptance/Exports.lean"),
      ],
      {
        cwd: client,
        env: {
          ...process.env,
          LEAN_PATH: [
            join(producer, ".lake/build/lib/lean"),
            process.env.LEAN_PATH,
          ].filter(Boolean).join(delimiter),
        },
      },
    );
    await rm(join(output, reportFile));
    run(
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
    await copyFile(
      join(producer, "scripts/lean-zip-browser-package-smoke.mjs"),
      join(output, "smoke.mjs"),
    );

    const oracle = JSON.parse(
      await readFile(join(workload, workloadBuild.workload.nativeOracle), "utf8"),
    );
    const vector = oracle.vectors.find(({ id }) => id === "repeated-1k");
    const expected = vector?.expected.find(({ level }) => level === 6);
    if (!vector || !expected) throw new Error("workload package omits the VIR smoke vector");
    await copyFile(join(workload, vector.input.file), join(output, "smoke.input.bin"));
    await copyFile(join(workload, expected.file), join(output, "smoke.expected.raw"));

    const payloadPaths = [
      "lean-vir/js/vir-runtime.js",
      "lean-vir/wasm/vir-upstream.wasm",
      packageFile,
      "smoke.expected.raw",
      "smoke.input.bin",
      "smoke.mjs",
    ];
    const files = await Promise.all(payloadPaths.map((path) => fileRecord(output, path)));
    const build = {
      schemaVersion: 1,
      kind: "vir/lean-zip-browser-package",
      producerProtocol: "browser-benchmarks/source-package/v1",
      entry: "VirLeanZipAcceptance.compressRaw",
      sources: sourceIdentities,
      runtime: {
        profile: "client-native",
        nativeExternManifest: {
          sourceFile: "lean-vir-native-externs.json",
          sha256: sha256(await readFile(join(client, "lean-vir-native-externs.json"))),
        },
        wasiSdk: basename(wasiSdk),
        module: "lean-vir/js/vir-runtime.js",
        wasm: "lean-vir/wasm/vir-upstream.wasm",
      },
      package: { file: packageFile },
      smoke: {
        input: "smoke.input.bin",
        expected: "smoke.expected.raw",
        level: 6,
      },
      files,
    };
    await writeFile(join(output, "BUILD.json"), `${JSON.stringify(build, null, 2)}\n`);
    const checksumPaths = ["BUILD.json", ...payloadPaths];
    const checksums = await Promise.all(checksumPaths.map(async (path) =>
      `${sha256(await readFile(join(output, path)))}  ${path}`));
    await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
    run("sha256sum", ["--check", "SHA256SUMS"], { cwd: output });
    run(process.execPath, ["smoke.mjs"], { cwd: output });
    console.log(`exported VIR lean-zip browser package to ${output}`);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
