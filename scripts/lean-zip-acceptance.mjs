/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inflateRawSync } from "node:zlib";

import { pathExists } from "./file-utils.mjs";
import { runSync } from "./process-utils.mjs";
import { createVirRuntime } from "../web/src/vir-runtime-node.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repoRoot, "fixtures", "lean-zip");
const exportsSource = join(fixtureRoot, "VirLeanZipAcceptance", "Exports.lean");
const oracleSourceRoot = fixtureRoot;
const generator = join(repoRoot, ".lake", "build", "bin", "vir_irpkg");

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    keep: { type: "boolean", default: false },
    passes: { type: "string", default: "3" },
    wasm: { type: "string" },
  },
});

const leanZipArgument = positionals[0] ?? process.env.LEAN_ZIP_CHECKOUT;
if (!leanZipArgument || positionals.length > 1) {
  throw new Error(
    "usage: npm run accept:lean-zip -- /path/to/lean-zip [--passes count] [--wasm path] [--keep]",
  );
}

const passes = Number(values.passes);
if (!Number.isSafeInteger(passes) || passes < 1) {
  throw new Error("--passes must be an integer greater than zero");
}

const leanZipRoot = resolve(leanZipArgument);
const wasmPath = resolve(
  values.wasm ?? join(repoRoot, "web", "public", "vir-upstream.wasm"),
);
const lakefile = join(leanZipRoot, "lakefile.lean");

for (const [path, message] of [
  [lakefile, `lean-zip Lake configuration not found: ${lakefile}`],
  [
    wasmPath,
    `shared Wasm not found: ${wasmPath}; run npm run build:demo first`,
  ],
]) {
  if (!(await pathExists(path))) throw new Error(message);
}

runSync("lake", ["build", "Vir", "vir_irpkg"], { cwd: repoRoot });
const virLeanVersion = runSync("lean", ["--short-version"], {
  cwd: repoRoot,
  capture: true,
});
const leanZipLeanVersion = runSync("lake", ["env", "lean", "--short-version"], {
  cwd: leanZipRoot,
  capture: true,
});
if (virLeanVersion !== leanZipLeanVersion) {
  throw new Error(
    `Lean toolchain mismatch: VIR uses ${virLeanVersion}, lean-zip uses ${leanZipLeanVersion}`,
  );
}

const workDir = await mkdtemp(join(tmpdir(), "vir-lean-zip-acceptance-"));
const oracleOutput = join(workDir, "oracle");
const packagePath = join(workDir, "lean-zip-acceptance.irpkg");
const reportPath = join(workDir, "lean-zip-acceptance.report.md");
const overlayLakefile = join(workDir, "lakefile.lean");

function leanString(value) {
  return JSON.stringify(value);
}

async function writeOracleLakefile() {
  const source = await readFile(lakefile, "utf8");
  await writeFile(
    overlayLakefile,
    `${source.trimEnd()}\n\n` +
      "lean_exe virLeanZipAcceptanceOracle where\n" +
      "  root := `VirLeanZipAcceptance.NativeOracle\n" +
      `  srcDir := ${leanString(oracleSourceRoot)}\n`,
  );
}

async function generateNativeOracle() {
  await mkdir(oracleOutput);
  await writeOracleLakefile();
  runSync(
    "lake",
    [
      "-d",
      leanZipRoot,
      "-f",
      overlayLakefile,
      "exe",
      "virLeanZipAcceptanceOracle",
      oracleOutput,
    ],
    { cwd: repoRoot },
  );
}

function externalLeanEnv() {
  return {
    ...process.env,
    LEAN_PATH: [
      join(repoRoot, ".lake", "build", "lib", "lean"),
      process.env.LEAN_PATH,
    ]
      .filter(Boolean)
      .join(delimiter),
  };
}

function generateVirPackage() {
  runSync(
    "lake",
    [
      "env",
      generator,
      packagePath,
      reportPath,
      "--target-marked",
      exportsSource,
    ],
    { cwd: leanZipRoot, env: externalLeanEnv() },
  );
}

function parseManifest(source) {
  const compression = [];
  const largeCompression = [];
  const prescan = [];
  for (const line of source.trim().split("\n")) {
    const fields = line.split("\t");
    if (
      (fields[0] === "compress" || fields[0] === "large-compress") &&
      fields.length === 5
    ) {
      const vector = {
        name: fields[1],
        level: Number(fields[2]),
        inputFile: fields[3],
        outputFile: fields[4],
      };
      (fields[0] === "compress" ? compression : largeCompression).push(vector);
    } else if (fields[0] === "prescan" && fields.length === 4) {
      if (fields[3] !== "true" && fields[3] !== "false") {
        throw new Error(
          `invalid native oracle prescan result: ${JSON.stringify(line)}`,
        );
      }
      prescan.push({
        name: fields[1],
        inputFile: fields[2],
        decision: fields[3] === "true",
      });
    } else {
      throw new Error(
        `invalid native oracle manifest row: ${JSON.stringify(line)}`,
      );
    }
  }
  return { compression, largeCompression, prescan };
}

