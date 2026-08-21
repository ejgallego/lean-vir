/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const fixtureSummaryVersion = 2;

function incrementStatus(totals, status) {
  if (status === "passed") return { ...totals, passed: totals.passed + 1 };
  if (status === "failed") return { ...totals, failed: totals.failed + 1 };
  throw new Error(`unknown fixture result status ${JSON.stringify(status)}`);
}

function summaryTiming(timing) {
  if (timing === undefined) return null;
  return {
    totalSeconds: Number(timing.total.toFixed(3)),
    hostSeconds: Number(timing.host.toFixed(3)),
    packageSeconds: Number(timing.package.toFixed(3)),
    wasmSeconds: Number(timing.wasm.toFixed(3)),
  };
}

function summaryDiagnostics(diagnostics) {
  if (diagnostics === undefined) return null;
  return {
    loadedDeclCount: diagnostics.loadedDecls.length,
    importedDecls: diagnostics.importedDecls,
    nativeExterns: diagnostics.nativeExterns,
    initGlobals: diagnostics.initGlobals,
    missingDecls: diagnostics.missingDecls,
    missingNativeExterns: diagnostics.missingNativeExterns,
    unsupportedInitGlobals: diagnostics.unsupportedInitGlobals,
  };
}

function summaryFixture(result) {
  return {
    id: result.fixture.id,
    entry: result.fixture.entry,
    status: result.status,
    expectedHost: result.expectation.host,
    expectedWasm: result.expectation.wasm,
    expectationReason: result.expectation.reason,
    host: result.host ?? null,
    wasm: result.wasm ?? null,
    detail: result.detail ?? null,
    timing: summaryTiming(result.timing),
    diagnostics: summaryDiagnostics(result.diagnostics),
  };
}

export function fixtureSummary(results) {
  const totals = results.reduce(
    (current, result) => incrementStatus(current, result.status),
    { passed: 0, failed: 0 },
  );
  return {
    version: fixtureSummaryVersion,
    totals,
    fixtures: results.map(summaryFixture),
  };
}
