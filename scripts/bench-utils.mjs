/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

export function benchmarkCacheOptionDefaults() {
  return {
    artifactCacheEnabled: true,
    artifactCachePath: null,
    refreshArtifactCache: false,
  };
}

export function parseBenchmarkCacheOption(parsed, argv, index) {
  const arg = argv[index];
  if (arg === "--artifact-cache") {
    parsed.artifactCachePath = requireOptionValue(argv, index + 1, "--artifact-cache");
    return index + 1;
  }
  if (arg.startsWith("--artifact-cache=")) {
    parsed.artifactCachePath = arg.slice("--artifact-cache=".length);
    return index;
  }
  if (arg === "--no-artifact-cache") {
    parsed.artifactCacheEnabled = false;
    return index;
  }
  if (arg === "--refresh-artifact-cache") {
    parsed.refreshArtifactCache = true;
    return index;
  }
  return null;
}

export function validateBenchmarkCacheOptions(options) {
  if (options.artifactCachePath === "") {
    throw new Error("--artifact-cache requires a path");
  }
  if (!options.artifactCacheEnabled && options.artifactCachePath !== null) {
    throw new Error("--artifact-cache cannot be combined with --no-artifact-cache");
  }
  if (!options.artifactCacheEnabled && options.refreshArtifactCache) {
    throw new Error("--refresh-artifact-cache cannot be combined with --no-artifact-cache");
  }
}

export function benchmarkCacheArgs(options) {
  const result = [];
  if (!options.artifactCacheEnabled) {
    result.push("--no-artifact-cache");
  }
  if (options.artifactCachePath !== null) {
    result.push("--artifact-cache", options.artifactCachePath);
  }
  if (options.refreshArtifactCache) {
    result.push("--refresh-artifact-cache");
  }
  return result;
}

