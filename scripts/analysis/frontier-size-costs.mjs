#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { validateSurfaceSizeLinks } from "./surface-report-schema.mjs";

const DEFAULT_ARTIFACT = "web/public/vir-upstream.wasm";
const DEFAULT_OUTPUT_PREFIX = "build/frontier-size-costs/report";

function usage() {
  console.log(`Usage: node scripts/analysis/frontier-size-costs.mjs [options] [EXTERN ...]

Measure exact stripped-Wasm size deltas for missing native externs or clusters.
Each candidate uses the normal wrapper generator, registry, strict link, strip,
and deterministic gzip pipeline. Browser package generation is skipped.

Options:
  --plan PATH           JSON candidate plan; may be combined with EXTERN names.
  --surface-links PATH  Surface report data/size-links.json for blocker pressure.
  --output-prefix PATH  Output path without extension.
                        Default: ${DEFAULT_OUTPUT_PREFIX}
  -h, --help            Show this help.

Plan format:
  {"version":1,"candidates":[{"id":"float-basic","names":["Float.add"]}]}
`);
}

function parseArgs(argv) {
  const externs = [];
  let planPath = null;
  let surfaceLinksPath = null;
  let outputPrefix = DEFAULT_OUTPUT_PREFIX;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--plan" || arg === "--surface-links" || arg === "--output-prefix") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--plan") planPath = value;
      if (arg === "--surface-links") surfaceLinksPath = value;
      if (arg === "--output-prefix") outputPrefix = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    externs.push(arg);
  }
  return { help: false, externs, planPath, surfaceLinksPath, outputPrefix };
}

function readPlan(path) {
  const plan = JSON.parse(readFileSync(path, "utf8"));
  if (plan.version !== 1 || !Array.isArray(plan.candidates)) {
    throw new Error(`${path}: expected a version 1 frontier-size candidate plan`);
  }
  return plan.candidates.map((candidate, index) => normalizeCandidate(candidate, `${path} candidate ${index}`));
}

export function normalizeCandidate(candidate, label) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${label}: candidate must be an object`);
  }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    throw new Error(`${label}: id must be a non-empty string`);
  }
  if (!Array.isArray(candidate.names) || candidate.names.length === 0 ||
      candidate.names.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error(`${label}: names must be a non-empty string array`);
  }
  const names = [...new Set(candidate.names)];
  if (names.length !== candidate.names.length) throw new Error(`${label}: names must be unique`);
  return { id: candidate.id, names };
}

function loadCandidates(args) {
  const candidates = args.planPath ? readPlan(args.planPath) : [];
  candidates.push(...args.externs.map((name) => ({ id: name, names: [name] })));
  if (candidates.length === 0) throw new Error("provide at least one EXTERN or --plan");
  const ids = new Set();
  const isolatedNames = new Set();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new Error(`duplicate candidate id ${candidate.id}`);
    ids.add(candidate.id);
    if (candidate.names.length === 1) {
      const [name] = candidate.names;
      if (isolatedNames.has(name)) throw new Error(`duplicate isolated candidate ${name}`);
      isolatedNames.add(name);
    }
  }
  return candidates;
}

function readSurfaceLinks(path) {
  if (!path) return new Map();
  const report = validateSurfaceSizeLinks(JSON.parse(readFileSync(path, "utf8")), { label: path });
  return new Map(report.externs.map((entry) => [entry.name, entry]));
}

export function validateFrontierCostReport(report, label = "frontier size report") {
  if (report?.format !== "lean-vir-frontier-size-costs" || report.version !== 1 ||
      !report.baseline || !Array.isArray(report.candidates)) {
    throw new Error(`${label}: expected lean-vir-frontier-size-costs version 1`);
  }
  if (!Number.isSafeInteger(report.baseline.rawBytes) ||
      !Number.isSafeInteger(report.baseline.gzipBytes) ||
      typeof report.baseline.sha256 !== "string") {
    throw new Error(`${label}: invalid baseline sizes or SHA-256`);
  }
  const isolatedNames = new Set();
  for (const [index, candidate] of report.candidates.entries()) {
    normalizeCandidate(candidate, `${label} candidate ${index}`);
    if (candidate.names.length === 1) {
      const [name] = candidate.names;
      if (isolatedNames.has(name)) {
        throw new Error(`${label}: duplicate isolated candidate ${name}`);
      }
      isolatedNames.add(name);
    }
    if (!candidate.error &&
        (!Number.isSafeInteger(candidate.rawDeltaBytes) ||
         !Number.isSafeInteger(candidate.gzipDeltaBytes))) {
      throw new Error(`${label} candidate ${index}: missing exact raw or gzip delta`);
    }
  }
  return report;
}

export function compactFrontierCostReport(report, label) {
  validateFrontierCostReport(report, label);
  return {
    format: report.format,
    version: report.version,
    generatedAt: report.generatedAt,
    baseline: {
      rawBytes: report.baseline.rawBytes,
      gzipBytes: report.baseline.gzipBytes,
      sha256: report.baseline.sha256,
    },
    candidates: report.candidates.map((candidate) => ({
      id: candidate.id,
      names: candidate.names,
      rawDeltaBytes: candidate.rawDeltaBytes,
      gzipDeltaBytes: candidate.gzipDeltaBytes,
      primaryRoots: candidate.primaryRoots ?? 0,
      primaryPublicRoots: candidate.primaryPublicRoots ?? 0,
      error: candidate.error,
    })),
  };
}

export function candidatePressure(candidate, surfaceLinks) {
  let primaryRoots = 0;
  let primaryPublicRoots = 0;
  const targets = [];
  for (const name of candidate.names) {
    const entry = surfaceLinks.get(name);
    if (!entry) continue;
    primaryRoots += entry.primaryRoots ?? 0;
    primaryPublicRoots += entry.primaryPublicRoots ?? 0;
    targets.push(...(entry.targets ?? []));
  }
  return { primaryRoots, primaryPublicRoots, targets: [...new Set(targets)].sort() };
}

function runProbe(extraFile = null) {
  const env = {
    ...process.env,
    VIR_SKIP_PACKAGES: "1",
    VIR_WASM_PROFILE: "release",
  };
  if (extraFile) env.VIR_NATIVE_EXTERN_EXTRAS_FILE = extraFile;
  else delete env.VIR_NATIVE_EXTERN_EXTRAS_FILE;
  const result = spawnSync("bash", ["scripts/build-upstream-probe.sh"], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`upstream probe exited with status ${result.status}`);
}

function gzipSize(path) {
  const result = spawnSync("gzip", ["-9cn", path], { encoding: null });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gzip exited with status ${result.status}`);
  return result.stdout.length;
}

