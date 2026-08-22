/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

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

test("runtime catalog is immutable and has unique ids and files", () => {
  assert.equal(Object.isFrozen(runtimeTests), true);
  assert.equal(runtimeTests.every(Object.isFrozen), true);
  assert.deepEqual(runtimeGroupNames, ["lean", "pure"]);
  assert.equal(new Set(runtimeTests.map((entry) => entry.id)).size, runtimeTests.length);
  assert.equal(new Set(runtimeTests.map((entry) => entry.file)).size, runtimeTests.length);
  assert.equal(runtimeTestPath(runtimeTests[0]), "tests/runtime/manifest-smoke.mjs");
  assert.throws(() => runtimeTests.push({}), TypeError);
});

test("runtime catalog covers every smoke entrypoint", async () => {
  const runtimeFiles = await readdir(new URL(".", import.meta.url));
  const smokeFiles = runtimeFiles.filter((file) => file.endsWith("-smoke.mjs")).sort();
  const catalogFiles = runtimeTests.map((entry) => entry.file).sort();
  assert.deepEqual(catalogFiles, smokeFiles);
});

test("runtime configuration parses filters and runner options", () => {
  const config = parseRuntimeRunnerConfig({
    argv: ["host", "--group", "PURE", "--list", "package"],
    parallelism: 4,
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.positionalFilters), true);
  assert.deepEqual(config, {
    positionalFilters: ["host", "package"],
    filters: ["host", "package"],
    group: "pure",
    help: false,
    list: true,
    configuredJobs: null,
    parallelism: 4,
    verbose: false,
  });
  assert.throws(
    () => parseRuntimeRunnerConfig({ argv: ["--group"] }),
    /--group requires a group name/,
  );
  assert.throws(
    () => parseRuntimeRunnerConfig({ argv: ["--unknown"] }),
    /unknown argument: --unknown/,
  );
});

test("runtime configuration combines CLI and environment inputs", () => {
  const config = parseRuntimeRunnerConfig({
    argv: ["Host", "--group", "PURE"],
    env: {
      VIR_RUNTIME_TEST_FILTER: " package,  JS-FLOAT ",
      VIR_RUNTIME_JOBS: "3",
      VIR_RUNTIME_VERBOSE: "1",
    },
    parallelism: 12,
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.filters), true);
  assert.deepEqual(config, {
    positionalFilters: ["Host"],
    filters: ["host", "package", "js-float"],
    group: "pure",
    help: false,
    list: false,
    configuredJobs: 3,
    parallelism: 12,
    verbose: true,
  });
});

test("runtime configuration retains automatic worker and help fallbacks", () => {
  assert.equal(parseRuntimeRunnerConfig().parallelism, 1);
  assert.equal(parseRuntimeRunnerConfig({ argv: ["--help", "--group", "missing"] }).group, null);
});

test("runtime configuration rejects malformed worker limits", () => {
  for (const value of ["0", "-1", "3 workers", "not-a-number", "9007199254740992"]) {
    assert.throws(
      () => parseRuntimeRunnerConfig({ env: { VIR_RUNTIME_JOBS: value } }),
      /VIR_RUNTIME_JOBS must be a (?:safe )?positive integer/,
    );
  }
});

test("runtime groups normalize names and reject unknown groups", () => {
  assert.equal(parseRuntimeRunnerConfig().group, null);
  assert.equal(parseRuntimeRunnerConfig({ argv: ["--group", "LEAN"] }).group, "lean");
  assert.throws(
    () => parseRuntimeRunnerConfig({ argv: ["--group", "missing"] }),
    /available groups: lean, pure/,
  );
});

test("runtime selection applies group and case-insensitive OR filters", () => {
  const selected = selectRuntimeTests(runtimeTests, {
    group: "pure",
    filters: ["js-float", "package-decoder"],
  });
  assert.equal(Object.isFrozen(selected), true);
  assert.deepEqual(selected.map((entry) => entry.id), ["js-float", "package-decoder"]);
  assert.deepEqual(
    selectRuntimeTests(runtimeTests, { filters: ["tests/runtime/startup-runtime"] }).map(
      (entry) => entry.id,
    ),
    ["startup-hooks"],
  );
});

test("runtime job counts honor explicit and automatic limits", () => {
  const automatic = parseRuntimeRunnerConfig({ parallelism: 12 });
  const explicit = parseRuntimeRunnerConfig({
    env: { VIR_RUNTIME_JOBS: "20" },
    parallelism: 12,
  });
  assert.equal(runtimeJobCount(10, automatic), 10);
  assert.equal(runtimeJobCount(3, automatic), 3);
  assert.equal(runtimeJobCount(10, explicit), 10);
  assert.equal(runtimeJobCount(0, automatic), 0);
});

test("runtime batch plans preserve order across parallel and serial boundaries", () => {
  const tests = [
    { id: "parallel-a", group: "pure" },
    { id: "parallel-b", group: "pure" },
    { id: "serial-a", group: "lean" },
    { id: "parallel-c", group: "pure" },
    { id: "serial-b", group: "lean" },
  ];
  const batches = planRuntimeTestBatches(tests);
  assert.equal(Object.isFrozen(batches), true);
  assert.equal(batches.every(Object.isFrozen), true);
  assert.deepEqual(
    batches.map((batch) => ({
      mode: batch.mode,
      ids: batch.tests.map((entry) => entry.id),
    })),
    [
      { mode: "parallel", ids: ["parallel-a", "parallel-b"] },
      { mode: "serial", ids: ["serial-a"] },
      { mode: "parallel", ids: ["parallel-c"] },
      { mode: "serial", ids: ["serial-b"] },
    ],
  );
  assert.equal(parallelRuntimeTestCount(tests), 3);
  assert.equal(includesSerialRuntimeTests(tests), true);
  assert.equal(includesSerialRuntimeTests(tests.slice(0, 2)), false);
});
