/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  benchmarkReportLabel,
  benchmarkSampleNames,
  benchmarkSamplePerCallMs,
  formatMs,
  median,
  readBenchmarkReport,
} from "./bench-utils.mjs";
import { runSync } from "./process-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const before = await requireCheckout("before", args.beforePath);
const after = await requireCheckout("after", args.afterPath);

await mkdir(args.outDir, { recursive: true });

for (let index = 0; index < args.repeat; index += 1) {
  runBench(before, index, args);
  runBench(after, index, args);
}

const beforeReports = await readReports(before);
const afterReports = await readReports(after);
printSummary(before, beforeReports, after, afterReports, args);

function parseArgs(argv) {
  const parsed = {
    artifactCacheEnabled: true,
    artifactCachePath: null,
    beforePath: null,
    afterPath: null,
    outDir: "build/perf/paired",
    refreshArtifactCache: false,
    repeat: 5,
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repeat") {
      parsed.repeat = parsePositiveInt(requireOptionValue(argv, ++index, "--repeat"), "--repeat");
    } else if (arg.startsWith("--repeat=")) {
      parsed.repeat = parsePositiveInt(arg.slice("--repeat=".length), "--repeat");
    } else if (arg === "--out") {
      parsed.outDir = requireOptionValue(argv, ++index, "--out");
    } else if (arg.startsWith("--out=")) {
      parsed.outDir = arg.slice("--out=".length);
    } else if (arg === "--artifact-cache") {
      parsed.artifactCachePath = requireOptionValue(argv, ++index, "--artifact-cache");
    } else if (arg.startsWith("--artifact-cache=")) {
      parsed.artifactCachePath = arg.slice("--artifact-cache=".length);
    } else if (arg === "--no-artifact-cache") {
      parsed.artifactCacheEnabled = false;
    } else if (arg === "--refresh-artifact-cache") {
      parsed.refreshArtifactCache = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown paired benchmark argument: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 2) {
    printUsage();
    process.exit(1);
  }
  if (parsed.outDir === "") {
    throw new Error("--out requires a path");
  }
  if (parsed.artifactCachePath === "") {
    throw new Error("--artifact-cache requires a path");
  }
  if (!parsed.artifactCacheEnabled && parsed.artifactCachePath !== null) {
    throw new Error("--artifact-cache cannot be combined with --no-artifact-cache");
  }
  if (!parsed.artifactCacheEnabled && parsed.refreshArtifactCache) {
    throw new Error("--refresh-artifact-cache cannot be combined with --no-artifact-cache");
  }
  parsed.beforePath = positionals[0];
  parsed.afterPath = positionals[1];
  parsed.outDir = resolve(parsed.outDir);
  if (parsed.artifactCachePath !== null) {
    parsed.artifactCachePath = resolve(parsed.artifactCachePath);
  }
  return parsed;
}

function printUsage() {
  console.log([
    "usage: npm run bench:paired -- [options] BEFORE_CHECKOUT AFTER_CHECKOUT",
    "",
    "options:",
    "  --repeat N                    run N alternating benchmark pairs (default: 5)",
    "  --out DIR                     write per-run reports under DIR (default: build/perf/paired)",
    "  --artifact-cache DIR          pass an explicit artifact cache to each benchmark run",
    "  --no-artifact-cache           rebuild inputs without cache restore/store",
    "  --refresh-artifact-cache      rebuild and replace each checkout's current cache entry",
    "",
    "Each checkout must support `npm run bench -- --json PATH`.",
  ].join("\n"));
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value === "") {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePositiveInt(value, option) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${option} requires a positive integer`);
  }
  return Number(value);
}

async function requireCheckout(label, path) {
  const checkoutPath = resolve(path);
  await requirePath(join(checkoutPath, "package.json"), `${label} checkout package.json`);
  await requirePath(join(checkoutPath, "scripts", "bench-vir.mjs"), `${label} checkout benchmark script`);
  return {
    label,
    path: checkoutPath,
    reportPaths: [],
  };
}

async function requirePath(path, description) {
  try {
    await stat(path);
  } catch {
    throw new Error(`missing ${description}: ${path}`);
  }
}

function benchArgs(args) {
  const result = [];
  if (!args.artifactCacheEnabled) {
    result.push("--no-artifact-cache");
  }
  if (args.artifactCachePath !== null) {
    result.push("--artifact-cache", args.artifactCachePath);
  }
  if (args.refreshArtifactCache) {
    result.push("--refresh-artifact-cache");
  }
  return result;
}

function runBench(side, index, args) {
  const runNumber = index + 1;
  const reportPath = join(args.outDir, `${side.label}-${String(runNumber).padStart(2, "0")}.json`);
  console.log();
  console.log(`# ${side.label} benchmark ${runNumber}/${args.repeat}`);
  console.log(`checkout: ${side.path}`);
  runSync("npm", ["run", "bench", "--", "--json", reportPath, ...benchArgs(args)], {
    cwd: side.path,
  });
  side.reportPaths.push(reportPath);
}