function artifactSize(path = DEFAULT_ARTIFACT) {
  const bytes = readFileSync(path);
  return {
    path,
    rawBytes: statSync(path).size,
    gzipBytes: gzipSize(path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function formatNumber(value, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

export function markdownReport(report) {
  const lines = [
    "# VIR Frontier Size Costs",
    "",
    `- Baseline: ${report.baseline.rawBytes.toLocaleString("en-US")} B raw, ` +
      `${report.baseline.gzipBytes.toLocaleString("en-US")} B gzip`,
    `- Candidates: ${report.candidates.length}`,
    "- Cost model: isolated exact link unless a row explicitly contains multiple names",
    "",
    "Primary-root density is a prioritization hint, not an unlock forecast. Candidate costs are",
    "non-additive when several externs share retained code; measure proposed clusters directly.",
    "",
    "| Candidate | Names | Raw delta | Gzip delta | Primary roots | Public roots | Roots / raw KiB |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const candidate of [...report.candidates].sort((a, b) =>
    (b.primaryRootsPerRawKiB ?? -Infinity) - (a.primaryRootsPerRawKiB ?? -Infinity))) {
    if (candidate.error) {
      lines.push(`| \`${candidate.id}\` | ${candidate.names.length} | error | error | ` +
        `${candidate.primaryRoots} | ${candidate.primaryPublicRoots} | - |`);
      continue;
    }
    lines.push(
      `| \`${candidate.id}\` | ${candidate.names.length} | ` +
      `${candidate.rawDeltaBytes.toLocaleString("en-US")} B | ` +
      `${candidate.gzipDeltaBytes.toLocaleString("en-US")} B | ` +
      `${candidate.primaryRoots.toLocaleString("en-US")} | ` +
      `${candidate.primaryPublicRoots.toLocaleString("en-US")} | ` +
      `${formatNumber(candidate.primaryRootsPerRawKiB)} |`,
    );
  }
  lines.push("", "## Candidate Details", "");
  for (const candidate of report.candidates) {
    lines.push(`### ${candidate.id}`, "", `Names: ${candidate.names.map((name) => `\`${name}\``).join(", ")}`, "");
    if (candidate.targets.length > 0) lines.push(`Native targets: ${candidate.targets.map((target) => `\`${target}\``).join(", ")}`, "");
    if (candidate.error) lines.push(`Error: ${candidate.error}`, "");
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(prefix, report) {
  const jsonPath = `${prefix}.json`;
  const markdownPath = `${prefix}.md`;
  mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, markdownReport(report));
  console.log(`wrote ${resolve(jsonPath)}`);
  console.log(`wrote ${resolve(markdownPath)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const candidates = loadCandidates(args);
  const surfaceLinks = readSurfaceLinks(args.surfaceLinksPath);
  const outputDir = resolve(dirname(`${args.outputPrefix}.json`));
  mkdirSync(outputDir, { recursive: true });
  const extrasPath = resolve(outputDir, "current-extra-externs.txt");

  console.log("frontier size: build baseline");
  runProbe();
  const baseline = artifactSize();
  const results = [];
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const pressure = candidatePressure(candidate, surfaceLinks);
      console.log(`frontier size: candidate ${index + 1}/${candidates.length} ${candidate.id}`);
      writeFileSync(extrasPath, `${candidate.names.join("\n")}\n`);
      try {
        runProbe(extrasPath);
        const artifact = artifactSize();
        const rawDeltaBytes = artifact.rawBytes - baseline.rawBytes;
        const gzipDeltaBytes = artifact.gzipBytes - baseline.gzipBytes;
        results.push({
          ...candidate,
          ...pressure,
          artifact,
          rawDeltaBytes,
          gzipDeltaBytes,
          primaryRootsPerRawKiB: rawDeltaBytes > 0
            ? pressure.primaryRoots / (rawDeltaBytes / 1024)
            : null,
          primaryPublicRootsPerRawKiB: rawDeltaBytes > 0
            ? pressure.primaryPublicRoots / (rawDeltaBytes / 1024)
            : null,
        });
      } catch (error) {
        results.push({
          ...candidate,
          ...pressure,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    console.log("frontier size: restore baseline artifact");
    runProbe();
    const restored = artifactSize();
    if (restored.sha256 !== baseline.sha256) {
      throw new Error(
        `baseline restoration mismatch: expected ${baseline.sha256}, got ${restored.sha256}`,
      );
    }
  }

  writeReport(args.outputPrefix, {
    format: "lean-vir-frontier-size-costs",
    version: 1,
    generatedAt: new Date().toISOString(),
    baseline,
    candidates: results,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    console.error("Run node scripts/analysis/frontier-size-costs.mjs --help for usage.");
    process.exit(1);
  }
}
