/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { createBenchmarkHostBindings } from "../../benchmarks/harness/bench-host-bindings.mjs";

test("benchmark callbacks use the exact self-owning function contract", () => {
  const released = [];
  const bindings = createBenchmarkHostBindings((callback) => released.push(callback));
  const callback = Object.freeze((value) => value + 7n);

  assert.equal(bindings["test.callNatCallback"](5n, callback), 12n);
  assert.deepEqual(released, [callback]);
  assert.deepEqual(Object.keys(callback), []);
  assert.equal(Object.hasOwn(callback, "release"), false);
});

test("benchmark callbacks release their root after failure", () => {
  const released = [];
  const bindings = createBenchmarkHostBindings((callback) => released.push(callback));
  const callback = () => {
    throw new Error("callback failed");
  };

  assert.throws(
    () => bindings["test.callNatCallback"](5n, callback),
    /callback failed/,
  );
  assert.deepEqual(released, [callback]);
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
  assert.equal(bindings["browser.document.getTitle"](documentValue), "benchmark");
});
