/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { fixtureExpectation } from "../fixtures/fixture-manifest.mjs";

test("defaults to the host oracle", () => {
  assert.deepEqual(fixtureExpectation({ id: "same" }), {
    host: null,
    wasm: null,
    reason: null,
  });
});

test("accepts documented target-specific results", () => {
  assert.deepEqual(fixtureExpectation({
    id: "target-specific",
    expect: { host: "64", wasm: "32", reason: "The word size follows the target." },
  }), {
    host: "64",
    wasm: "32",
    reason: "The word size follows the target.",
  });
});

test("rejects obsolete status expectations", () => {
  assert.throws(
    () => fixtureExpectation({ id: "unsupported", expect: { status: "unsupported" } }),
    /unknown expect field status/,
  );
});

test("rejects malformed expectation objects", () => {
  assert.throws(
    () => fixtureExpectation({ id: "null", expect: null }),
    /expect must be an object/,
  );
  assert.throws(
    () => fixtureExpectation({ id: "array", expect: [] }),
    /expect must be an object/,
  );
});

test("rejects unknown expectation fields", () => {
  assert.throws(
    () => fixtureExpectation({ id: "unknown-field", expect: { typo: true } }),
    /unknown expect field typo/,
  );
});

test("rejects blank expectation reasons", () => {
  assert.throws(
    () => fixtureExpectation({ id: "blank-reason", expect: { reason: "   " } }),
    /expect\.reason must be a non-empty string/,
  );
  assert.throws(
    () => fixtureExpectation({ id: "orphan-reason", expect: { reason: "No override." } }),
    /expect\.reason requires target-specific host and Wasm results/,
  );
});

test("rejects one-sided and undocumented target expectations", () => {
  assert.throws(
    () => fixtureExpectation({ id: "one-sided", expect: { wasm: "32", reason: "Target word size." } }),
    /require both expect\.host and expect\.wasm/,
  );
  assert.throws(
    () => fixtureExpectation({ id: "undocumented", expect: { host: "64", wasm: "32" } }),
    /require expect\.reason/,
  );
});

test("rejects malformed or redundant target results", () => {
  assert.throws(
    () => fixtureExpectation({ id: "numeric", expect: { host: 64, wasm: "32", reason: "Target word size." } }),
    /expect\.host must be a decimal Nat string/,
  );
  assert.throws(
    () => fixtureExpectation({ id: "equal", expect: { host: "32", wasm: "32", reason: "Redundant." } }),
    /should use the default host-oracle comparison/,
  );
});
