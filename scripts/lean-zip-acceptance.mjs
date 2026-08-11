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
    profile: { type: "boolean", default: false },
    wasm: { type: "string" },
  },
});

const leanZipArgument = positionals[0] ?? process.env.LEAN_ZIP_CHECKOUT;
if (!leanZipArgument || positionals.length > 1) {
  throw new Error(
    "usage: npm run accept:lean-zip -- /path/to/lean-zip [--passes count] [--profile] [--wasm path] [--keep]",
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
const upperLevelProfiles = new Map([
  [
    5,
    {
      exportName: "VirLeanZipAcceptance.profileLevel5",
      declaration: "Zip.Native.Deflate.deflateRawL5Adaptive",
    },
  ],
  [
    6,
    {
      exportName: "VirLeanZipAcceptance.profileLevel6",
      declaration: "Zip.Native.Deflate.deflateRawL6Adaptive",
    },
  ],
  [
    7,
    {
      exportName: "VirLeanZipAcceptance.profileLevel7",
      declaration: "Zip.Native.Deflate.l7ProfileFor + deflateRawL7P",
    },
  ],
  [
    8,
    {
      exportName: "VirLeanZipAcceptance.profileLevel8",
      declaration: "Zip.Native.Deflate.deflateRawL8P",
    },
  ],
  [
    9,
    {
      exportName: "VirLeanZipAcceptance.profileLevel9",
      declaration: "Zip.Native.Deflate.deflateRawL9AdaptiveP",
    },
  ],
  [
    10,
    {
      exportName: "VirLeanZipAcceptance.profileLevel10",
      declaration: "Zip.Native.Deflate.deflateRawL10P",
    },
  ],
]);

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
  const oracleArgs = [
    "-d",
    leanZipRoot,
    "-f",
    overlayLakefile,
    "exe",
    "virLeanZipAcceptanceOracle",
    oracleOutput,
  ];
  if (values.profile) oracleArgs.push("--profile");
  runSync("lake", oracleArgs, { cwd: repoRoot });
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
  const profileMatches = [];
  const profileBases = [];
  const profileOptimals = [];
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
    } else if (fields[0] === "profile-match" && fields.length === 5) {
      profileMatches.push({
        corpus: fields[1],
        level: Number(fields[2]),
        inputFile: fields[3],
        tokensFile: fields[4],
      });
    } else if (fields[0] === "profile-base" && fields.length === 6) {
      profileBases.push({
        corpus: fields[1],
        level: Number(fields[2]),
        inputFile: fields[3],
        tokensFile: fields[4],
        outputBytes: Number(fields[5]),
      });
    } else if (fields[0] === "profile-optimal" && fields.length === 5) {
      profileOptimals.push({
        corpus: fields[1],
        kind: fields[2],
        inputFile: fields[3],
        outputFile: fields[4],
      });
    } else {
      throw new Error(
        `invalid native oracle manifest row: ${JSON.stringify(line)}`,
      );
    }
  }
  return {
    compression,
    largeCompression,
    prescan,
    profileMatches,
    profileBases,
    profileOptimals,
  };
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
  const profileResults = [];
  const stageProfileResults = [];
  const started = performance.now();
  try {
    const runCompressionVector = async (
      vector,
      requireSmaller,
      profileTarget = null,
    ) => {
      const source = await input(vector.inputFile);
      const native = await nativeOutput(vector.outputFile);
      if (requireSmaller) {
        assert.ok(
          native.byteLength < source.byteLength,
          `${vector.name} level ${vector.level}: large corpus is not compressible`,
        );
      }
      let vir;
      let timings = null;
      try {
        if (profileTarget === null) {
          vir = runtime.call(
            "VirLeanZipAcceptance.compressRaw",
            source,
            vector.level,
          );
        } else {
          ({ value: vir, timings } = runtime.callTimed(
            profileTarget.exportName,
            source,
          ));
        }
      } catch (cause) {
        throw new Error(
          `${vector.name} level ${vector.level}: VIR call failed` +
            (profileTarget === null
              ? ""
              : ` through ${profileTarget.exportName}`),
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
        timings,
      };
    };

    const largeResults = new Map();
    for (const vector of manifest.largeCompression) {
      const profileTarget = values.profile
        ? upperLevelProfiles.get(vector.level)
        : null;
      assert.ok(
        profileTarget !== undefined,
        `${vector.name} level ${vector.level}: no upper-level profile export`,
      );
      const result = await runCompressionVector(vector, true, profileTarget);
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
      if (result.timings !== null) {
        profileResults.push({
          corpus: vector.name,
          level: vector.level,
          declaration: profileTarget.declaration,
          inputBytes: result.inputBytes,
          timings: result.timings,
        });
      }
    }

    if (values.profile) {
      assert.equal(
        manifest.profileMatches.length,
        2,
        "expected level-9 and level-10 matcher profile rows",
      );
      assert.equal(
        manifest.profileBases.length,
        2,
        "expected level-9 and level-10 base-preparation profile rows",
      );
      assert.equal(
        manifest.profileOptimals.length,
        2,
        "expected fast and exact optimal profile rows",
      );

      const profileTokens = new Map();
      for (const vector of manifest.profileMatches) {
        const source = await input(vector.inputFile);
        const native = await nativeOutput(vector.tokensFile);
        const { value: vir, timings } = runtime.callTimed(
          "VirLeanZipAcceptance.profileMatchTokens",
          source,
          vector.level,
        );
        assert.ok(
          vir instanceof Uint8Array,
          `${vector.corpus} level ${vector.level}: expected packed matcher ByteArray`,
        );
        assert.deepEqual(
          vir,
          native,
          `${vector.corpus} level ${vector.level}: native/VIR packed tokens differ`,
        );
        profileTokens.set(vector.tokensFile, vir);
        stageProfileResults.push({
          stage: "matcher",
          corpus: vector.corpus,
          level: vector.level,
          inputBytes: source.byteLength,
          outputBytes: vir.byteLength,
          timings,
        });
      }

      for (const vector of manifest.profileBases) {
        const source = await input(vector.inputFile);
        const tokens = profileTokens.get(vector.tokensFile);
        assert.ok(
          tokens instanceof Uint8Array,
          `${vector.corpus} level ${vector.level}: profiled matcher tokens are missing`,
        );
        const { value: vir, timings } = runtime.callTimed(
          "VirLeanZipAcceptance.profileBasePrepSize",
          source,
          tokens,
        );
        const virOutputBytes = Number(vir);
        assert.ok(
          Number.isSafeInteger(virOutputBytes) && virOutputBytes >= 0,
          `${vector.corpus} level ${vector.level}: invalid VIR base-preparation size`,
        );
        assert.equal(
          virOutputBytes,
          vector.outputBytes,
          `${vector.corpus} level ${vector.level}: native/VIR base-preparation size differs`,
        );
        stageProfileResults.push({
          stage: "base-prep",
          corpus: vector.corpus,
          level: vector.level,
          inputBytes: source.byteLength,
          outputBytes: virOutputBytes,
          timings,
        });
      }

      const optimalTargets = new Map([
        [
          "fast",
          {
            exportName: "VirLeanZipAcceptance.profileOptimalFast",
            level: 9,
          },
        ],
        [
          "exact",
          {
            exportName: "VirLeanZipAcceptance.profileOptimalExact",
            level: 10,
          },
        ],
      ]);
      for (const vector of manifest.profileOptimals) {
        const target = optimalTargets.get(vector.kind);
        assert.ok(
          target !== undefined,
          `${vector.corpus}: unknown optimal profile kind ${vector.kind}`,
        );
        const source = await input(vector.inputFile);
        const native = await nativeOutput(vector.outputFile);
        const { value: vir, timings } = runtime.callTimed(
          target.exportName,
          source,
        );
        assert.ok(
          vir instanceof Uint8Array,
          `${vector.corpus} ${vector.kind}: expected optimal ByteArray`,
        );
        assert.deepEqual(
          vir,
          native,
          `${vector.corpus} ${vector.kind}: native/VIR optimal bytes differ`,
        );
        assert.deepEqual(
          new Uint8Array(inflateRawSync(vir)),
          source,
          `${vector.corpus} ${vector.kind}: optimal raw inflate differs from input`,
        );
        stageProfileResults.push({
          stage: `optimal-${vector.kind}`,
          corpus: vector.corpus,
          level: target.level,
          inputBytes: source.byteLength,
          outputBytes: vir.byteLength,
          timings,
        });
      }
    } else {
      assert.equal(
        manifest.profileMatches.length +
          manifest.profileBases.length +
          manifest.profileOptimals.length,
        0,
        "native oracle emitted profile stages without --profile",
      );
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
    if (profileResults.length > 0) {
      console.log(
        "upper-level profile: diagnostic single samples; execute includes the export wrapper",
      );
      for (const result of profileResults) {
        const throughputKiBs =
          result.timings.executeMs === 0
            ? Infinity
            : result.inputBytes / 1024 / (result.timings.executeMs / 1000);
        console.log(
          `profile: corpus=${result.corpus} level=${result.level} ` +
            `declaration=${result.declaration} execute=${result.timings.executeMs.toFixed(2)}ms ` +
            `total=${result.timings.totalMs.toFixed(2)}ms throughput=${throughputKiBs.toFixed(2)}KiB/s`,
        );
      }
    }
    if (stageProfileResults.length > 0) {
      console.log(
        "optimal-stage profile: diagnostic isolated calls; execute excludes token marshal/decode",
      );
      for (const result of stageProfileResults) {
        const detail =
          result.stage === "matcher"
            ? `tokens=${result.outputBytes / 4}`
            : `output=${result.outputBytes}B`;
        console.log(
          `stage-profile: corpus=${result.corpus} level=${result.level} stage=${result.stage} ` +
            `execute=${result.timings.executeMs.toFixed(2)}ms ${detail}`,
        );
      }
      for (const level of [9, 10]) {
        const corpus = "large-heterogeneous";
        const matcher = stageProfileResults.find(
          (result) =>
            result.corpus === corpus &&
            result.level === level &&
            result.stage === "matcher",
        );
        const base = stageProfileResults.find(
          (result) =>
            result.corpus === corpus &&
            result.level === level &&
            result.stage === "base-prep",
        );
        const optimal = stageProfileResults.find(
          (result) =>
            result.corpus === corpus &&
            result.level === level &&
            result.stage === (level === 9 ? "optimal-fast" : "optimal-exact"),
        );
        const whole = profileResults.find(
          (result) => result.corpus === corpus && result.level === level,
        );
        assert.ok(
          matcher && base && optimal && whole,
          `level ${level}: incomplete optimal-stage profile`,
        );
        const componentsMs =
          matcher.timings.executeMs +
          base.timings.executeMs +
          optimal.timings.executeMs;
        const ratioPercent = (100 * componentsMs) / whole.timings.executeMs;
        const winner =
          optimal.outputBytes <= base.outputBytes ? "optimal" : "base";
        console.log(
          `stage-total: level=${level} components=${componentsMs.toFixed(2)}ms ` +
            `whole=${whole.timings.executeMs.toFixed(2)}ms ratio=${ratioPercent.toFixed(1)}% ` +
            `winner=${winner} base=${base.outputBytes}B optimal=${optimal.outputBytes}B`,
        );
      }
    }
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
