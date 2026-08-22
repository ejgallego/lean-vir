/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import { mapWithLimit, runAsync } from "../../scripts/process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "../../scripts/timing-utils.mjs";
import {
  includesSerialRuntimeTests,
  parallelRuntimeTestCount,
  parseRuntimeRunnerConfig,
  planRuntimeTestBatches,
  runtimeGroupNames,
  runtimeJobCount,
  runtimeTestPath,
  runtimeTests,
  selectRuntimeTests,
} from "./runner-core.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const config = parseRuntimeRunnerConfig({
  argv: process.argv.slice(2),
  env: process.env,
  parallelism: availableParallelism(),
});

function usage() {
  console.log(`Usage: node tests/runtime/runner.mjs [filter ...]

Run JavaScript runtime smoke tests.

Arguments:
  filter          Case-insensitive substring matched against runtime test id
                  and file path. When omitted, all runtime smoke tests run.

Options:
  --list          Print runtime test ids.
  --group GROUP   Run tests tagged with GROUP. Groups: ${runtimeGroupNames.join(", ")}.
  -h, --help      Show this help.

Environment:
  VIR_RUNTIME_TEST_FILTER  Comma-separated filters, combined with positional filters.
  VIR_RUNTIME_JOBS         Positive integer worker limit.
  VIR_RUNTIME_VERBOSE      Set to 1 to print passing subtest output.
`);
}

if (config.help) {
  usage();
  process.exit(0);
}

async function runRuntimeTest(test) {
  const start = timerStart();
  const result = await runAsync(process.execPath, [...(test.nodeArgs ?? []), runtimeTestPath(test)], {
    capture: true,
    cwd: root,
  });
  return {
    ...result,
    test,
    seconds: elapsedSeconds(start),
  };
}

async function runRuntimeTestBatches(batches, parallelJobs) {
  const results = [];
  for (const batch of batches) {
    if (batch.mode === "parallel") {
      results.push(...await mapWithLimit(batch.tests, parallelJobs, runRuntimeTest));
    } else {
      results.push(await runRuntimeTest(batch.tests[0]));
    }
  }
  return results;
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

const selected = selectRuntimeTests(runtimeTests, config);
if (config.list) {
  for (const test of selected) {
    console.log(`${test.id}\t${test.group}\t${runtimeTestPath(test)}`);
  }
  process.exit(0);
}
if (selected.length === 0) {
  const clauses = [];
  if (config.group !== null) {
    clauses.push(`group ${JSON.stringify(config.group)}`);
  }
  if (config.filters.length !== 0) {
    clauses.push(`filters ${config.filters.map((filter) => JSON.stringify(filter)).join(", ")}`);
  }
  throw new Error(`no runtime tests matched ${clauses.join(" and ") || "the current selection"}`);
}

const jobs = runtimeJobCount(Math.max(1, parallelRuntimeTestCount(selected)), config);
if (config.group !== null) {
  console.log(`runtime group: ${config.group} (${selected.length}/${runtimeTests.length})`);
}
if (config.filters.length !== 0) {
  console.log(
    `runtime filter: ${config.filters.join(", ")} (${selected.length}/${runtimeTests.length})`,
  );
}
console.log(`runtime jobs: ${jobs}${includesSerialRuntimeTests(selected) ? " (lean serial)" : ""}`);

const runStart = timerStart();
const results = await runRuntimeTestBatches(planRuntimeTestBatches(selected), jobs);
let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`PASS ${result.test.id}: ${formatSeconds(result.seconds)}s`);
    if (config.verbose) {
      printCapturedOutput(result);
    }
  } else {
    failed++;
    console.log(
      `FAIL ${result.test.id}: status ${result.status ?? "unknown"} after ${formatSeconds(result.seconds)}s`,
    );
    printCapturedOutput(result);
  }
}

if (failed !== 0) {
  process.exit(1);
}

const slowest = [...results]
  .sort((left, right) => right.seconds - left.seconds)
  .slice(0, 3)
  .map((result) => `${result.test.id}=${formatSeconds(result.seconds)}s`);
console.log(`runtime timing: total=${formatSeconds(elapsedSeconds(runStart))}s slowest=${slowest.join(", ")}`);
console.log(`vir runtime smoke ok: ${selected.length} tests`);
