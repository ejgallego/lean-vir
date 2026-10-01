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
  interfaceTag: INTERFACE_TAG.OPTION,
  element: resourceType,
};

const roots = runtime.hostState.resourceRoots;
const initialRoots = roots.debugCounts().active;
let finalizerReleases = 0;
const releaseRoot = runtime.hostState.releaseRootedResourceFromFinalizer;
runtime.hostState.releaseRootedResourceFromFinalizer = (rootId) => {
  finalizerReleases++;
  return releaseRoot.call(runtime.hostState, rootId);
};

try {
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
  ]) {
    const releasesBefore = finalizerReleases;
    let object = runtime.makeObjectValue(resourceType, value, "raw resource");
    try {
      assert.equal(roots.debugCounts().active, initialRoots + 1);
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
    assert.equal(roots.debugCounts().active, initialRoots);
    assert.equal(finalizerReleases, releasesBefore + 1);
  }

  {
    const value = { shared: true };
    const releasesBefore = finalizerReleases;
    const object = runtime.exports.vir_obj_resource(value);
    const independentlyBoxed = runtime.exports.vir_obj_resource(value);
    assert.notEqual(object, independentlyBoxed);
    assert.equal(roots.debugCounts().active, initialRoots + 2);
    runtime.exports.vir_obj_inc(object);
    runtime.exports.vir_obj_dec(object);
    assert.equal(finalizerReleases, releasesBefore);
    assert.equal(runtime.exports.vir_obj_resource_externref(object), value);
    runtime.exports.vir_obj_dec(object);
    assert.equal(finalizerReleases, releasesBefore + 1);
    assert.equal(roots.debugCounts().active, initialRoots + 1);
    assert.equal(
      runtime.exports.vir_obj_resource_externref(independentlyBoxed),
      value,
    );
    runtime.exports.vir_obj_dec(independentlyBoxed);
    assert.equal(finalizerReleases, releasesBefore + 2);
    assert.equal(roots.debugCounts().active, initialRoots);
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
    assert.equal(roots.debugCounts().active, initialRoots);
  }

  {
    const rootResource = runtime.hostState.rootResource;
    const releasesBefore = finalizerReleases;
    runtime.hostState.rootResource = () => 0;
    try {
      assert.equal(runtime.exports.vir_obj_resource({ failed: true }), 0);
    } finally {
      runtime.hostState.rootResource = rootResource;
    }
    assert.equal(finalizerReleases, releasesBefore);
    assert.equal(roots.debugCounts().active, initialRoots);
  }

  // Releasing a Lean root leaves the independently reachable JS values intact.
  assert.deepEqual(objectValue, { name: "object" });
  assert.deepEqual(arrayValue, ["array"]);
} finally {
  runtime.hostState.releaseRootedResourceFromFinalizer = releaseRoot;
}

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
