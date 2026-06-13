/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { availableParallelism } from "node:os";

import { mapWithLimit, runAsync } from "./process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "./timing-utils.mjs";

const root = new URL("..", import.meta.url).pathname;

const tests = [
  { id: "manifest", file: "scripts/runtime-tests/manifest-smoke.mjs", groups: ["pure"] },
  { id: "host-bindings", file: "scripts/runtime-tests/host-bindings-smoke.mjs", groups: ["pure"] },
  { id: "react-host-bindings", file: "scripts/runtime-tests/react-host-bindings-smoke.mjs", groups: ["pure"] },
  { id: "value-codec", file: "scripts/runtime-tests/value-codec-smoke.mjs", groups: ["pure"] },
  {
    id: "package-generation",
    file: "scripts/runtime-tests/package-generation-smoke.mjs",
    groups: ["lean", "package-generation"],
  },
  { id: "sdk-import", file: "scripts/runtime-tests/sdk-import-smoke.mjs", groups: ["lean", "sdk"] },
];

const cli = parseRuntimeArgs(process.argv.slice(2));

function usage() {
  console.log(`Usage: node scripts/test-vir-runtime.mjs [filter ...]

Run JavaScript runtime smoke tests.

Arguments:
  filter          Case-insensitive substring matched against runtime test id
                  and file path. When omitted, all runtime smoke tests run.

Options:
  --list          Print runtime test ids.
  --group GROUP   Run tests tagged with GROUP; repeatable. Groups: ${runtimeTestGroups().join(", ")}.
  -h, --help      Show this help.

Environment:
  VIR_RUNTIME_TEST_FILTER  Comma-separated filters, combined with positional filters.
  VIR_RUNTIME_TEST_GROUP   Comma-separated groups, combined with --group.
  VIR_RUNTIME_JOBS         Positive integer worker limit.
  VIR_RUNTIME_VERBOSE      Set to 1 to print passing subtest output.
`);
}

if (cli.help) {
  usage();
  process.exit(0);
}

function parseRuntimeArgs(argv) {
  const positionalFilters = [];
  const groups = [];
  let help = false;
  let list = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--group") {
      const group = argv[index + 1];
      if (!group || group.startsWith("--")) {
        throw new Error("--group requires a group name");
      }
      groups.push(...splitGroupList(group));
      index += 1;
      continue;
    }
    if (arg.startsWith("--group=")) {
      const group = arg.slice("--group=".length);
      if (!group) {
        throw new Error("--group requires a group name");
      }
      groups.push(...splitGroupList(group));
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}; run node scripts/test-vir-runtime.mjs --help`);
    }
    positionalFilters.push(arg);
  }

  return { positionalFilters, groups, help, list };
}

function splitGroupList(value) {
  return value
    .split(",")
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

function runtimeTestGroups() {
  return unique(tests.flatMap((test) => test.groups)).sort();
}

function runtimeFilters(positionalFilters) {
  const envFilters = (process.env.VIR_RUNTIME_TEST_FILTER ?? "")
    .split(",")
    .map((filter) => filter.trim())
    .filter(Boolean);
  return [...positionalFilters, ...envFilters].map((filter) => filter.toLowerCase());
}

function runtimeGroups(cliGroups) {
  const groups = unique([
    ...cliGroups,
    ...splitGroupList(process.env.VIR_RUNTIME_TEST_GROUP ?? ""),
  ]);
  const knownGroups = new Set(runtimeTestGroups());
  for (const group of groups) {
    if (!knownGroups.has(group)) {
      throw new Error(
        `unknown runtime test group ${JSON.stringify(group)}; available groups: ${runtimeTestGroups().join(", ")}`,
      );
    }
  }
  return groups;
}

function testMatchesFilter(test, filters) {
  if (filters.length === 0) return true;
  const haystack = `${test.id}\n${test.file}`.toLowerCase();
  return filters.some((filter) => haystack.includes(filter));
}

function testMatchesGroup(test, groups) {
  if (groups.length === 0) return true;
  return groups.some((group) => test.groups.includes(group));
}

function runtimeJobCount(total) {
  const configured = Number.parseInt(process.env.VIR_RUNTIME_JOBS ?? "", 10);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, total);
  }
  return Math.min(Math.max(1, availableParallelism()), total);
}

async function runRuntimeTest(test) {
  const start = timerStart();
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

const filters = runtimeFilters(cli.positionalFilters);
const groups = runtimeGroups(cli.groups);
const selected = tests.filter((test) => testMatchesGroup(test, groups) && testMatchesFilter(test, filters));
if (cli.list) {
  for (const test of selected) {
    console.log(`${test.id}\t${test.groups.join(",")}\t${test.file}`);
  }
  process.exit(0);
}
if (selected.length === 0) {
  const clauses = [];
  if (groups.length !== 0) {
    clauses.push(`groups ${groups.map((group) => JSON.stringify(group)).join(", ")}`);
  }
  if (filters.length !== 0) {
    clauses.push(`filters ${filters.map((filter) => JSON.stringify(filter)).join(", ")}`);
  }
  throw new Error(`no runtime tests matched ${clauses.join(" and ") || "the current selection"}`);
}

const jobs = runtimeJobCount(selected.length);
if (groups.length !== 0) {
  console.log(`runtime group: ${groups.join(", ")} (${selected.length}/${tests.length})`);
}
if (filters.length !== 0) {
  console.log(`runtime filter: ${filters.join(", ")} (${selected.length}/${tests.length})`);
}
console.log(`runtime jobs: ${jobs}`);

const runStart = timerStart();
const results = await mapWithLimit(selected, jobs, runRuntimeTest);
let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`PASS ${result.test.id}: ${formatSeconds(result.seconds)}s`);
    if (process.env.VIR_RUNTIME_VERBOSE === "1") {
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
