/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import { readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, hostPackageBytes } = await readRuntimeArtifacts();

let retainedCallback = null;
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      retainedCallback = callback;
      return callback(input);
    },
    "test.recordNat": () => undefined,
  },
});

assert.equal(runtime.call("HostInterop.callbackRoundTrip", 3), "10");
assert.equal(typeof retainedCallback, "function");
assert.deepEqual(Object.keys(retainedCallback), []);
assert.equal(Object.hasOwn(retainedCallback, "retain"), false);
assert.equal(Object.hasOwn(retainedCallback, "release"), false);
assert.equal(runtime.liveCallbacks.size, 1);

const jsNat = (value) =>
  runtime.hostState.defaultBindings["js.nat"](BigInt(value));
const jsNatValue = (value) =>
  runtime.hostState.defaultBindings["js.nat.value"](value);
assert.equal(jsNatValue(retainedCallback(jsNat(4))), 11n);

runtime.dispose();
assert.equal(runtime.liveCallbacks.size, 0);
assert.throws(
  () => retainedCallback(1n),
  /disposed runtime|belongs to a disposed runtime/,
);

let failedCallback = null;
const failedRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      failedCallback = callback;
      throw new Error("host binding boom");
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => failedRuntime.call("HostInterop.callbackRoundTrip", 1),
  /host binding boom/,
);
assert.equal(typeof failedCallback, "function");
assert.equal(failedRuntime.liveCallbacks.size, 0);
assert.throws(
  () => failedCallback(1n),
  /disposed runtime|closure root id is not live/,
);
failedRuntime.dispose();

let wrongArityCallback = null;
const wrongArityRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      wrongArityCallback = callback;
      return callback(input, input);
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => wrongArityRuntime.call("HostInterop.callbackRoundTrip", 1),
  /callback expects 1 arguments, got 2/,
);
assert.equal(wrongArityRuntime.liveCallbacks.size, 0);
assert.throws(
  () => wrongArityCallback(1n),
  /closure root id is not live|disposed runtime/,
);
wrongArityRuntime.dispose();

const rollbackDocumentState = createVirtualDocumentState();
const rollbackElement = ensureVirtualElementState(
  rollbackDocumentState,
  "#rollback",
);
const rollbackRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: rollbackDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => callback(input),
    "test.recordNat": () => undefined,
  },
});
const makeObjectValue = rollbackRuntime.makeJsObjectValue.bind(rollbackRuntime);
rollbackRuntime.makeJsObjectValue = (type, value, label) => {
  if (label === "browser.element.addEventListener result") {
    throw new Error("forced host result publication failure");
  }
  return makeObjectValue(type, value, label);
};
assert.throws(
  () => rollbackRuntime.call("HostInterop.mountCallbackEvent", "#rollback"),
  /forced host result publication failure/,
);
assert.deepEqual(rollbackElement.listeners.get("click"), []);
assert.equal(rollbackDocumentState.resources.debugResourceCounts().active, 0);
assert.equal(rollbackRuntime.liveCallbacks.size, 0);
rollbackRuntime.dispose();

console.log("self-owning callback lifecycle smoke ok");
