/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntime,
  VIR_HOST_DISPOSE,
} from "../../web/src/vir-runtime-node.js";
import {
  assert,
  createCallbackHostBindings,
  readRuntimeArtifacts,
} from "./shared.mjs";

const { wasmBytes, hostPackageBytes, defaultPackageBytes } =
  await readRuntimeArtifacts();

const hostRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: createCallbackHostBindings(),
});

const bindings = hostRuntime.hostState.defaultBindings;
const nativeArray = bindings["js.array.empty"]();
const nativeItem = { kind: "exact-array-item" };
assert.equal(Array.isArray(nativeArray), true);
assert.equal(bindings["js.array.push"](nativeArray, nativeItem), 1);
assert.equal(bindings["js.array.length"](nativeArray), 1);
assert.equal(bindings["js.array.item"](nativeArray, 0), nativeItem);
assert.equal(bindings["js.array.item"](nativeArray, 1), undefined);

const nativeObject = bindings["js.object.empty"]();
bindings["js.object.set"](nativeObject, "value", nativeItem);
assert.equal(nativeObject.value, nativeItem);
let calledWith = null;
bindings["js.function.callVoid"]((value) => {
  calledWith = value;
}, nativeItem);
assert.equal(calledWith, nativeItem);

let retainedCallback = null;
const retainedCallbackRuntime = await createVirRuntime({
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
const timedCallbackRoundTrip = retainedCallbackRuntime.callTimed(
  "HostInterop.callbackRoundTrip",
  3,
);
assert.equal(timedCallbackRoundTrip.value, "10");
assert.equal(timedCallbackRoundTrip.timings.hostMs >= 0, true);
assert.equal(
  timedCallbackRoundTrip.timings.hostMs <=
    timedCallbackRoundTrip.timings.executeMs,
  true,
);
assert.deepEqual(retainedCallbackRuntime.hostState.callTimings, []);
assert.equal(retainedCallbackRuntime.liveCallbacks.size, 1);
const retainedJsNat = (value) =>
  retainedCallbackRuntime.hostState.defaultBindings["js.nat"](BigInt(value));
const retainedJsNatValue = (value) =>
  retainedCallbackRuntime.hostState.defaultBindings["js.nat.value"](value);
assert.equal(retainedJsNatValue(retainedCallback(retainedJsNat(4))), 11n);
assert.deepEqual(Object.keys(retainedCallback), []);
retainedCallbackRuntime.dispose();
assert.equal(retainedCallbackRuntime.liveCallbacks.size, 0);
assert.throws(() => retainedCallback(4n), /disposed runtime/);

const nestedCallbackErrorRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (input, callback) => callback(input, input),
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => nestedCallbackErrorRuntime.call("HostInterop.callbackRoundTrip", 1),
  /callback expects 1 arguments, got 2/,
);
assert.equal(nestedCallbackErrorRuntime.liveCallbacks.size, 0);
nestedCallbackErrorRuntime.dispose();

let throwingCallback = null;
const throwingBindingRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      throwingCallback = callback;
      throw new Error("host binding boom");
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => throwingBindingRuntime.callTimed("HostInterop.callbackRoundTrip", 1),
  /host binding boom/,
);
assert.equal(throwingBindingRuntime.liveCallbacks.size, 0);
assert.throws(
  () => throwingCallback(1n),
  /closure root id is not live|disposed runtime/,
);
throwingBindingRuntime.dispose();

let bindingDisposals = 0;
const reloadRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    ...createCallbackHostBindings(),
    [VIR_HOST_DISPOSE]() {
      bindingDisposals += 1;
    },
  },
});
assert.equal(reloadRuntime.call("HostInterop.callbackRoundTrip", 3), "10");
assert.equal(reloadRuntime.liveCallbacks.size, 1);
const badReloadPackage = Uint8Array.from(hostPackageBytes);
badReloadPackage[4] ^= 1;
assert.throws(
  () => reloadRuntime.loadIrPackageSetBytes([badReloadPackage]),
  /invalid IR package magic/,
);
assert.equal(bindingDisposals, 0);
assert.equal(reloadRuntime.liveCallbacks.size, 1);
reloadRuntime.loadIrPackageSetBytes([defaultPackageBytes]);
assert.equal(reloadRuntime.liveCallbacks.size, 0);
assert.equal(reloadRuntime.call("fib", 12), "144");
reloadRuntime.dispose();
assert.equal(bindingDisposals, 1);

assert.throws(
  () => hostRuntime.call("HostInterop.titleHandshake", "node"),
  /Vir host import binding not found: browser\.document\.current/,
);
hostRuntime.dispose();

console.log("vir runtime host bindings smoke ok");
