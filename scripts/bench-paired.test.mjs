/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { pairedBenchmarkSchedule, pairedPercentDeltas } from "./bench-paired-schedule.mjs";
import { assertComparableBenchmarkReportIdentities } from "./bench-utils.mjs";

test("paired benchmark schedule alternates AB and BA passes", () => {
  assert.deepEqual(pairedBenchmarkSchedule(4), [
    { pass: 1, sequence: "AB", position: 1, side: "before" },
    { pass: 1, sequence: "AB", position: 2, side: "after" },
    { pass: 2, sequence: "BA", position: 1, side: "after" },
    { pass: 2, sequence: "BA", position: 2, side: "before" },
    { pass: 3, sequence: "AB", position: 1, side: "before" },
    { pass: 3, sequence: "AB", position: 2, side: "after" },
    { pass: 4, sequence: "BA", position: 1, side: "after" },
    { pass: 4, sequence: "BA", position: 2, side: "before" },
  ]);
});

test("paired benchmark schedule preserves a one-pass screening mode", () => {
  assert.deepEqual(pairedBenchmarkSchedule(1).map((row) => row.side), ["before", "after"]);
});

test("paired benchmark schedule rejects invalid pass counts", () => {
  assert.throws(() => pairedBenchmarkSchedule(0), /positive integer/);
  assert.throws(() => pairedBenchmarkSchedule(1.5), /positive integer/);
});

test("benchmark comparison identity rejects mismatched focused workloads", () => {
  const report = (comparisonIdentity) => ({ report: { comparisonIdentity } });
  assert.doesNotThrow(() => assertComparableBenchmarkReportIdentities([
    { label: "before", report: report({ workload: "env-v1", samples: 7 }) },
    { label: "after", report: report({ workload: "env-v1", samples: 7 }) },
  ]));
  assert.throws(() => assertComparableBenchmarkReportIdentities([
    { label: "before", report: report({ workload: "env-v1", samples: 7 }) },
    { label: "after", report: report({ workload: "env-v1", samples: 5 }) },
  ]), /comparison identity mismatch/);
});

test("legacy reports remain comparable only when all omit comparison identity", () => {
  const legacy = { report: {} };
  assert.doesNotThrow(() => assertComparableBenchmarkReportIdentities([
    { label: "before", report: legacy },
    { label: "after", report: legacy },
  ]));
  assert.throws(() => assertComparableBenchmarkReportIdentities([
    { label: "before", report: legacy },
    { label: "after", report: { report: { comparisonIdentity: { workload: "env-v1" } } } },
  ]), /missing comparisonIdentity/);
});

test("paired benchmark deltas preserve pass pairing", () => {
  assert.deepEqual(pairedPercentDeltas([10, 20, 25], [11, 18, 25]), [10, -10, 0]);
  assert.throws(() => pairedPercentDeltas([10], [10, 11]), /equal length/);
  assert.throws(() => pairedPercentDeltas([0], [1]), /baselines must be positive/);
});
