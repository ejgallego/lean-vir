/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { median, parsePositiveInt, requireOptionValue } from "./bench-utils.mjs";
import { runSync } from "./process-utils.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const ENTRY = "VersoSlides.Pretty.formatSegmentsForVir";
const ARTIFACT_DIR = path.join(ROOT, "build", "object-conversion");

function balancedPrettyAppend(formats) {
  if (formats.length === 0) return null;
  let level = formats.slice();
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(index + 1 < level.length ? [4, level[index], level[index + 1]] : level[index]);
    }
    level = next;
  }
  return level[0];
}

function compactFormatToStdFormat(format) {
  if (format === null) return { kind: "nil" };
  if (typeof format === "string") return { kind: "text", value: format };
  if (!Array.isArray(format)) throw new Error("invalid compact format node");
  switch (format[0]) {
    case 4:
      return {
        kind: "append",
        fields: {
          arg1: compactFormatToStdFormat(format[1]),
          arg2: compactFormatToStdFormat(format[2]),
        },
      };
    case 7:
      return {
        kind: "tag",
        fields: { arg1: String(format[1]), arg2: compactFormatToStdFormat(format[2]) },
      };
    default:
      throw new Error(`unsupported benchmark format node tag ${format[0]}`);
  }
}

function taggedChunksFormat(depth, chunks) {
  return balancedPrettyAppend(
    Array.from({ length: chunks }, (_unused, chunk) => {
      let format = "x";
      for (let tag = 0; tag < depth; tag += 1) {
        format = [7, chunk * depth + tag + 1, format];
      }
      return format;
    }),
  );
}

const SCENARIOS = [
  {
    id: "tag-transitions-64x64",
    label: "64 tag levels x 64 chunks",
    class: "representative",
    format: compactFormatToStdFormat(taggedChunksFormat(64, 64)),
    width: 80,
    indent: 0,
    expectedOutputDigest: "837d296e3a00222399b29c9680d80097bc1586af0729ba2c78a5469cb687a5cc",
  },
  {
    id: "nodes-2047",
    label: "2,047 empty-output Format nodes",
    class: "focused",
    format: compactFormatToStdFormat(
      balancedPrettyAppend(Array.from({ length: 1024 }, () => null)),
    ),
    width: 80,
    indent: 0,
    expectedOutputDigest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  },
  {
    id: "text-8",
    label: "8 text code points",
    class: "micro",
    format: { kind: "text", value: "xxxxxxxx" },
    width: 80,
    indent: 0,
    expectedOutputDigest: null,
  },
];

