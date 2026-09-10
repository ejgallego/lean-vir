/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";

const bindings = createJsCollectionHostBindings();
const reactions = {
  thenValue: (f) => bindings["js.promise.thenValue"](Promise.resolve(0), f),
  thenPromise: (f) => bindings["js.promise.thenPromise"](Promise.resolve(0), () => Promise.resolve().then(f)),
  thenValueWithRejection: (f) => bindings["js.promise.thenValueWithRejection"](Promise.resolve(0), f, () => 0),
  rejectionBranch: (f) => bindings["js.promise.thenValueWithRejection"](Promise.reject(0), () => 0, f),
  catchValue: (f) => bindings["js.promise.catchValue"](Promise.reject(0), f),
};

for (const [name, invoke] of Object.entries(reactions)) {
  test(`${name}: native resolution preserves values and recursively assimilates thenables`, async () => {
    const value = { exact: true };
    assert.equal(await invoke(() => value), value);
    const callable = () => {};
    callable.then = (resolve) => resolve(value);
    const row = { then(resolve) { resolve(callable); } };
    assert.equal(await invoke(() => row), value);
    assert.equal(await invoke(() => Promise.resolve(value)), value);
  });
  test(`${name}: thrown handlers and throwing then getters reject with the exact reason`, async () => {
    const reason = { exactError: true };
    await assert.rejects(invoke(() => { throw reason; }), (error) => error === reason);
    let reads = 0;
    const row = { get then() { reads++; throw reason; } };
    await assert.rejects(invoke(() => row), (error) => error === reason);
    assert.equal(reads, 1);
  });
}

test("rejection reasons are not assimilated or coerced before a handler sees them", async () => {
  let accesses = 0;
  const reason = { get then() { accesses++; throw new Error("must not inspect a rejection reason"); } };
  for (const rejected of [reason, undefined, null, "message", 7]) {
    const value = { recovered: true };
    assert.equal(await bindings["js.promise.catchValue"](Promise.reject(rejected), (seen) => {
      assert.equal(seen, rejected);
      return value;
    }), value);
  }
  assert.equal(accesses, 0);
});

test("returning a previously fulfilled object observes a subsequently added then method", async () => {
  const value = {};
  const input = Promise.resolve(value);
  value.then = (resolve) => resolve("assimilated");
  assert.equal(await bindings["js.promise.thenValue"](input, (seen) => {
    assert.equal(seen, value);
    return seen;
  }), "assimilated");
});
