#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sampleBenchmarkCandidates } from "./bench-differential.mjs";
import {
  environmentLookupGitIdentity,
  environmentLookupHarnessIdentity,
  environmentLookupPackageIdentity,
  environmentLookupPairHarnessPaths,
  sha256,
} from "./bench-env-lookup-contract.mjs";
import {
  parseNonnegativeInt,
  parsePositiveInt,
  requireOptionValue,
  summarizePairedSamples,
} from "./bench-utils.mjs";
import { leanPackageFile, publicArtifactPath } from "./browser-package-config.mjs";
import { readIrPackageFile } from "./irpkg-format.mjs";
import { createVirRuntimeFactory } from "../web/src/vir-runtime.js";

const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const entryName = "Vir.Fixtures.ExprPrinter.exprCoverageScore";
const expectedResult = 1232;
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}
if (typeof globalThis.gc !== "function") {
  throw new Error("paired environment lookup benchmark requires node --expose-gc");
}

await requireAbsent(args.jsonPath);
const packagePath = resolve(rootPath, publicArtifactPath(leanPackageFile));
const [packageBytes, packageInfo, harnessSourceBytes] = await Promise.all([
  readFile(packagePath),
  readIrPackageFile(packagePath),
  Promise.all(environmentLookupPairHarnessPaths.map((path) =>
    readFile(new URL(`../${path}`, import.meta.url)))),
]);
const packageIdentity = environmentLookupPackageIdentity(packageBytes, packageInfo);
const harnessIdentity = environmentLookupHarnessIdentity(
  environmentLookupPairHarnessPaths.map((path, index) => ({
    path,
    bytes: harnessSourceBytes[index],
  })),
);
const specs = [
  { id: "control", path: resolve(rootPath, args.controlPath) },
  { id: "candidate", path: resolve(rootPath, args.candidatePath) },
];

const states = [];
for (const spec of specs) {
  const wasmBytes = await readFile(spec.path);
  const factory = createVirRuntimeFactory({ wasmBytes });
  const module = await factory.module();
  const runtime = factory.instantiateModule(module);
  runtime.installIrPackageSetBytes([packageBytes]);
  const entry = runtime.findManifestEntry(entryName);
  if (entry === null) throw new Error(`${entryName} is missing from ${spec.id}`);
  states.push({
    ...spec,
    wasmBytes,
    factory,
    module,
    runtime,
    entry,
    slot: resolveSlot(runtime, entry),
  });
}

const execution = sampleBenchmarkCandidates({
  candidates: states.map(executionCandidate),
  warmupRounds: args.warmupRounds,
  sampleRounds: args.sampleRounds,
});
const packageLoad = sampleBenchmarkCandidates({
  candidates: states.map(loadCandidate),
  warmupRounds: args.warmupRounds,
  sampleRounds: args.sampleRounds,
});

for (const state of states) state.runtime.dispose();
if (!execution.passed || !packageLoad.passed) {
  throw new Error("paired environment lookup checksum parity failed");
}
const runtimeEnvironmentIdentity = {
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model ?? null,
};