function parseArgs(argv) {
  const options = {
    batchTargetMs: 150,
    candidateRoot: ROOT,
    controlRoot: path.resolve(ROOT, "../pr104-conversion-control"),
    irPackage: path.join(ARTIFACT_DIR, "prettyM-vir.irpkg"),
    output: path.join(ARTIFACT_DIR, "comparison.json"),
    passes: 8,
    startupIterations: 3,
    warmupBatches: 4,
    wasm: path.join(ARTIFACT_DIR, "vir-control.wasm"),
  };
  const paths = new Map([
    ["--candidate-root", "candidateRoot"],
    ["--control-root", "controlRoot"],
    ["--ir-package", "irPackage"],
    ["--output", "output"],
    ["--wasm", "wasm"],
  ]);
  const integers = new Map([
    ["--batch-target-ms", "batchTargetMs"],
    ["--passes", "passes"],
    ["--startup-iterations", "startupIterations"],
    ["--warmup-batches", "warmupBatches"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalIndex = arg.indexOf("=");
    const option = equalIndex === -1 ? arg : arg.slice(0, equalIndex);
    const inlineValue = equalIndex === -1 ? null : arg.slice(equalIndex + 1);
    if (paths.has(option)) {
      const value = inlineValue ?? requireOptionValue(argv, ++index, option);
      options[paths.get(option)] = path.resolve(value);
    } else if (integers.has(option)) {
      const value = inlineValue ?? requireOptionValue(argv, ++index, option);
      options[integers.get(option)] = parsePositiveInt(value, option);
    } else {
      throw new Error(
        `usage: ${path.basename(process.argv[1])} [--control-root PATH] ` +
        "[--candidate-root PATH] [--wasm PATH] [--ir-package PATH] [--output PATH] " +
        "[--passes N] [--batch-target-ms N] [--warmup-batches N] " +
        "[--startup-iterations N]",
      );
    }
  }
  if (options.passes % 2 !== 0) throw new Error("--passes must be even for an AB/BA schedule");
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function outputDigest(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

async function requireAbsent(file) {
  try {
    await access(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`refusing to overwrite existing report: ${file}`);
}

function gitText(root, args) {
  return runSync("git", args, { cwd: root, capture: true, trimStdout: false });
}

async function sourceIdentity(root) {
  const status = gitText(root, ["status", "--short", "--untracked-files=all"]);
  const diff = gitText(root, ["diff", "--binary", "--full-index", "HEAD"]);
  const runtimeFiles = gitText(root, ["ls-files", "web/src"])
    .trim()
    .split("\n")
    .filter((file) => file.endsWith(".js") && !file.startsWith("web/src/generated/"));
  const runtimeHash = createHash("sha256");
  for (const file of runtimeFiles) {
    runtimeHash.update(file);
    runtimeHash.update("\0");
    runtimeHash.update(await readFile(path.join(root, file)));
    runtimeHash.update("\0");
  }
  return {
    root,
    commit: gitText(root, ["rev-parse", "HEAD"]).trim(),
    ref: gitText(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    dirty: status.length !== 0,
    statusSha256: status.length === 0 ? null : sha256(Buffer.from(status)),
    trackedDiffSha256: diff.length === 0 ? null : sha256(Buffer.from(diff)),
    runtimeFiles: runtimeFiles.length,
    runtimeSourceSha256: runtimeHash.digest("hex"),
  };
}

async function runtimeFactoryFor(root, wasmBytes) {
  const modulePath = path.join(root, "web", "src", "vir-runtime-node.js");
  const runtimeModule = await import(pathToFileURL(modulePath).href);
  return runtimeModule.createVirRuntimeFactory({ wasmBytes });
}

function runBatch(runtime, scenario, iterations) {
  let output;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    output = runtime.call(ENTRY, scenario.format, scenario.width, scenario.indent);
  }
  return { elapsedMs: performance.now() - started, output };
}

function pairedSchedule(passes) {
  return Array.from({ length: passes }, (_unused, passIndex) => ({
    pass: passIndex + 1,
    order: passIndex % 2 === 0 ? ["control", "candidate"] : ["candidate", "control"],
  }));
}

function summarizeRows(rows) {
  const control = rows.map((row) => row.control.perCallMs);
  const candidate = rows.map((row) => row.candidate.perCallMs);
  const pairedDeltasPct = rows.map((row) =>
    100 * (row.candidate.perCallMs - row.control.perCallMs) / row.control.perCallMs);
  const controlMedianMs = median(control);
  const candidateMedianMs = median(candidate);
  return {
    controlMedianMs,
    candidateMedianMs,
    upperMedianPairedDeltaPct: median(pairedDeltasPct),
    ratioOfUpperMediansDeltaPct: 100 * (candidateMedianMs - controlMedianMs) / controlMedianMs,
    pairedDeltasPct,
  };
}

function requireDigest(scenario, output, expectedDigest, context) {
  const digest = outputDigest(output);
  if (expectedDigest !== null) assert.equal(digest, expectedDigest, `${scenario.id}: ${context}`);
  return digest;
}

function createPersistentSide(label, factory, module, packageBytes) {
  const runtime = factory.instantiateModule(module);
  runtime.installIrPackageSetBytes([packageBytes]);
  return { label, runtime };
}

function benchmarkPersistentScenario(sides, scenario, options) {
  let expectedDigest = scenario.expectedOutputDigest;
  for (let warmup = 0; warmup < options.warmupBatches; warmup += 1) {
    for (const side of [sides.control, sides.candidate]) {
      const output = runBatch(side.runtime, scenario, 1).output;
      const digest = requireDigest(scenario, output, expectedDigest, `${side.label} warmup output mismatch`);
      expectedDigest ??= digest;
    }
  }
  const probes = Object.fromEntries([sides.control, sides.candidate].map((side) => {
    const sample = runBatch(side.runtime, scenario, 1);
    requireDigest(scenario, sample.output, expectedDigest, `${side.label} probe output mismatch`);
    return [side.label, sample.elapsedMs];
  }));
  const iterations = Math.max(
    1,
    Math.min(10000, Math.ceil(options.batchTargetMs / Math.max(probes.control, probes.candidate, 0.001))),
  );
  for (let warmup = 0; warmup < options.warmupBatches; warmup += 1) {
    for (const side of [sides.control, sides.candidate]) {
      const sample = runBatch(side.runtime, scenario, iterations);
      requireDigest(scenario, sample.output, expectedDigest, `${side.label} batch warmup output mismatch`);
    }
  }
  const rows = [];
  for (const scheduled of pairedSchedule(options.passes)) {
    const row = { pass: scheduled.pass, order: scheduled.order.join("-") };
    for (const label of scheduled.order) {
      const sample = runBatch(sides[label].runtime, scenario, iterations);
      row[label] = {
        elapsedMs: sample.elapsedMs,
        perCallMs: sample.elapsedMs / iterations,
        digest: requireDigest(scenario, sample.output, expectedDigest, `${label} pass output mismatch`),
      };
    }
    rows.push(row);
  }
  return {
    id: scenario.id,
    label: scenario.label,
    class: scenario.class,
    phase: "steady runtime.call; input lowering, interpreter execution, and result lifting included",
    iterationsPerPass: iterations,
    warmupBatches: options.warmupBatches,
    outputDigest: expectedDigest,
    rows,
    summary: summarizeRows(rows),
  };
}

function runStartupBatch(factory, module, packageBytes, scenario, iterations, expectedDigest) {
  let output;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const runtime = factory.instantiateModule(module);
    try {
      runtime.installIrPackageSetBytes([packageBytes]);
      output = runtime.call(ENTRY, scenario.format, scenario.width, scenario.indent);
    } finally {
      runtime.dispose();
    }
  }
  requireDigest(scenario, output, expectedDigest, "startup output mismatch");
  return { elapsedMs: performance.now() - started, output };
}

function benchmarkStartup(factories, modules, packageBytes, scenario, options, expectedDigest) {
  for (let warmup = 0; warmup < options.warmupBatches; warmup += 1) {
    for (const label of ["control", "candidate"]) {
      runStartupBatch(factories[label], modules[label], packageBytes, scenario, 1, expectedDigest);
    }
  }
  const rows = [];
  for (const scheduled of pairedSchedule(options.passes)) {
    const row = { pass: scheduled.pass, order: scheduled.order.join("-") };
    for (const label of scheduled.order) {
      const sample = runStartupBatch(
        factories[label], modules[label], packageBytes, scenario,
        options.startupIterations, expectedDigest,
      );
      row[label] = {
        elapsedMs: sample.elapsedMs,
        perCallMs: sample.elapsedMs / options.startupIterations,
        digest: outputDigest(sample.output),
      };
    }
    rows.push(row);
  }
  return {
    id: "startup-text-8",
    label: "fresh runtime + package load + first 8-code-point call",
    class: "guardrail",
    phase: "fresh Wasm instance, package load, input lowering, first call, result lifting, and disposal; module compilation excluded",
    iterationsPerPass: options.startupIterations,
    warmupBatches: options.warmupBatches,
    outputDigest: expectedDigest,
    rows,
    summary: summarizeRows(rows),
  };
}

function printResult(result) {
  const summary = result.summary;
  console.log(`\n${result.label}`);
  console.log(`  control:   ${summary.controlMedianMs.toFixed(6)} ms / call`);
  console.log(`  candidate: ${summary.candidateMedianMs.toFixed(6)} ms / call`);
  console.log(
    `  paired:    ${summary.pairedDeltasPct.map((value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`).join(", ")}`,
  );
  console.log(
    `  upper-median paired delta: ${summary.upperMedianPairedDeltaPct >= 0 ? "+" : ""}` +
    `${summary.upperMedianPairedDeltaPct.toFixed(2)}%`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await requireAbsent(options.output);
  const [wasmBytes, packageBytes, harnessBytes, toolchain, controlSource, candidateSource] = await Promise.all([
    readFile(options.wasm),
    readFile(options.irPackage),
    readFile(fileURLToPath(import.meta.url)),
    readFile(path.join(ROOT, "lean-toolchain"), "utf8"),
    sourceIdentity(options.controlRoot),
    sourceIdentity(options.candidateRoot),
  ]);
  const factories = {
    control: await runtimeFactoryFor(options.controlRoot, wasmBytes),
    candidate: await runtimeFactoryFor(options.candidateRoot, wasmBytes),
  };
  const modules = {
    control: await factories.control.module(),
    candidate: await factories.candidate.module(),
  };
  const results = [];
  let textDigest;
  for (const scenario of SCENARIOS) {
    console.error(`benchmarking ${scenario.id}...`);
    const sides = {
      control: createPersistentSide("control", factories.control, modules.control, packageBytes),
      candidate: createPersistentSide("candidate", factories.candidate, modules.candidate, packageBytes),
    };
    try {
      const result = benchmarkPersistentScenario(sides, scenario, options);
      results.push(result);
      if (scenario.id === "text-8") textDigest = result.outputDigest;
      printResult(result);
    } finally {
      sides.control.runtime.dispose();
      sides.candidate.runtime.dispose();
    }
  }
  const startup = benchmarkStartup(
    factories, modules, packageBytes, SCENARIOS.find(({ id }) => id === "text-8"),
    options, textDigest,
  );
  results.push(startup);
  printResult(startup);

  const report = {
    schema: "lean-vir.pretty-object-conversion-comparison.v1",
    generatedAt: new Date().toISOString(),
    command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    sources: { control: controlSource, candidate: candidateSource },
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
      leanToolchain: toolchain.trim(),
      wasmBuild: { profile: "release", optimization: "-O3", target: "wasm32-wasip1" },
    },
    method: {
      passes: options.passes,
      schedule: "alternating AB/BA; control-candidate on odd passes, candidate-control on even passes",
      aggregation: "upper median raw per-call time and upper median paired percent delta",
      persistentWarmupBatches: options.warmupBatches,
      persistentBatchTargetMs: options.batchTargetMs,
      startupIterationsPerPass: options.startupIterations,
      correctness: "control/candidate output digests checked after every warmup and measured batch",
    },
    artifacts: {
      wasm: { path: path.relative(ROOT, options.wasm), byteLength: wasmBytes.length, sha256: sha256(wasmBytes) },
      irPackage: {
        path: path.relative(ROOT, options.irPackage), byteLength: packageBytes.length, sha256: sha256(packageBytes),
      },
      harness: {
        path: path.relative(ROOT, fileURLToPath(import.meta.url)), byteLength: harnessBytes.length,
        sha256: sha256(harnessBytes),
      },
    },
    results,
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${options.output}`);
}

await main();
