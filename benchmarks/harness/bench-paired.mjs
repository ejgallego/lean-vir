/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assertComparableBenchmarkReportIdentities,
  benchmarkCacheArgs,
  benchmarkCacheOptionDefaults,
  benchmarkNamesForReports,
  benchmarkReportLabel,
  benchmarkSamplePerCallMs,
  benchmarkSampleNamesForReports,
  parseBenchmarkCacheOption,
  parsePositiveInt,
  printOptionalBenchmarkSampleComparison,
  printSideOnlyBenchmarkSummaries,
  readBenchmarkReport,
  requireOptionValue,
  median,
  summarizeOptionalBenchmarkSampleReports,
  validateBenchmarkCacheOptions,
} from "./bench-utils.mjs";
import { pairedBenchmarkSchedule, pairedPercentDeltas } from "./bench-paired-schedule.mjs";
import { runSync } from "../../scripts/process-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const before = await requireCheckout("before", args.beforePath, args.npmScript);
const after = await requireCheckout("after", args.afterPath, args.npmScript);

await requireMissingPath(args.outDir, "paired benchmark output directory");
await mkdir(args.outDir, { recursive: true });

const sides = { before, after };
const scheduledRuns = [];
for (const scheduled of pairedBenchmarkSchedule(args.repeat)) {
  const side = sides[scheduled.side];
  const reportPath = runBench(side, scheduled.pass - 1, args, scheduled);
  scheduledRuns.push({ ...scheduled, reportPath });
  await writeSchedule(args, before, after, scheduledRuns, "in-progress");
}
await writeSchedule(args, before, after, scheduledRuns, "completed");

const beforeReports = await readReports(before);
const afterReports = await readReports(after);
assertComparableBenchmarkReportIdentities([
  ...beforeReports.map((report, index) => ({ label: `before run ${index + 1}`, report })),
  ...afterReports.map((report, index) => ({ label: `after run ${index + 1}`, report })),
]);
printSummary(before, beforeReports, after, afterReports, args);

function parseArgs(argv) {
  const parsed = {
    ...benchmarkCacheOptionDefaults(),
    beforePath: null,
    benchmarkArgs: [],
    afterPath: null,
    outDir: "build/perf/paired",
    npmScript: "bench",
    repeat: 6,
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repeat") {
      parsed.repeat = parsePositiveInt(requireOptionValue(argv, ++index, "--repeat"), "--repeat");
    } else if (arg.startsWith("--repeat=")) {
      parsed.repeat = parsePositiveInt(arg.slice("--repeat=".length), "--repeat");
    } else if (arg === "--npm-script") {
      parsed.npmScript = requireOptionValue(argv, ++index, "--npm-script");
    } else if (arg.startsWith("--npm-script=")) {
      parsed.npmScript = arg.slice("--npm-script=".length);
    } else if (arg === "--bench-arg") {
      parsed.benchmarkArgs.push(requireOptionValue(argv, ++index, "--bench-arg"));
    } else if (arg.startsWith("--bench-arg=")) {
      parsed.benchmarkArgs.push(arg.slice("--bench-arg=".length));
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
  if (!/^[A-Za-z0-9:_-]+$/.test(parsed.npmScript)) {
    throw new Error("--npm-script requires an npm script name");
  }
  if (parsed.benchmarkArgs.some((arg) => arg === "" || arg === "--json" || arg.startsWith("--json="))) {
    throw new Error("--bench-arg must be nonempty and cannot supply --json");
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
    "  --repeat N                    run N AB/BA passes (default: 6; use an even count for balance)",
    "  --npm-script NAME             npm benchmark script in each checkout (default: bench)",
    "  --bench-arg ARG               pass ARG to the selected benchmark (repeatable)",
    "  --out DIR                     write per-run reports under DIR (default: build/perf/paired)",
    "  --artifact-cache DIR          pass an explicit artifact cache to each benchmark run",
    "  --no-artifact-cache           rebuild inputs without cache restore/store",
    "  --refresh-artifact-cache      rebuild and replace each checkout's current cache entry",
    "",
    "The output directory must not already exist. Each checkout must support",
    "`npm run NAME -- --json PATH` for the selected npm script.",
  ].join("\n"));
}

