/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [defaultPackageBytes],
});

const resourceType = {
  type: "Resource",
  interfaceTag: INTERFACE_TAG.RESOURCE,
  kind: "resource",
  name: "Lean.Vir.Js",
};
const stringType = { type: "String", interfaceTag: INTERFACE_TAG.STRING };
const optionResourceType = {
  type: "Option Resource",
  interfaceTag: INTERFACE_TAG.OPTION,
  element: resourceType,
};

assert.equal(typeof runtime.exports.vir_call_resolved, "undefined");
assert.equal(typeof runtime.exports.vir_call_result_size, "undefined");

for (const value of [
  null,
  undefined,
  false,
  0,
  -0,
  42n,
  "raw",
  { name: "object" },
  ["array"],
  () => "callback",
]) {
  let object = runtime.makeObjectValue(resourceType, value, "raw resource");
  try {
    assert.equal(
      Object.is(
        runtime.liftObjectValue(resourceType, object, "raw resource"),
        value,
      ),
      true,
    );
    assert.equal(runtime.exports.vir_obj_resource_is_valid(object), 1);
  } finally {
    runtime.exports.vir_obj_dec(object);
    object = 0;
  }
  // Releasing the Lean-side root cannot mutate or invalidate the JavaScript
  // value. JavaScript reachability is the lifetime oracle.
  if (value !== null && typeof value === "object") {
    assert.equal(value.name ?? value[0], value.name ?? "array");
  }
}

assert.throws(
  () => runtime.makeJsObjectValue(stringType, "raw", "raw string host result"),
  /unsupported JavaScript host resource result type/,
);
assert.throws(
  () =>
    runtime.makeJsObjectValue(optionResourceType, null, "option host result"),
  /unsupported JavaScript host resource result type/,
);

let leanObject = makeObjectString(runtime, "lean-ref");
const jsl = runtime.makeLeanObjectHandleResource(
  leanObject,
  "lean object handle",
);
runtime.exports.vir_obj_dec(leanObject);
leanObject = 0;
assert.deepEqual(Reflect.ownKeys(jsl), []);
for (const internalField of [
  "runtime",
  "object",
  "cell",
  "lease",
  "handle",
  "value",
]) {
  assert.equal(Object.hasOwn(jsl, internalField), false);
}
let retained = runtime.retainLeanObjectHandleValue(
  jsl,
  "lean object handle value",
);
try {
  assert.equal(runtime.readObjectString(retained), "lean-ref");
} finally {
  runtime.exports.vir_obj_dec(retained);
  retained = 0;
}

const rootsBeforeDispose = runtime.hostState.leanObjectHandleCells.size;
assert.equal(rootsBeforeDispose, 1);
const hostState = runtime.hostState;
runtime.dispose();
assert.equal(hostState.leanObjectHandleCells.size, 0);
assert.throws(
  () => runtime.retainLeanObjectHandleValue(jsl, "disposed lean object handle"),
  /live Lean object handle resource/,
);

console.log("raw externref object ABI smoke ok");

function makeObjectString(valueRuntime, input) {
  const bytes = new TextEncoder().encode(input);
  const ptr = valueRuntime.allocBytes(bytes);
  try {
    return valueRuntime.exports.vir_obj_string(ptr, bytes.byteLength);
  } finally {
    valueRuntime.freeBytes(ptr);
  }
}
