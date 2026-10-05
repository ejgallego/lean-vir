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
