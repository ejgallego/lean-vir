/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { ManagedRuntime } from "../../web/src/runtime/managed-core.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { validateInterfaceType } from "../../web/src/runtime/interface-manifest.js";

test("unsupported structural entry is rejected before argument transfer or execution", () => {
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
  const entry = {
    entry: "structure",
    args: [{ type: { interfaceTag: INTERFACE_TAG.NAT } }],
    result: {
      interfaceTag: INTERFACE_TAG.ARRAY,
      element: { interfaceTag: INTERFACE_TAG.NAT },
    },
  };
  runtime.interfaceManifest = { exports: [entry] };
  assert.throws(
    () => runtime.callEntry(entry, [1]),
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
  assert.equal(
    ManagedRuntime.prototype.objectResultSupported({
      interfaceTag: INTERFACE_TAG.FUNCTION,
    }),
    false,
  );
  assert.equal(
    VirRuntime.prototype.objectResultSupported({
      interfaceTag: INTERFACE_TAG.FUNCTION,
    }),
    true,
  );
});

test("admitted nested callbacks remain result-only; unsupported scalar layouts stay rejected", () => {
  const nat = { type: "Nat", interfaceTag: INTERFACE_TAG.NAT };
  const callback = {
    type: "Nat → Nat", interfaceTag: INTERFACE_TAG.FUNCTION, kind: "function",
    effect: "pure", args: [{ name: "n", type: nat }], result: nat,
  };
  const nested = validateInterfaceType({
    type: "Callbacks", interfaceTag: INTERFACE_TAG.STRUCTURE, kind: "structure",
    name: "Callbacks", objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
    fields: [{ name: "values", layout: { kind: "object", index: 0 }, type: {
      type: "Array (Nat → Nat)", interfaceTag: INTERFACE_TAG.ARRAY, element: callback,
    } }],
  });
  assert.equal(VirRuntime.prototype.objectArgumentSupported(nested), false);
  assert.equal(VirRuntime.prototype.objectResultSupported(nested), true);
  assert.equal(ManagedRuntime.prototype.objectResultSupported(nested), false);

  // Manifest bounds are valid, but this scalar width has no UInt32 converter.
  const scalar = validateInterfaceType({
    type: "SmallUInt32", interfaceTag: INTERFACE_TAG.STRUCTURE, kind: "structure",
    name: "SmallUInt32", objectFieldCount: 0, usizeFieldCount: 0, scalarByteSize: 2,
    fields: [{ name: "n", type: { type: "UInt32", interfaceTag: INTERFACE_TAG.UINT32 },
      layout: { kind: "scalar", offset: 0, size: 2 } }],
  });
  assert.equal(VirRuntime.prototype.objectArgumentSupported(scalar), false);
  assert.equal(VirRuntime.prototype.objectResultSupported(scalar), false);

  const invalid = structuredClone(nested);
  delete invalid.fields[0].type.element.args;
  assert.throws(() => validateInterfaceType(invalid), /args must be an array/);
});