async function runAcceptance() {
  await generateNativeOracle();
  generateVirPackage();

  const manifest = parseManifest(
    await readFile(join(oracleOutput, "manifest.tsv"), "utf8"),
  );
  const wasmBytes = await readFile(wasmPath);
  const packageBytes = await readFile(packagePath);
  const runtime = await createVirRuntime({
    wasmBytes,
    irPackageSetBytes: [packageBytes],
  });
  const wasmPages = () => runtime.exports.memory.buffer.byteLength / 65536;
  const initialPages = wasmPages();
  const inputs = new Map();
  const nativeOutputs = new Map();
  const input = async (file) => {
    if (!inputs.has(file))
      inputs.set(
        file,
        new Uint8Array(await readFile(join(oracleOutput, file))),
      );
    return inputs.get(file);
  };
  const nativeOutput = async (file) => {
    if (!nativeOutputs.has(file)) {
      nativeOutputs.set(
        file,
        new Uint8Array(await readFile(join(oracleOutput, file))),
      );
    }
    return nativeOutputs.get(file);
  };

  let compressedInputBytes = 0;
  let compressedOutputBytes = 0;
  let compressionCalls = 0;
  const started = performance.now();
  try {
    const runCompressionVector = async (vector, requireSmaller) => {
      const source = await input(vector.inputFile);
      const native = await nativeOutput(vector.outputFile);
      if (requireSmaller) {
        assert.ok(
          native.byteLength < source.byteLength,
          `${vector.name} level ${vector.level}: large corpus is not compressible`,
        );
      }
      let vir;
      try {
        vir = runtime.call(
          "VirLeanZipAcceptance.compressRaw",
          source,
          vector.level,
        );
      } catch (cause) {
        throw new Error(
          `${vector.name} level ${vector.level}: VIR call failed`,
          { cause },
        );
      }
      assert.ok(
        vir instanceof Uint8Array,
        `${vector.name} level ${vector.level}: expected ByteArray`,
      );
      assert.deepEqual(
        vir,
        native,
        `${vector.name} level ${vector.level}: native/VIR bytes differ`,
      );
      assert.deepEqual(
        new Uint8Array(inflateRawSync(vir)),
        source,
        `${vector.name} level ${vector.level}: raw inflate differs from input`,
      );
      compressedInputBytes += source.byteLength;
      compressedOutputBytes += vir.byteLength;
      compressionCalls += 1;
      return {
        inputBytes: source.byteLength,
        outputBytes: vir.byteLength,
      };
    };

    const largeResults = new Map();
    for (const vector of manifest.largeCompression) {
      const result = await runCompressionVector(vector, true);
      const current = largeResults.get(vector.name) ?? {
        inputBytes: result.inputBytes,
        outputBytes: [],
      };
      assert.equal(
        current.inputBytes,
        result.inputBytes,
        `${vector.name}: inconsistent large-corpus input size`,
      );
      current.outputBytes.push(result.outputBytes);
      largeResults.set(vector.name, current);
    }

    for (const vector of manifest.prescan) {
      const source = await input(vector.inputFile);
      let vir;
      try {
        vir = runtime.call(
          "VirLeanZipAcceptance.incompressiblePrescan",
          source,
        );
      } catch (cause) {
        throw new Error(`${vector.name}: VIR prescan call failed`, { cause });
      }
      assert.equal(
        vir,
        vector.decision,
        `${vector.name}: native/VIR prescan decision differs`,
      );
    }

    const setupPages = wasmPages();
    const passPages = [];
    for (let pass = 0; pass < passes; pass += 1) {
      for (const vector of manifest.compression) {
        await runCompressionVector(vector, false);
      }
      passPages.push(wasmPages());
    }
    if (passPages.length > 1) {
      assert.ok(
        passPages.slice(1).every((pages) => pages === passPages[0]),
        `Wasm memory did not stabilize after the first matrix pass: ${passPages.join(",")}`,
      );
    }

    const elapsedMs = performance.now() - started;
    const finalPages = wasmPages();
    const levels = [
      ...new Set(manifest.compression.map(({ level }) => level)),
    ].sort((left, right) => left - right);
    console.log("lean-zip native/VIR acceptance ok");
    console.log(
      `compression vectors: ${manifest.compression.length} x ${passes} passes; ` +
        `large vectors: ${manifest.largeCompression.length}; calls: ${compressionCalls}; ` +
        `levels: ${levels.join(",")}`,
    );
    console.log(
      `prescan vectors: ${manifest.prescan.length}; decisions: ${manifest.prescan
        .map(({ name, decision }) => `${name}=${decision}`)
        .join(", ")}`,
    );
    console.log(
      `bytes: input=${compressedInputBytes} compressed=${compressedOutputBytes}`,
    );
    console.log(
      `large ratios: ${[...largeResults]
        .map(([name, { inputBytes, outputBytes }]) => {
          const ratios = outputBytes.map((size) => (100 * size) / inputBytes);
          return `${name}=${Math.min(...ratios).toFixed(2)}-${Math.max(...ratios).toFixed(2)}%`;
        })
        .join(", ")}`,
    );
    console.log(
      `runtime: ${(elapsedMs / 1000).toFixed(2)}s; Wasm pages: initial=${initialPages}, ` +
        `after large/prescan=${setupPages}, passes=${passPages.join(",")}, final=${finalPages}`,
    );
  } finally {
    runtime.dispose();
  }
}

try {
  await runAcceptance();
} finally {
  if (values.keep) {
    console.log(`kept acceptance artifacts: ${workDir}`);
  } else {
    await rm(workDir, { recursive: true, force: true });
  }
}
