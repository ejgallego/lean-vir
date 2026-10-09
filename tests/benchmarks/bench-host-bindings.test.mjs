/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { createBenchmarkHostBindings } from "../../benchmarks/harness/bench-host-bindings.mjs";

test("benchmark callbacks remain ordinary callable functions", () => {
  const bindings = createBenchmarkHostBindings();
  const callback = Object.freeze((value) => value + 7n);

  assert.equal(bindings["test.callNatCallback"](5n, callback), 12n);
  assert.equal(callback(6n), 13n);
  assert.deepEqual(Object.keys(callback), []);
  assert.equal(Object.hasOwn(callback, "release"), false);
});

test("benchmark callbacks preserve thrown values without a release protocol", () => {
  const bindings = createBenchmarkHostBindings();
  const failure = { reason: "callback failed" };
  const callback = () => {
    throw failure;
  };

  assert.throws(
    () => bindings["test.callNatCallback"](5n, callback),
    error => error === failure,
  );
  assert.throws(callback, error => error === failure);
});

test("benchmark callbacks preserve native argument and result identity", () => {
  const bindings = createBenchmarkHostBindings();
  const input = {};
  const result = {};
  assert.equal(bindings["test.callNatCallback"](input, value => {
    assert.equal(value, input);
    return result;
  }), result);
});

test("the benchmark no-op host binding preserves undefined", () => {
  const bindings = createBenchmarkHostBindings();
  assert.equal(bindings["test.recordNat"](3n), undefined);
});

test("benchmark document bindings retain exact object identity", () => {
  const bindings = createBenchmarkHostBindings();
  const documentValue = bindings["browser.document.current"]();
  assert.equal(bindings["browser.document.getTitle"](documentValue), "");
  assert.equal(
    bindings["browser.document.setTitle"](documentValue, "benchmark"),
    undefined,
  );
  assert.equal(bindings["browser.document.current"](), documentValue);
  assert.equal(
    bindings["browser.document.getTitle"](documentValue),
    "benchmark",
  );
});