const report = {
  schema: "lean-vir.env-lookup-wasm-pair.v1",
  generatedAt: new Date().toISOString(),
  command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  comparisonIdentity: {
    workload: "environment-lookup-wasm-pair-v1",
    entry: entryName,
    expectedResult,
    warmupRounds: args.warmupRounds,
    sampleRounds: args.sampleRounds,
    executionIterationsPerRound: args.iterations,
    loadIterationsPerRound: args.loadIterations,
    package: packageIdentity,
    harnessSha256: harnessIdentity.sha256,
    environment: runtimeEnvironmentIdentity,
  },
  git: environmentLookupGitIdentity(root),
  environment: runtimeEnvironmentIdentity,
  policy: {
    warmupRounds: args.warmupRounds,
    sampleRounds: args.sampleRounds,
    executionIterations: args.iterations,
    loadIterations: args.loadIterations,
    collection: "forced before each timed candidate window",
    order: "rotated inside every measured round",
  },
  workload: {
    class: "focused",
    entry: entryName,
    expectedResult,
    correctness: "both artifacts must return the expected result and identical stable checksums",
    execution: {
      phase: "resolved interpreter calls; package loading and call-slot resolution excluded",
      endpoint: "vir_call_resolved_objects",
      iterationsPerRound: args.iterations,
    },
    packageLoad: {
      phase: "package decode, initializer execution, and manifest installation; Wasm instantiation excluded",
      endpoint: "installIrPackageSetBytes",
      iterationsPerRound: args.loadIterations,
    },
  },
  aggregation: {
    pairedRatio: "candidate per-iteration milliseconds / control per-iteration milliseconds",
    headline: "median of paired ratios; even samples use the mean of the two middle ratios",
    diagnostic: "geometric mean of paired ratios and slower/equal/faster round counts",
  },
  harness: harnessIdentity,
  package: {
    path: packagePath,
    declarations: packageInfo.package.declarationCount,
    byteLength: packageBytes.byteLength,
    sha256: sha256(packageBytes),
    contentIdentity: packageIdentity,
  },
  artifacts: Object.fromEntries(states.map((state) => [state.id, {
    path: state.path,
    byteLength: state.wasmBytes.byteLength,
    sha256: sha256(state.wasmBytes),
  }])),
  execution: pairedReport(execution, args.iterations),
  packageLoad: pairedReport(packageLoad, args.loadIterations),
};

