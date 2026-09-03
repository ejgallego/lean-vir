/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { createVirCallback } from "../../web/src/runtime/callbacks.js";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { readRuntimeArtifacts } from "./shared.mjs";

assert.equal(typeof globalThis.gc, "function", "GC smoke requires --expose-gc");

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [defaultPackageBytes],
});

let object = makeObjectString(runtime, "self-owning JSL");
let jsl = runtime.makeLeanObjectHandleResource(object, "self-owning JSL");
runtime.exports.vir_obj_dec(object);
object = 0;
assert.equal(typeof jsl, "object");
assert.deepEqual(Object.keys(jsl), []);
assert.equal(Object.isFrozen(jsl), false);
jsl.applicationValue = "ordinary JavaScript property";
assert.equal(jsl.applicationValue, "ordinary JavaScript property");
const borrowed = runtime.retainLeanObjectHandleValue(jsl, "self-owning JSL");
assert.equal(runtime.readObjectString(borrowed), "self-owning JSL");
runtime.exports.vir_obj_dec(borrowed);
const jslWeak = new WeakRef(jsl);
jsl = null;

let callbackReleases = 0;
const callbackRoots = new Set();
const callbackRuntime = {
  hostState: null,
  trackCallback(root) {
    callbackRoots.add(root);
  },
  untrackCallback(root) {
    callbackRoots.delete(root);
  },
  releaseClosure(rootId) {
    assert.equal(rootId, 1);
    callbackReleases++;
  },
};
let callback = createVirCallback(callbackRuntime, 1, {
  args: [],
  result: { type: "Unit" },
});
assert.equal(typeof callback, "function");
assert.deepEqual(Object.keys(callback), []);
const callbackWeak = new WeakRef(callback);
callback = null;

for (
  let attempt = 0;
  attempt < 300 &&
  (runtime.hostState.leanObjectHandleCells.size !== 0 ||
    callbackReleases !== 1);
  attempt++
) {
  globalThis.gc();
  await new Promise((resolve) => setImmediate(resolve));
}

assert.equal(jslWeak.deref(), undefined);
assert.equal(
  runtime.hostState.leanObjectHandleCells.size,
  0,
  "an unreachable JSL object must release its Lean root",
);
assert.equal(callbackWeak.deref(), undefined);
assert.equal(
  callbackReleases,
  1,
  "an unreachable callback must release its Lean root",
);
assert.equal(callbackRoots.size, 0);

runtime.dispose();
console.log("raw JavaScript value GC smoke ok");

function makeObjectString(valueRuntime, input) {
  const bytes = new TextEncoder().encode(input);
  const ptr = valueRuntime.allocBytes(bytes);
  try {
    return valueRuntime.exports.vir_obj_string(ptr, bytes.byteLength);
  } finally {
    valueRuntime.freeBytes(ptr);
  }
}
