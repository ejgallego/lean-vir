/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  benchmarkReportLabel,
  benchmarkSampleNamesForReports,
  printOptionalBenchmarkSampleComparison,
  printSideOnlyBenchmarkSummaries,
  readBenchmarkReport,
} from "./bench-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const before = await readBenchmarkReport(args.beforePath, "before");
const after = await readBenchmarkReport(args.afterPath, "after");

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  if (argv.length !== 2) {
    printUsage();
    process.exit(1);
  }
  return {
    beforePath: argv[0],
    afterPath: argv[1],
  };
}

function printUsage() {
  console.log("usage: npm run bench:compare -- build/perf/before.json build/perf/after.json");
}

function requireBenchmarkPair(name) {
  const beforeBenchmark = before.benchmarks.get(name);
  const afterBenchmark = after.benchmarks.get(name);
  if (!beforeBenchmark || !afterBenchmark) return null;
  return { before: beforeBenchmark, after: afterBenchmark };
}

console.log("# Lean VIR benchmark comparison");
console.log(`before: ${benchmarkReportLabel(before)} (${before.path})`);
console.log(`after:  ${benchmarkReportLabel(after)} (${after.path})`);
console.log();

const beforeNames = [...before.benchmarks.keys()];
const afterNames = [...after.benchmarks.keys()];
const afterNameSet = new Set(afterNames);
const beforeNameSet = new Set(beforeNames);
const names = beforeNames.filter((name) => afterNameSet.has(name));
if (names.length === 0) {
  throw new Error("benchmark reports have no benchmark names in common");
}

for (const name of names) {
  const pair = requireBenchmarkPair(name);
  console.log(pair.after.title ?? pair.before.title ?? name);
  const sampleNames = benchmarkSampleNamesForReports([before, after], name);
  for (const sampleName of sampleNames) {
    printOptionalBenchmarkSampleComparison(
      name,
      sampleName,
      pair.before[sampleName] ?? null,
      pair.after[sampleName] ?? null,
    );
  }
  const beforeRatio = pair.before.ratioWasmToHost;
  const afterRatio = pair.after.ratioWasmToHost;
  if (typeof beforeRatio === "number" && typeof afterRatio === "number") {
    const deltaPct = ((afterRatio - beforeRatio) / beforeRatio) * 100;
    const sign = deltaPct >= 0 ? "+" : "";
    console.log(`  wasm/host ratio: ${beforeRatio.toFixed(1)}x -> ${afterRatio.toFixed(1)}x (${sign}${deltaPct.toFixed(1)}%)`);
  }
  console.log();
}

printSideOnlyBenchmarkSummaries("before", [before], beforeNames.filter((name) => !afterNameSet.has(name)));
printSideOnlyBenchmarkSummaries("after", [after], afterNames.filter((name) => !beforeNameSet.has(name)));
