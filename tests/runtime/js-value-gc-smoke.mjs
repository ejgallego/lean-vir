/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { readRuntimeArtifacts } from "./shared.mjs";

assert.equal(typeof globalThis.gc, "function", "GC smoke requires --expose-gc");

const { wasmBytes, hostPackageBytes } = await readRuntimeArtifacts();
let callback = null;
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (input, fn) => { callback = fn; return fn(input); },
    "test.recordNat": () => undefined,
  },
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

assert.equal(runtime.call("HostInterop.callbackRoundTrip", 3), 10n);
assert.equal(runtime.liveCallbackCount(), 1);
assert.equal(runtime.hostState.leanObjectHandleCells.size, 2,
  "JSL and actual Lean callback use the same tracking set");
assert.equal(typeof callback, "function");
assert.deepEqual(Object.keys(callback), []);
const callbackWeak = new WeakRef(callback);
callback = null;

for (
  let attempt = 0;
  attempt < 300 &&
  (runtime.hostState.leanObjectHandleCells.size !== 0 ||
    runtime.liveCallbackCount() !== 0);
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
assert.equal(runtime.liveCallbackCount(), 0,
  "an unreachable callback must release its shared ownership cell");

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
