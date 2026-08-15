/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSurfaceDeclarations,
  validateSurfaceReport,
} from "../../scripts/surface-report-schema.mjs";
import {
  emptySurfaceReportV3,
  nativeExternFixture,
  surfaceCounts,
  surfaceDefinition,
  targetCaptureFixture,
} from "./fixtures.mjs";

test("surface schema accepts a complete version 3 identity", () => {
  const report = emptySurfaceReportV3({ capture: targetCaptureFixture() });
  assert.equal(validateSurfaceReport(report), report);
  const blocked = singleDeclarationReport(true);
  assert.equal(validateSurfaceReport(blocked), blocked);
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
    params: [
      { index: 1, borrow: false, type: "object" },
      { index: 1, borrow: true, type: "object" },
    ],
  }));
  assert.throws(() => validateSurfaceReport(badAbi), /invalid ABI metadata/);
});

test("surface schema rejects declaration, blocker-summary, and extern drift", () => {
  const badDeclaration = singleDeclarationReport();
  badDeclaration.declarations[0].blocker = { kind: "missingExtern", name: "IO.test" };
  assert.throws(
    () => validateSurfaceReport(badDeclaration),
    /inconsistent runnable status/,
  );

  const badSummary = singleDeclarationReport(true);
  badSummary.primaryBlockers[0].roots = 2;
  assert.throws(
    () => validateSurfaceReport(badSummary),
    /primary blockers do not match declaration records/,
  );

  const badStatus = emptySurfaceReportV3();
  badStatus.externs.push(externFixture("mystery"));
  assert.throws(() => validateSurfaceReport(badStatus), /invalid extern record/);

  const badMismatch = emptySurfaceReportV3();
  badMismatch.externs.push(externFixture("incompatible"));
  assert.throws(() => validateSurfaceReport(badMismatch), /invalid extern record/);

  const validMismatch = emptySurfaceReportV3();
  validMismatch.runtimeCapabilities.nativeExternCount = 1;
  validMismatch.runtimeCapabilities.nativeExterns.push(nativeExternFixture("IO.test", {
    params: [{ index: 1, borrow: false, type: "object" }],
  }));
  validMismatch.externs.push(externFixture("incompatible", {
    targetAbi: { params: [{ borrow: true, type: "object" }], resultType: "object" },
    capabilityAbi: { params: [{ borrow: false, type: "object" }], resultType: "object" },
  }));
  assert.equal(validateSurfaceReport(validMismatch), validMismatch);
});

test("surface schema rejects incomplete target provenance", () => {
  const report = emptySurfaceReportV3({ capture: targetCaptureFixture() });
  report.capture.rootGraphSha256 = "not-a-sha";
  assert.throws(() => validateSurfaceReport(report), /invalid rootGraphSha256/);
});

test("surface schema rejects module and library aggregate drift", () => {
  const badModule = singleDeclarationReport();
  badModule.modules[0].counts.runnable = 2;
  assert.throws(() => validateSurfaceReport(badModule), /module aggregates/);

  const badLibrary = singleDeclarationReport();
  badLibrary.libraries[0].modulesWithFunctions = 2;
  assert.throws(() => validateSurfaceReport(badLibrary), /library aggregates/);
});

function singleDeclarationReport(blocked = false) {
  const name = "Smoke.entry";
  const blocker = { kind: "missingExtern", name: "IO.test" };
  const path = [name, blocker.name];
  const counts = surfaceCounts({
    total: 1,
    runnable: blocked ? 0 : 1,
    blocked: blocked ? 1 : 0,
    publicTotal: 1,
    publicRunnable: blocked ? 0 : 1,
  });
  const summary = {
    blocker,
    roots: 1,
    publicRoots: 1,
    exampleRoot: name,
    examplePath: path,
  };
  const declarations = [{
    name,
    module: "Smoke",
    kind: "publicConstant",
    runnable: !blocked,
    blocker: blocked ? blocker : null,
    blockerPath: blocked ? path : [],
    type: null,
    doc: null,
    ...(blocked ? { blockers: [{ blocker, path }] } : {}),
  }];
  const { modules, libraries } = aggregateSurfaceDeclarations(declarations);
  return emptySurfaceReportV3({
    definition: surfaceDefinition(blocked),
    selectedModules: ["Smoke"],
    selectedDeclarations: blocked ? [name] : [],
    closure: { selectedRoots: 1, capturedNodes: 2, rootReachableNodes: 2, supportOnlyNodes: 0 },
    counts,
    primaryBlockers: blocked ? [summary] : [],
    ...(blocked ? { reachableBlockers: [summary] } : {}),
    modules,
    libraries,
    declarations,
  });
}

function externFixture(status, overrides = {}) {
  return {
    name: "IO.test",
    module: "Init.System.IO",
    status,
    targets: [],
    type: null,
    doc: null,
    ...overrides,
  };
}
