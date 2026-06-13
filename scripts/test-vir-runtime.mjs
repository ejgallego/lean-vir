/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";

import { runAsync } from "./process-utils.mjs";

const root = new URL("..", import.meta.url).pathname;

const tests = [
  { id: "manifest", file: "scripts/runtime-tests/manifest-smoke.mjs" },
  { id: "host-bindings", file: "scripts/runtime-tests/host-bindings-smoke.mjs" },
  { id: "react-host-bindings", file: "scripts/runtime-tests/react-host-bindings-smoke.mjs" },
  { id: "value-codec", file: "scripts/runtime-tests/value-codec-smoke.mjs" },
  { id: "package-generation", file: "scripts/runtime-tests/package-generation-smoke.mjs" },
  { id: "sdk-import", file: "scripts/runtime-tests/sdk-import-smoke.mjs" },
];

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage: node scripts/test-vir-runtime.mjs [filter ...]

Run JavaScript runtime smoke tests.

Arguments:
  filter          Case-insensitive substring matched against runtime test id
                  and file path. When omitted, all runtime smoke tests run.

Options:
  --list          Print runtime test ids.
  -h, --help      Show this help.

Environment:
  VIR_RUNTIME_TEST_FILTER  Comma-separated filters, combined with positional filters.
  VIR_RUNTIME_JOBS         Positive integer worker limit.
  VIR_RUNTIME_VERBOSE      Set to 1 to print passing subtest output.
`);
}

if (args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

if (args.includes("--list")) {
  for (const test of tests) {
    console.log(`${test.id}\t${test.file}`);
  }
  process.exit(0);
}

for (const arg of args) {
  if (arg.startsWith("--")) {
    throw new Error(`unknown argument: ${arg}; run node scripts/test-vir-runtime.mjs --help`);
  }
}

function runtimeFilters() {
  const envFilters = (process.env.VIR_RUNTIME_TEST_FILTER ?? "")
    .split(",")
    .map((filter) => filter.trim())
    .filter(Boolean);
  return [...args, ...envFilters].map((filter) => filter.toLowerCase());
}

function testMatchesFilter(test, filters) {
  if (filters.length === 0) return true;
  const haystack = `${test.id}\n${test.file}`.toLowerCase();
  return filters.some((filter) => haystack.includes(filter));
}

function runtimeJobCount(total) {
  const configured = Number.parseInt(process.env.VIR_RUNTIME_JOBS ?? "", 10);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, total);
  }
  return Math.min(Math.max(1, availableParallelism()), total);
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function elapsedSeconds(start) {
  return ((performance.now() - start) / 1000).toFixed(2);
}

async function runRuntimeTest(test) {
  const start = performance.now();
  const result = await runAsync(process.execPath, [test.file], {
    capture: true,
    cwd: root,
  });
  return {
    ...result,
    test,
    seconds: elapsedSeconds(start),
  };
}

function printCapturedOutput(result) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout.length !== 0) {
    console.log(stdout);
  }
  if (stderr.length !== 0) {
    console.error(stderr);
  }
}

const filters = runtimeFilters();
const selected = tests.filter((test) => testMatchesFilter(test, filters));
if (selected.length === 0) {
  throw new Error(`no runtime tests matched ${filters.map((filter) => JSON.stringify(filter)).join(", ")}`);
}

const jobs = runtimeJobCount(selected.length);
if (filters.length !== 0) {
  console.log(`runtime filter: ${filters.join(", ")} (${selected.length}/${tests.length})`);
}
console.log(`runtime jobs: ${jobs}`);

const results = await mapWithLimit(selected, jobs, runRuntimeTest);
let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`PASS ${result.test.id}: ${result.seconds}s`);
    if (process.env.VIR_RUNTIME_VERBOSE === "1") {
      printCapturedOutput(result);
    }
  } else {
    failed++;
    console.log(`FAIL ${result.test.id}: status ${result.status ?? "unknown"} after ${result.seconds}s`);
    printCapturedOutput(result);
  }
}

if (failed !== 0) {
  process.exit(1);
}

console.log(`vir runtime smoke ok: ${selected.length} tests`);