async function readReports(side) {
  return Promise.all(
    side.reportPaths.map((reportPath, index) =>
      readBenchmarkReport(reportPath, `${side.label} run ${index + 1}`),
    ),
  );
}

function printSummary(beforeSide, beforeReports, afterSide, afterReports, args) {
  const allReports = [...beforeReports, ...afterReports];
  const benchmarkNames = [...allReports[0].benchmarks.keys()].filter((name) =>
    allReports.every((report) => report.benchmarks.has(name)),
  );
  if (benchmarkNames.length === 0) {
    throw new Error("paired benchmark reports have no benchmark names in common");
  }

  console.log();
  console.log("# Lean VIR paired benchmark");
  console.log(`before: ${benchmarkReportLabel(beforeReports[0])} (${beforeSide.path})`);
  console.log(`after:  ${benchmarkReportLabel(afterReports[0])} (${afterSide.path})`);
  console.log(`runs:   ${args.repeat} alternating pair(s), median per-call time`);
  console.log(`output: ${args.outDir}`);
  console.log();

  for (const name of benchmarkNames) {
    const beforeBenchmark = beforeReports[0].benchmarks.get(name);
    const afterBenchmark = afterReports[0].benchmarks.get(name);
    console.log(afterBenchmark.title ?? beforeBenchmark.title ?? name);
    const sampleNames = benchmarkSampleNamesForReports([...beforeReports, ...afterReports], name);
    for (const sampleName of sampleNames) {
      compareOptionalSampleSummaries(
        name,
        sampleName,
        summarizeOptionalSample(name, sampleName, beforeReports),
        summarizeOptionalSample(name, sampleName, afterReports),
      );
    }
    console.log();
  }
}

function benchmarkSampleNamesForReports(reports, benchmarkName) {
  return [
    ...new Set(reports.flatMap((report) =>
      benchmarkSampleNames(report.benchmarks.get(benchmarkName) ?? {}),
    )),
  ];
}

function summarizeSample(benchmarkName, sampleName, reports) {
  const samples = reports.map((report) => report.benchmarks.get(benchmarkName)?.[sampleName] ?? null);
  if (samples.some((sample) => sample === null)) {
    throw new Error(`${benchmarkName}: missing ${sampleName} sample in one or more reports`);
  }
  return summarizeSamples(benchmarkName, sampleName, samples);
}

function summarizeOptionalSample(benchmarkName, sampleName, reports) {
  const samples = reports.map((report) => report.benchmarks.get(benchmarkName)?.[sampleName] ?? null);
  if (samples.every((sample) => sample === null)) return null;
  if (samples.some((sample) => sample === null)) {
    throw new Error(`${benchmarkName}: ${sampleName} sample is present in only some reports`);
  }
  return summarizeSamples(benchmarkName, sampleName, samples);
}

function summarizeSamples(benchmarkName, sampleName, samples) {
  const first = samples[0];
  for (const sample of samples.slice(1)) {
    if (sample.iterations !== first.iterations) {
      throw new Error(
        `${benchmarkName} ${sampleName}: iteration mismatch across repeated reports ` +
          `${first.iterations} vs ${sample.iterations}`,
      );
    }
    if (sample.checksum !== first.checksum) {
      throw new Error(
        `${benchmarkName} ${sampleName}: checksum mismatch across repeated reports ` +
          `${first.checksum} vs ${sample.checksum}`,
      );
    }
  }
  return {
    iterations: first.iterations,
    checksum: first.checksum,
    perCallMs: median(samples.map(benchmarkSamplePerCallMs)),
  };
}

function compareOptionalSampleSummaries(benchmarkName, sampleName, before, after) {
  if (before === null && after === null) return;
  if (before === null || after === null) {
    console.log(`  ${sampleName}: missing on one side`);
    return;
  }
  compareSampleSummaries(benchmarkName, sampleName, before, after);
}

function compareSampleSummaries(benchmarkName, sampleName, before, after) {
  if (before.iterations !== after.iterations) {
    throw new Error(
      `${benchmarkName} ${sampleName}: iteration mismatch ` +
        `${before.iterations} vs ${after.iterations}`,
    );
  }
  if (before.checksum !== after.checksum) {
    throw new Error(
      `${benchmarkName} ${sampleName}: checksum mismatch ` +
        `${before.checksum} vs ${after.checksum}`,
    );
  }
  const deltaPct = ((after.perCallMs - before.perCallMs) / before.perCallMs) * 100;
  const sign = deltaPct >= 0 ? "+" : "";
  const speed = before.perCallMs / after.perCallMs;
  console.log(
    `  ${sampleName}: ${formatMs(before.perCallMs)} -> ` +
      `${formatMs(after.perCallMs)} / call (${sign}${deltaPct.toFixed(1)}%, ` +
      `${speed.toFixed(2)}x speed)`,
  );
}