if (args.jsonPath !== null) {
  await mkdir(dirname(args.jsonPath), { recursive: true });
  await writeFile(args.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (args.check) {
  console.log(
    `paired environment lookup smoke ok: ${packageInfo.package.declarationCount} declarations, ` +
    `${entryName} = ${expectedResult}`,
  );
} else {
  console.log("# Lean VIR paired environment lookup benchmark");
  console.log(`package: ${leanPackageFile} (${packageInfo.package.declarationCount} declarations)`);
  printSummary("public call", report.execution);
  printSummary("package load", report.packageLoad);
}
if (args.jsonPath !== null) console.log(`wrote benchmark report: ${args.jsonPath}`);

function parseArgs(argv) {
  const parsed = {
    candidatePath: null,
    check: false,
    controlPath: null,
    help: false,
    iterations: 5000,
    jsonPath: null,
    loadIterations: 20,
    sampleRounds: 30,
    warmupRounds: 4,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--check") {
      parsed.check = true;
    } else if (arg === "--iterations") {
      parsed.iterations = parsePositiveInt(
        requireOptionValue(argv, ++index, "--iterations"),
        "--iterations",
      );
    } else if (arg.startsWith("--iterations=")) {
      parsed.iterations = parsePositiveInt(arg.slice("--iterations=".length), "--iterations");
    } else if (arg === "--load-iterations") {
      parsed.loadIterations = parsePositiveInt(
        requireOptionValue(argv, ++index, "--load-iterations"),
        "--load-iterations",
      );
    } else if (arg.startsWith("--load-iterations=")) {
      parsed.loadIterations = parsePositiveInt(
        arg.slice("--load-iterations=".length),
        "--load-iterations",
      );
    } else if (arg === "--samples") {
      parsed.sampleRounds = parsePositiveInt(
        requireOptionValue(argv, ++index, "--samples"),
        "--samples",
      );
    } else if (arg.startsWith("--samples=")) {
      parsed.sampleRounds = parsePositiveInt(arg.slice("--samples=".length), "--samples");
    } else if (arg === "--warmups") {
      parsed.warmupRounds = parseNonnegativeInt(
        requireOptionValue(argv, ++index, "--warmups"),
        "--warmups",
      );
    } else if (arg.startsWith("--warmups=")) {
      parsed.warmupRounds = parseNonnegativeInt(arg.slice("--warmups=".length), "--warmups");
    } else if (arg === "--json") {
      parsed.jsonPath = requireOptionValue(argv, ++index, "--json");
    } else if (arg.startsWith("--json=")) {
      parsed.jsonPath = arg.slice("--json=".length);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown paired environment lookup argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (parsed.jsonPath === "") throw new Error("--json requires a path");
  if (!parsed.help && positional.length !== 2) {
    throw new Error("paired environment lookup benchmark requires CONTROL_WASM CANDIDATE_WASM");
  }
  [parsed.controlPath, parsed.candidatePath] = positional;
  return parsed;
}

function printUsage() {
  console.log(`usage: npm run bench:env-lookup:wasm-pair -- [options] CONTROL_WASM CANDIDATE_WASM

options:
  --check              print correctness-only smoke output, not timing summaries
  --iterations N       calls per execution observation (default: 5000)
  --load-iterations N  fresh package loads per load observation (default: 20)
  --warmups N          unreported warmup rounds (default: 4)
  --samples N          measured alternating rounds (default: 30)
  --json PATH          write raw paired samples and artifact identities
  -h, --help           show this help`);
}

async function requireAbsent(path) {
  if (path === null) return;
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`--json refuses to overwrite existing path: ${path}`);
}

function resolveSlot(runtime, entry) {
  const exportIndex = runtime.interfaceManifest.exports.indexOf(entry);
  const slot = runtime.exports.vir_resolve_call_export(exportIndex) >>> 0;
  if (slot === 0) throw new Error(runtime.lastCallError() || `cannot resolve ${entryName}`);
  return slot;
}

function callRaw(runtime, entry, slot) {
  const resultObj = runtime.exports.vir_call_resolved_objects(slot, 0, 0);
  if (resultObj === 0) throw new Error(runtime.lastCallError() || `${entryName} failed`);
  try {
    return Number(runtime.liftOwnedObjectValue(entry.result, resultObj, `${entryName} result`));
  } finally {
    runtime.exports.vir_obj_dec(resultObj);
  }
}

function executionCandidate(state) {
  return {
    id: state.id,
    setup: () => globalThis.gc(),
    run() {
      let checksum = 0;
      for (let index = 0; index < args.iterations; index += 1) {
        const result = callRaw(state.runtime, state.entry, state.slot);
        if (result !== expectedResult) throw new Error(`${state.id} returned ${result}`);
        checksum += result;
      }
      return checksum;
    },
  };
}

function loadCandidate(state) {
  return {
    id: state.id,
    setup() {
      const runtimes = Array.from(
        { length: args.loadIterations },
        () => state.factory.instantiateModule(state.module),
      );
      globalThis.gc();
      return runtimes;
    },
    run(runtimes) {
      let checksum = 0;
      for (const runtime of runtimes) {
        const loaded = runtime.installIrPackageSetBytes([packageBytes]);
        if (loaded.count !== packageInfo.package.declarationCount) {
          throw new Error(`${state.id} loaded ${loaded.count} declarations`);
        }
        checksum += loaded.count;
      }
      return checksum;
    },
    teardown(runtimes) {
      for (const runtime of runtimes) runtime.dispose();
    },
  };
}

function pairedReport(sample, iterations) {
  return {
    correctness: {
      passed: sample.passed,
      parity: sample.parity,
      controlChecksum: sample.candidates.control.checksum,
      candidateChecksum: sample.candidates.candidate.checksum,
    },
    ...summarizePairedSamples(
      sample.candidates.control.samples,
      sample.candidates.candidate.samples,
      iterations,
      sample.measuredOrders,
    ),
  };
}

function printSummary(label, summary) {
  console.log(
    `${label}: median paired delta ${percentDelta(summary.medianRatio)}, ` +
    `geometric mean delta ${percentDelta(summary.geometricMeanRatio)}, ` +
    `candidate slower ${summary.slowerRounds}/${args.sampleRounds} rounds`,
  );
}

function percentDelta(ratio) {
  const value = (ratio - 1) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