async function requireCheckout(label, path, npmScript) {
  const checkoutPath = resolve(path);
  const packageJsonPath = join(checkoutPath, "package.json");
  await requirePath(packageJsonPath, `${label} checkout package.json`);
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (typeof packageJson.scripts?.[npmScript] !== "string") {
    throw new Error(`${label} checkout has no npm script ${npmScript}: ${checkoutPath}`);
  }
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

async function requireMissingPath(path, description) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${description} already exists: ${path}`);
}

function runBench(side, index, args, scheduled) {
  const runNumber = index + 1;
  const reportPath = join(args.outDir, `${side.label}-${String(runNumber).padStart(2, "0")}.json`);
  console.log();
  console.log(
    `# pass ${runNumber}/${args.repeat} ${scheduled.sequence}.${scheduled.position}: ` +
    `${side.label} benchmark`,
  );
  console.log(`checkout: ${side.path}`);
  runSync("npm", [
    "run",
    args.npmScript,
    "--",
    "--json",
    reportPath,
    ...benchmarkCacheArgs(args),
    ...args.benchmarkArgs,
  ], {
    cwd: side.path,
  });
  side.reportPaths.push(reportPath);
  return reportPath;
}

async function writeSchedule(args, before, after, runs, status) {
  const schedule = {
    schema: "lean-vir.paired-bench.v1",
    updatedAt: new Date().toISOString(),
    status,
    npmScript: args.npmScript,
    benchmarkArgs: args.benchmarkArgs,
    passCount: args.repeat,
    orderBalanced: args.repeat % 2 === 0,
    before: { path: before.path },
    after: { path: after.path },
    runs,
  };
  await writeFile(join(args.outDir, "schedule.json"), `${JSON.stringify(schedule, null, 2)}\n`);
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
  console.log(
    `runs:   ${args.repeat} AB/BA pass(es), median per-call time` +
    (args.repeat % 2 === 0 ? "" : " (screening only: order is not balanced)"),
  );
  console.log(`script: npm run ${args.npmScript}`);
  console.log(`output: ${args.outDir}`);
  console.log();

  for (const name of benchmarkNames) {
    const beforeBenchmark = beforeReports[0].benchmarks.get(name);
    const afterBenchmark = afterReports[0].benchmarks.get(name);
    console.log(afterBenchmark.title ?? beforeBenchmark.title ?? name);
    const sampleNames = benchmarkSampleNamesForReports([...beforeReports, ...afterReports], name);
    for (const sampleName of sampleNames) {
      const beforeSummary = summarizeOptionalBenchmarkSampleReports(name, sampleName, beforeReports);
      const afterSummary = summarizeOptionalBenchmarkSampleReports(name, sampleName, afterReports);
      printOptionalBenchmarkSampleComparison(
        name,
        sampleName,
        beforeSummary,
        afterSummary,
      );
      printPairedDeltas(name, sampleName, beforeReports, afterReports, beforeSummary, afterSummary);
    }
    console.log();
  }
  printSideOnlyBenchmarkSummaries(beforeSide.label, beforeReports, beforeOnlyNames);
  printSideOnlyBenchmarkSummaries(afterSide.label, afterReports, afterOnlyNames);
}

function printPairedDeltas(
    benchmarkName,
    sampleName,
    beforeReports,
    afterReports,
    beforeSummary,
    afterSummary) {
  if (beforeSummary === null || afterSummary === null) return;
  const beforeValues = beforeReports.map((report) =>
    benchmarkSamplePerCallMs(report.benchmarks.get(benchmarkName)[sampleName]),
  );
  const afterValues = afterReports.map((report) =>
    benchmarkSamplePerCallMs(report.benchmarks.get(benchmarkName)[sampleName]),
  );
  const deltas = pairedPercentDeltas(beforeValues, afterValues);
  const formatted = deltas.map((delta) => `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`);
  const medianDelta = median(deltas);
  console.log(
    `    paired pass deltas: ${formatted.join(", ")} ` +
    `(median ${medianDelta >= 0 ? "+" : ""}${medianDelta.toFixed(1)}%)`,
  );
}