export function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value === "") {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parsePositiveInt(value, option) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${option} requires a positive integer`);
  }
  return Number(value);
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function formatMs(ms) {
  if (ms < 0.001) return `${(ms * 1000000).toFixed(1)} ns`;
  return ms < 1 ? `${(ms * 1000).toFixed(1)} us` : `${ms.toFixed(2)} ms`;
}

export function parseBenchmarkSamples(stdout, prefix) {
  const byLabel = new Map();
  for (const line of stdout.split("\n")) {
    const match = new RegExp(`^${prefix} (\\S+) (\\d+) (\\d+) (\\d+)$`).exec(line.trim());
    if (!match) continue;
    const label = match[1];
    const sample = byLabel.get(label) ?? {
      label,
      iterations: Number(match[2]),
      checksum: Number(match[3]),
      samples: [],
    };
    sample.iterations = Number(match[2]);
    sample.checksum = Number(match[3]);
    sample.samples.push(Number(match[4]) / 1_000_000);
    byLabel.set(label, sample);
  }
  for (const sample of byLabel.values()) {
    sample.medianMs = median(sample.samples);
  }
  return byLabel;
}

export function requireBenchmarkSample(stdout, prefix, label, description = prefix) {
  const sample = parseBenchmarkSamples(stdout, prefix).get(label);
  if (!sample) {
    throw new Error(`no ${description} benchmark samples found for ${label}`);
  }
  return sample;
}

export async function readBenchmarkReport(path, label = "benchmark") {
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

export function benchmarkReportLabel(side) {
  const git = side.report.git ?? {};
  const ref = git.ref && git.ref !== "HEAD" ? git.ref : "detached";
  const commit = typeof git.commit === "string" ? git.commit.slice(0, 12) : "unknown";
  const dirty = git.dirty ? " dirty" : "";
  return `${ref}@${commit}${dirty}`;
}

export function benchmarkSamplePerCallMs(sample) {
  return sample.perCallMs ?? sample.medianMs / sample.iterations;
}

export function benchmarkSampleNames(benchmark) {
  return Object.entries(benchmark)
    .filter(([, value]) => isBenchmarkSample(value))
    .map(([name]) => name);
}

export function benchmarkSampleNamesForReports(reports, benchmarkName) {
  return [
    ...new Set(reports.flatMap((report) =>
      benchmarkSampleNames(report.benchmarks.get(benchmarkName) ?? {}),
    )),
  ];
}

export function benchmarkNamesForReports(sideLabel, reports) {
  const names = [...new Set(reports.flatMap((report) => [...report.benchmarks.keys()]))];
  for (const name of names) {
    const missingIndex = reports.findIndex((report) => !report.benchmarks.has(name));
    if (missingIndex !== -1) {
      throw new Error(`${sideLabel} benchmark ${name} is missing from run ${missingIndex + 1}`);
    }
  }
  return names;
}

export function summarizeBenchmarkSampleReports(benchmarkName, sampleName, reports) {
  const summary = summarizeOptionalBenchmarkSampleReports(benchmarkName, sampleName, reports);
  if (summary === null) {
    throw new Error(`${benchmarkName}: missing ${sampleName} sample in one or more reports`);
  }
  return summary;
}

export function summarizeOptionalBenchmarkSampleReports(benchmarkName, sampleName, reports) {
  const samples = reports.map((report) => report.benchmarks.get(benchmarkName)?.[sampleName] ?? null);
  if (samples.every((sample) => sample === null)) return null;
  if (samples.some((sample) => sample === null)) {
    throw new Error(`${benchmarkName}: ${sampleName} sample is present in only some reports`);
  }
  return summarizeBenchmarkSamples(benchmarkName, sampleName, samples);
}

export function printOptionalBenchmarkSampleComparison(benchmarkName, sampleName, before, after) {
  if (before === null && after === null) return;
  if (before === null || after === null) {
    console.log(`  ${sampleName}: missing on one side`);
    return;
  }
  console.log(formatBenchmarkSampleComparison(benchmarkName, sampleName, before, after));
}

export function printSideOnlyBenchmarkSummaries(sideLabel, reports, benchmarkNames) {
  if (benchmarkNames.length === 0) return;
  console.log(`${sideLabel}-only benchmark rows`);
  console.log(`Rows present only in ${sideLabel} reports; no before/after delta is available.`);
  console.log();
  for (const name of benchmarkNames) {
    const benchmark = reports[0].benchmarks.get(name);
    console.log(benchmark.title ?? name);
    const sampleNames = benchmarkSampleNamesForReports(reports, name);
    for (const sampleName of sampleNames) {
      console.log(formatBenchmarkSampleSummary(
        name,
        sampleName,
        summarizeBenchmarkSampleReports(name, sampleName, reports),
      ));
    }
    console.log();
  }
}

function summarizeBenchmarkSamples(benchmarkName, sampleName, samples) {
  const first = samples[0];
  for (const sample of samples.slice(1)) {
    assertComparableBenchmarkSamples(benchmarkName, sampleName, first, sample, " across repeated reports");
  }
  return {
    iterations: first.iterations,
    checksum: first.checksum,
    perCallMs: median(samples.map(benchmarkSamplePerCallMs)),
  };
}

function formatBenchmarkSampleComparison(benchmarkName, sampleName, before, after) {
  assertComparableBenchmarkSamples(benchmarkName, sampleName, before, after);
  const beforePerCallMs = benchmarkSamplePerCallMs(before);
  const afterPerCallMs = benchmarkSamplePerCallMs(after);
  const deltaPct = ((afterPerCallMs - beforePerCallMs) / beforePerCallMs) * 100;
  const sign = deltaPct >= 0 ? "+" : "";
  const speed = beforePerCallMs / afterPerCallMs;
  return `  ${sampleName}: ${formatMs(beforePerCallMs)} -> ` +
    `${formatMs(afterPerCallMs)} / call (${sign}${deltaPct.toFixed(1)}%, ` +
    `${speed.toFixed(2)}x speed)`;
}

function formatBenchmarkSampleSummary(benchmarkName, sampleName, sample) {
  if (sample.iterations === 0) {
    throw new Error(`${benchmarkName} ${sampleName}: iteration count must be positive`);
  }
  return `  ${sampleName}: ${formatMs(benchmarkSamplePerCallMs(sample))} / call ` +
    `(${sample.iterations} iterations, checksum ${sample.checksum})`;
}

function assertComparableBenchmarkSamples(benchmarkName, sampleName, before, after, context = "") {
  if (before.iterations !== after.iterations) {
    throw new Error(
      `${benchmarkName} ${sampleName}: iteration mismatch${context} ` +
        `${before.iterations} vs ${after.iterations}`,
    );
  }
  if (before.checksum !== after.checksum) {
    throw new Error(
      `${benchmarkName} ${sampleName}: checksum mismatch${context} ` +
        `${before.checksum} vs ${after.checksum}`,
    );
  }
}

function isBenchmarkSample(value) {
  return value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.iterations) &&
    Number.isFinite(value.checksum) &&
    Number.isFinite(value.medianMs);
}
