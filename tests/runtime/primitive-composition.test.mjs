/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { ManagedRuntime } from "../../web/src/runtime/managed-core.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { validateInterfaceType } from "../../web/src/runtime/interface-manifest.js";
import {
  arrayBoundary,
  boundary,
  nativeDescriptor,
  nativeField,
  objectBoundary,
  objectConstructor,
  primitiveBoundary,
} from "../support/interface-fixtures.mjs";

test("managed runtime rejects object boundaries before argument transfer", () => {
  const runtime = Object.create(ManagedRuntime.prototype);
  runtime.requireLiveRuntime = () => {};
  runtime.requireFunction = () => {};
  runtime.entryCallCache = new WeakMap();
  runtime.hasObjectValueExports = () => true;
  let work = 0;
  runtime.makeObjectValue = runtime.callResolvedObjects = () => {
    work++;
    throw new Error("unexpected native work");
  };
  const nat = primitiveBoundary("nat", "bigint");
  const array = arrayBoundary(nat.native, nat.value);
  const entry = {
    entry: "structure",
    args: [{ type: nat }],
    result: array,
  };
  runtime.interfaceManifest = { exports: [entry] };
  assert.throws(
    () => runtime.callEntry(entry, [1n]),
    /object ABI does not support/,
  );
  assert.equal(work, 0);
});

test("full and primitive compositions inherit the same ownership and call operations", () => {
  for (const method of [
    "makeObjectString",
    "makeObjectUint64",
    "makeObjectResource",
    "makeLeanObjectHandleResource",
    "retainLeanObjectHandleValue",
    "releaseLeanObjectHandleCell",
    "callResolvedObjects",
    "callEntry",
    "dispose",
  ]) {
    assert.equal(
      VirRuntime.prototype[method],
      ManagedRuntime.prototype[method],
      method,
    );
  }
  const nat = primitiveBoundary("nat", "bigint");
  const functionValue = boundary(
    nativeDescriptor("leanObject", {}, {
      signature: { args: [nat.native], result: nat.native, effect: "pure" },
    }),
    { tag: "function", args: [nat.value], result: nat.value },
  );
  assert.equal(ManagedRuntime.prototype.objectResultSupported(functionValue), false);
  assert.equal(VirRuntime.prototype.objectResultSupported(functionValue), true);
});

test("admitted nested callbacks remain result-only", () => {
  const nat = primitiveBoundary("nat", "bigint");
  const callback = boundary(
    nativeDescriptor("leanObject", {}, {
      signature: { args: [nat.native], result: nat.native, effect: "pure" },
    }),
    { tag: "function", args: [nat.value], result: nat.value },
  );
  const nestedArray = arrayBoundary(callback.native, callback.value);
  const nested = validateInterfaceType(objectBoundary(
    "Callbacks",
    [objectConstructor("Callbacks.mk", {
      objectFieldCount: 1,
      usizeFieldCount: 0,
      scalarByteSize: 0,
    }, [nativeField("values", nestedArray.native, { tag: "object", index: 0 })])],
    {
      tag: "record",
      fields: [{ key: "values", path: [0], value: nestedArray.value }],
    },
  ));
  assert.equal(VirRuntime.prototype.objectArgumentSupported(nested), false);
  assert.equal(VirRuntime.prototype.objectResultSupported(nested), true);
  assert.equal(ManagedRuntime.prototype.objectResultSupported(nested), false);
});
