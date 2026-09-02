/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { parseRunnerJobLimit } from "../support/runner-jobs.mjs";

const runtimeTestDirectory = "tests/runtime";

function freezeRuntimeTest(test) {
  return Object.freeze({
    ...test,
    ...(test.nodeArgs === undefined
      ? {}
      : { nodeArgs: Object.freeze([...test.nodeArgs]) }),
  });
}

export const runtimeTests = Object.freeze(
  [
    { id: "manifest", file: "manifest-smoke.mjs", group: "pure" },
    { id: "call-timing", file: "call-timing-smoke.mjs", group: "pure" },
    { id: "js-float", file: "js-float-fidelity-smoke.mjs", group: "pure" },
    { id: "host-bindings", file: "host-bindings-smoke.mjs", group: "pure" },
    { id: "host-boundary", file: "host-boundary-smoke.mjs", group: "pure" },
    {
      id: "js-value-gc",
      file: "js-value-gc-smoke.mjs",
      group: "pure",
      nodeArgs: ["--expose-gc"],
    },
    {
      id: "browser-canvas-bindings",
      file: "browser-canvas-bindings-smoke.mjs",
      group: "pure",
    },
    { id: "startup-hooks", file: "startup-runtime-smoke.mjs", group: "pure" },
    {
      id: "callback-lifecycle",
      file: "callback-lifecycle-smoke.mjs",
      group: "pure",
    },
    {
      id: "react-host-bindings",
      file: "react-host-bindings-smoke.mjs",
      group: "pure",
    },
    {
      id: "custom-inductive-normalization",
      file: "custom-inductive-normalization-smoke.mjs",
      group: "pure",
    },
    { id: "object-abi", file: "object-abi-smoke.mjs", group: "pure" },
    {
      id: "object-abi-structural",
      file: "object-abi-structural-smoke.mjs",
      group: "pure",
    },
    { id: "package-decoder", file: "package-decoder-smoke.mjs", group: "pure" },
    {
      id: "package-set-descriptor",
      file: "package-set-descriptor-smoke.mjs",
      group: "pure",
    },
    {
      id: "package-generator",
      file: "package-generator-smoke.mjs",
      group: "lean",
    },
    {
      id: "interpreter-constant-cache",
      file: "interpreter-constant-cache-smoke.mjs",
      group: "lean",
    },
    {
      id: "module-package-set",
      file: "module-package-set-smoke.mjs",
      group: "lean",
    },
    {
      id: "slides-canvas",
      file: "slides-canvas-runtime-smoke.mjs",
      group: "lean",
    },
    {
      id: "package-generation",
      file: "package-generation-smoke.mjs",
      group: "lean",
    },
    { id: "sdk-import", file: "sdk-import-smoke.mjs", group: "lean" },
  ].map(freezeRuntimeTest),
);

export const runtimeGroupNames = Object.freeze(
  [...new Set(runtimeTests.map((test) => test.group))].sort(),
);

const serialRuntimeGroups = Object.freeze(["lean"]);

function parseRuntimeArgs(argv) {
  const positionalFilters = [];
  let group = null;
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
      group = argv[index + 1];
      if (!group || group.startsWith("--")) {
        throw new Error("--group requires a group name");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(
        `unknown argument: ${arg}; run node tests/runtime/runner.mjs --help`,
      );
    }
    positionalFilters.push(arg);
  }

  return Object.freeze({
    positionalFilters: Object.freeze(positionalFilters),
    group,
    help,
    list,
  });
}

function runtimeFilters(positionalFilters, envFilter = "") {
  const environmentFilters = envFilter
    .split(",")
    .map((filter) => filter.trim())
    .filter(Boolean);
  return Object.freeze(
    [...positionalFilters, ...environmentFilters].map((filter) =>
      filter.toLowerCase(),
    ),
  );
}

function runtimeGroup(cliGroup) {
  if (cliGroup === null) return null;
  const group = cliGroup.toLowerCase();
  if (!runtimeGroupNames.includes(group)) {
    throw new Error(
      `unknown runtime test group ${JSON.stringify(group)}; available groups: ${runtimeGroupNames.join(", ")}`,
    );
  }
  return group;
}

export function runtimeTestPath(test) {
  return `${runtimeTestDirectory}/${test.file}`;
}

function testMatchesFilter(test, filters) {
  if (filters.length === 0) return true;
  const haystack = `${test.id}\n${runtimeTestPath(test)}`.toLowerCase();
  return filters.some((filter) => haystack.includes(filter));
}

function testMatchesGroup(test, group) {
  return group === null || test.group === group;
}

export function selectRuntimeTests(tests, { filters = [], group = null } = {}) {
  return Object.freeze(
    tests.filter(
      (test) =>
        testMatchesGroup(test, group) && testMatchesFilter(test, filters),
    ),
  );
}

export function parseRuntimeRunnerConfig({
  argv = [],
  env = {},
  parallelism = 1,
} = {}) {
  const cli = parseRuntimeArgs(argv);
  const configuredJobs = parseRunnerJobLimit(
    env.VIR_RUNTIME_JOBS,
    "VIR_RUNTIME_JOBS",
  );
  return Object.freeze({
    ...cli,
    filters: runtimeFilters(
      cli.positionalFilters,
      env.VIR_RUNTIME_TEST_FILTER ?? "",
    ),
    group: cli.help ? null : runtimeGroup(cli.group),
    configuredJobs,
    parallelism:
      Number.isInteger(parallelism) && parallelism > 0 ? parallelism : 1,
    verbose: env.VIR_RUNTIME_VERBOSE === "1",
  });
}

export function runtimeJobCount(total, config) {
  if (config.configuredJobs !== null) {
    return Math.min(config.configuredJobs, total);
  }
  return Math.min(config.parallelism, total);
}

function isSerialRuntimeTest(test) {
  return serialRuntimeGroups.includes(test.group);
}

export function planRuntimeTestBatches(tests) {
  const batches = [];
  let parallelBatch = [];

  function flushParallelBatch() {
    if (parallelBatch.length === 0) return;
    batches.push(
      Object.freeze({ mode: "parallel", tests: Object.freeze(parallelBatch) }),
    );
    parallelBatch = [];
  }

  for (const test of tests) {
    if (isSerialRuntimeTest(test)) {
      flushParallelBatch();
      batches.push(
        Object.freeze({ mode: "serial", tests: Object.freeze([test]) }),
      );
    } else {
      parallelBatch.push(test);
    }
  }
  flushParallelBatch();
  return Object.freeze(batches);
}

export function parallelRuntimeTestCount(tests) {
  return tests.filter((test) => !isSerialRuntimeTest(test)).length;
}

export function includesSerialRuntimeTests(tests) {
  return tests.some(isSerialRuntimeTest);
}
