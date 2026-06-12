/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { formatMs } from "./bench-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const before = await readReport(args.beforePath, "before");
const after = await readReport(args.afterPath, "after");

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

async function readReport(path, label) {
  const report = JSON.parse(await readFile(path, "utf8"));
  if (report?.schema !== "lean-vir.bench.v1") {
    throw new Error(`${label} report ${path} is not a lean-vir.bench.v1 report`);
  }
  if (!Array.isArray(report.benchmarks)) {
    throw new Error(`${label} report ${path} is missing benchmarks`);
  }
  return {
    path,
    report,
    benchmarks: new Map(report.benchmarks.map((benchmark) => [benchmark.name, benchmark])),
  };
}

function reportLabel(side) {
  const git = side.report.git ?? {};
  const ref = git.ref && git.ref !== "HEAD" ? git.ref : "detached";
  const commit = typeof git.commit === "string" ? git.commit.slice(0, 12) : "unknown";
  const dirty = git.dirty ? " dirty" : "";
  return `${ref}@${commit}${dirty}`;
}

function requireBenchmarkPair(name) {
  const beforeBenchmark = before.benchmarks.get(name);
  const afterBenchmark = after.benchmarks.get(name);
  if (!beforeBenchmark || !afterBenchmark) return null;
  return { before: beforeBenchmark, after: afterBenchmark };
}

function compareSample(benchmarkName, sampleName, beforeSample, afterSample) {
  if (!beforeSample || !afterSample) {
    throw new Error(`${benchmarkName}: missing ${sampleName} sample`);
  }
  if (beforeSample.iterations !== afterSample.iterations) {
    throw new Error(
      `${benchmarkName} ${sampleName}: iteration mismatch ` +
        `${beforeSample.iterations} vs ${afterSample.iterations}`,
    );
  }
  if (beforeSample.checksum !== afterSample.checksum) {
    throw new Error(
      `${benchmarkName} ${sampleName}: checksum mismatch ` +
        `${beforeSample.checksum} vs ${afterSample.checksum}`,
    );
  }
  const deltaPct = ((afterSample.perCallMs - beforeSample.perCallMs) / beforeSample.perCallMs) * 100;
  const sign = deltaPct >= 0 ? "+" : "";
  const speed = beforeSample.perCallMs / afterSample.perCallMs;
  console.log(
    `  ${sampleName}: ${formatMs(beforeSample.perCallMs)} -> ` +
      `${formatMs(afterSample.perCallMs)} / call (${sign}${deltaPct.toFixed(1)}%, ` +
      `${speed.toFixed(2)}x speed)`,
  );
}

function compareOptionalSample(benchmarkName, sampleName, beforeSample, afterSample) {
  if (!beforeSample && !afterSample) return;
  if (!beforeSample || !afterSample) {
    console.log(`  ${sampleName}: missing on one side`);
    return;
  }
  compareSample(benchmarkName, sampleName, beforeSample, afterSample);
}

console.log("# Lean VIR benchmark comparison");
console.log(`before: ${reportLabel(before)} (${before.path})`);
console.log(`after:  ${reportLabel(after)} (${after.path})`);
console.log();

const names = [...before.benchmarks.keys()].filter((name) => after.benchmarks.has(name));
if (names.length === 0) {
  throw new Error("benchmark reports have no benchmark names in common");
}

for (const name of names) {
  const pair = requireBenchmarkPair(name);
  console.log(pair.after.title ?? pair.before.title ?? name);
  compareSample(name, "wasm", pair.before.wasm, pair.after.wasm);
  compareOptionalSample(name, "host", pair.before.host, pair.after.host);
  const beforeRatio = pair.before.ratioWasmToHost;
  const afterRatio = pair.after.ratioWasmToHost;
  if (typeof beforeRatio === "number" && typeof afterRatio === "number") {
    const deltaPct = ((afterRatio - beforeRatio) / beforeRatio) * 100;
    const sign = deltaPct >= 0 ? "+" : "";
    console.log(`  wasm/host ratio: ${beforeRatio.toFixed(1)}x -> ${afterRatio.toFixed(1)}x (${sign}${deltaPct.toFixed(1)}%)`);
  }
  console.log();
}
