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
  irPackageSet: [defaultPackageBytes],
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
  interfaceTag: INTERFACE_TAG.CUSTOM_INDUCTIVE,
  kind: "customInductive",
  name: "Option",
  constructors: [
    {
      name: "Option.none",
      jsName: "none",
      tag: 0,
      objectFieldCount: 0,
      usizeFieldCount: 0,
      scalarByteSize: 0,
      fields: [],
    },
    {
      name: "Option.some",
      jsName: "some",
      tag: 1,
      objectFieldCount: 1,
      usizeFieldCount: 0,
      scalarByteSize: 0,
      fields: [
        {
          name: "val",
          type: resourceType,
          layout: { kind: "object", index: 0 },
        },
      ],
    },
  ],
};

const rootCounts = () => runtime.hostState.resourceRootCounts();
const initialRoots = rootCounts().active;

assert.equal(typeof runtime.exports.vir_call_resolved, "undefined");
assert.equal(typeof runtime.exports.vir_call_result_size, "undefined");

const objectValue = { name: "object" };
const arrayValue = ["array"];

for (const value of [
  null,
  undefined,
  false,
  0,
  -0,
  NaN,
  42n,
  "raw",
  Symbol("resource"),
  objectValue,
  arrayValue,
  () => "callback",
  Promise.resolve("resource"),
]) {
  let object = runtime.makeObjectValue(resourceType, value, "raw resource");
  try {
    assert.equal(rootCounts().active, initialRoots + 1);
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
  assert.equal(rootCounts().active, initialRoots);
}

{
  const value = { shared: true };
  const object = runtime.exports.vir_obj_resource(value);
  const independentlyBoxed = runtime.exports.vir_obj_resource(value);
  assert.notEqual(object, independentlyBoxed);
  assert.equal(rootCounts().active, initialRoots + 2);
  runtime.exports.vir_obj_inc(object);
  runtime.exports.vir_obj_dec(object);
  assert.equal(runtime.exports.vir_obj_resource_externref(object), value);
  runtime.exports.vir_obj_dec(object);
  assert.equal(rootCounts().active, initialRoots + 1);
  assert.equal(
    runtime.exports.vir_obj_resource_externref(independentlyBoxed),
    value,
  );
  runtime.exports.vir_obj_dec(independentlyBoxed);
  assert.equal(rootCounts().active, initialRoots);
}

{
  // Use valid Lean values of other kinds, never forged object pointers.
  const string = makeObjectString(runtime, "not a resource");
  const scalar = runtime.exports.vir_obj_scalar(0);
  try {
    for (const value of [string, scalar]) {
      assert.equal(runtime.exports.vir_obj_resource_is_valid(value), 0);
      assert.equal(runtime.exports.vir_obj_resource_externref(value), null);
    }
  } finally {
    runtime.exports.vir_obj_dec(string);
    runtime.exports.vir_obj_dec(scalar);
  }
  assert.equal(rootCounts().active, initialRoots);
}

// Releasing a Lean root leaves the independently reachable JS values intact.
assert.deepEqual(objectValue, { name: "object" });
assert.deepEqual(arrayValue, ["array"]);

assert.throws(
  () => runtime.makeJsObjectValue(stringType, "raw", "raw string host result"),
  /unsupported direct JavaScript result type/,
);
assert.throws(
  () =>
    runtime.makeJsObjectValue(optionResourceType, null, "option host result"),
  /unsupported direct JavaScript result type/,
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
assert.equal(runtime.exports.vir_resource_roots_active(), 0);
assert.equal(runtime.exports.vir_resource_roots_reusable(), 0);
assert.equal(runtime.exports.vir_obj_resource({ closed: true }), 0);
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
