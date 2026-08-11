/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { validateSurfaceReport } from "./surface-report-schema.mjs";
import {
  emptySurfaceReportV3,
  nativeExternFixture,
  targetCaptureFixture,
} from "./surface-report-test-fixtures.mjs";

test("surface schema accepts a complete version 3 identity", () => {
  const report = emptySurfaceReportV3({ capture: targetCaptureFixture() });
  assert.equal(validateSurfaceReport(report), report);
});

test("surface schema rejects inconsistent counts and native capability totals", () => {
  const badCounts = emptySurfaceReportV3();
  badCounts.counts.blocked = 1;
  assert.throws(() => validateSurfaceReport(badCounts), /inconsistent declaration counts/);

  const badCapabilities = emptySurfaceReportV3();
  badCapabilities.runtimeCapabilities.nativeExterns.push(nativeExternFixture("IO.test"));
  assert.throws(() => validateSurfaceReport(badCapabilities), /runtime-capability policy/);

  const badAbi = emptySurfaceReportV3();
  badAbi.runtimeCapabilities.nativeExternCount = 1;
  badAbi.runtimeCapabilities.nativeExterns.push(nativeExternFixture("IO.test", {
    params: [{ borrow: false, type: "object" }],
  }));
  assert.throws(() => validateSurfaceReport(badAbi), /invalid ABI metadata/);
});

test("surface schema rejects incomplete target provenance", () => {
  const report = emptySurfaceReportV3({ capture: targetCaptureFixture() });
  report.capture.rootGraphSha256 = "not-a-sha";
  assert.throws(() => validateSurfaceReport(report), /invalid rootGraphSha256/);
});
