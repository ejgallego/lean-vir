/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFixtureRun } from "./support/fixture-result.mjs";
import { fixtureSummary, fixtureSummaryVersion } from "./support/fixture-summary.mjs";

const fixture = { id: "fixture", entry: "Fixture.run" };
const passExpectation = { host: null, wasm: null, reason: null };
const targetExpectation = { host: "64", wasm: "32", reason: "Target width." };
const timing = { total: 1.2345, host: 0.1234, package: 0.4567, wasm: 0.6544 };
const diagnostics = {
  loadedDecls: [{ name: "Fixture.run", source: "fixtures/Fixture.lean", imported: false }],
  importedDecls: [],
  nativeExterns: [{ name: "Nat.add", symbol: "lean_nat_add" }],
  initGlobals: [],
  missingDecls: [],
  missingNativeExterns: [],
  unsupportedInitGlobals: [],
};
const generated = { ok: true, diagnostics };

test("fixture result evaluation continues only while phases succeed", () => {
  assert.equal(evaluateFixtureRun({
    phase: "host",
    fixture,
    expectation: passExpectation,
    host: "12",
    timing,
  }), null);
  assert.equal(evaluateFixtureRun({
    phase: "package",
    fixture,
    expectation: passExpectation,
    host: "12",
    generated,
    timing,
  }), null);
  assert.deepEqual(evaluateFixtureRun({
    phase: "wasm",
    fixture,
    expectation: passExpectation,
    host: "12",
    generated,
    wasm: "12",
    timing,
  }), {
    fixture,
    expectation: passExpectation,
    host: "12",
    wasm: "12",
    diagnostics,
    timing,
    status: "passed",
  });
});

test("fixture result evaluation classifies host and package failures", () => {
  assert.match(evaluateFixtureRun({
    phase: "host",
    fixture,
    expectation: { ...passExpectation, host: "32", wasm: "16", reason: "Target width." },
    host: "64",
    timing,
  }).detail, /host=64 expected-host=32/);

  const failedGeneration = {
    ok: false,
    diagnostics,
    failure: { kind: "missing-ir-decl", detail: "Missing.decl" },
  };
  assert.equal(evaluateFixtureRun({
    phase: "package",
    fixture,
    expectation: passExpectation,
    host: "12",
    generated: failedGeneration,
    timing,
  }).status, "failed");
});

test("fixture result evaluation compares Wasm with the declared oracle", () => {
  assert.equal(evaluateFixtureRun({
    phase: "wasm",
    fixture,
    expectation: passExpectation,
    host: "12",
    generated,
    wasm: "13",
    timing,
  }).status, "failed");
  assert.equal(evaluateFixtureRun({
    phase: "wasm",
    fixture,
    expectation: targetExpectation,
    host: "64",
    generated,
    wasm: "32",
    timing,
  }).status, "passed");
  assert.equal(evaluateFixtureRun({
    phase: "wasm",
    fixture,
    expectation: targetExpectation,
    host: "64",
    generated,
    wasm: "31",
    timing,
  }).detail, "host=64 wasm=31 expected-wasm=32");
});

test("fixture result evaluation rejects invalid phase states", () => {
  assert.throws(
    () => evaluateFixtureRun({
      phase: "unknown",
      fixture,
      expectation: passExpectation,
      host: "12",
      timing,
    }),
    /unknown fixture run phase "unknown"/,
  );
  assert.throws(
    () => evaluateFixtureRun({
      phase: "package",
      fixture,
      expectation: passExpectation,
      host: "12",
      timing,
    }),
    /package result is required after the host phase/,
  );
});

test("fixture summaries expose a versioned structured contract", () => {
  const summary = fixtureSummary([
    evaluateFixtureRun({
      phase: "wasm",
      fixture,
      expectation: passExpectation,
      host: "12",
      generated,
      wasm: "12",
      timing,
    }),
    {
      status: "failed",
      fixture: { id: "failed", entry: "Failed.run" },
      expectation: passExpectation,
      host: "8",
      wasm: "9",
      detail: "host=8 wasm=9",
    },
  ]);
  assert.equal(summary.version, fixtureSummaryVersion);
  assert.equal(summary.version, 2);
  assert.deepEqual(summary.totals, { passed: 1, failed: 1 });
  assert.deepEqual(summary.fixtures[0], {
    id: "fixture",
    entry: "Fixture.run",
    status: "passed",
    expectedHost: null,
    expectedWasm: null,
    expectationReason: null,
    host: "12",
    wasm: "12",
    detail: null,
    timing: {
      totalSeconds: 1.234,
      hostSeconds: 0.123,
      packageSeconds: 0.457,
      wasmSeconds: 0.654,
    },
    diagnostics: {
      loadedDeclCount: 1,
      importedDecls: [],
      nativeExterns: [{ name: "Nat.add", symbol: "lean_nat_add" }],
      initGlobals: [],
      missingDecls: [],
      missingNativeExterns: [],
      unsupportedInitGlobals: [],
    },
  });
  assert.equal(summary.fixtures[1].timing, null);
  assert.equal(summary.fixtures[1].diagnostics, null);
  assert.throws(
    () => fixtureSummary([{ status: "unknown" }]),
    /unknown fixture result status "unknown"/,
  );
});
