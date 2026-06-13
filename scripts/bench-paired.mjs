/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  benchmarkCacheArgs,
  benchmarkCacheOptionDefaults,
  benchmarkNamesForReports,
  benchmarkReportLabel,
  benchmarkSampleNamesForReports,
  parseBenchmarkCacheOption,
  parsePositiveInt,
  printOptionalBenchmarkSampleComparison,
  printSideOnlyBenchmarkSummaries,
  readBenchmarkReport,
  requireOptionValue,
  summarizeOptionalBenchmarkSampleReports,
  validateBenchmarkCacheOptions,
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
    ...benchmarkCacheOptionDefaults(),
    beforePath: null,
    afterPath: null,
    outDir: "build/perf/paired",
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
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      const nextIndex = parseBenchmarkCacheOption(parsed, argv, index);
      if (nextIndex !== null) {
        index = nextIndex;
        continue;
      }
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
  validateBenchmarkCacheOptions(parsed);
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

function runBench(side, index, args) {
  const runNumber = index + 1;
  const reportPath = join(args.outDir, `${side.label}-${String(runNumber).padStart(2, "0")}.json`);
  console.log();
  console.log(`# ${side.label} benchmark ${runNumber}/${args.repeat}`);
  console.log(`checkout: ${side.path}`);
  runSync("npm", ["run", "bench", "--", "--json", reportPath, ...benchmarkCacheArgs(args)], {
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
  const beforeNames = benchmarkNamesForReports(beforeSide.label, beforeReports);
  const afterNames = benchmarkNamesForReports(afterSide.label, afterReports);
  const beforeNameSet = new Set(beforeNames);
  const afterNameSet = new Set(afterNames);
  const benchmarkNames = beforeNames.filter((name) => afterNameSet.has(name));
  const beforeOnlyNames = beforeNames.filter((name) => !afterNameSet.has(name));
  const afterOnlyNames = afterNames.filter((name) => !beforeNameSet.has(name));
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
      printOptionalBenchmarkSampleComparison(
        name,
        sampleName,
        summarizeOptionalBenchmarkSampleReports(name, sampleName, beforeReports),
        summarizeOptionalBenchmarkSampleReports(name, sampleName, afterReports),
      );
    }
    console.log();
  }
  printSideOnlyBenchmarkSummaries(beforeSide.label, beforeReports, beforeOnlyNames);
  printSideOnlyBenchmarkSummaries(afterSide.label, afterReports, afterOnlyNames);
}
