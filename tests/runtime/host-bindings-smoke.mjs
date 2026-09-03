/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
  VIR_HOST_DISPOSE,
} from "../../web/src/vir-runtime-node.js";
import {
  assert,
  createCallbackHostBindings,
  readRuntimeArtifacts,
  wait,
} from "./shared.mjs";
import { ensureTamagotchiVirtualDom } from "../support/virtual-fixtures.mjs";

const { wasmBytes, hostPackageBytes, defaultPackageBytes } =
  await readRuntimeArtifacts();

const virtualDocumentState = createVirtualDocumentState();
const hostRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState,
  hostBindings: createCallbackHostBindings(),
});

const collectionBindings = hostRuntime.hostState.defaultBindings;
const nativeArray = collectionBindings["js.array.empty"]();
const nativeItem = { kind: "exact-array-item" };
assert.equal(Array.isArray(nativeArray), true);
assert.equal(collectionBindings["js.array.push"](nativeArray, nativeItem), 1);
assert.equal(collectionBindings["js.array.length"](nativeArray), 1);
assert.equal(
  collectionBindings["js.array.item"](nativeArray, 0),
  nativeItem,
  "JavaScript array bindings must preserve item identity",
);
assert.equal(
  collectionBindings["js.array.item"](nativeArray, 1),
  undefined,
  "JavaScript array lookup must preserve the native missing value",
);

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
assert.equal(Object.hasOwn(retainedCallback, "handle"), false);
assert.equal("handle" in retainedCallback, false);
assert.equal(Object.hasOwn(retainedCallback, "type"), false);
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
assert.deepEqual(throwingBindingRuntime.hostState.callTimings, []);
assert.ok(throwingCallback);
assert.equal(Object.hasOwn(throwingCallback, "released"), false);
assert.equal(throwingBindingRuntime.liveCallbacks.size, 0);
assert.throws(
  () => throwingCallback(1n),
  /closure root id is not live|disposed runtime/,
);
throwingBindingRuntime.dispose();

const lifecycleDocumentState = createVirtualDocumentState();
const lifecycleRecords = [];
const lifecycleRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: lifecycleDocumentState,
  hostBindings: createCallbackHostBindings(lifecycleRecords),
});
ensureVirtualElementState(lifecycleDocumentState, "#callback");
assert.equal(
  lifecycleRuntime.call("HostInterop.mountCallbackEvent", "#callback"),
  "1",
);
lifecycleDocumentState.elements
  .get("#callback")
  .listeners.get("click")[0]
  .dispatch({});
assert.deepEqual(lifecycleRecords.splice(0), [101]);
lifecycleRuntime.dispose();
assert.equal(lifecycleRuntime.liveCallbacks.size, 0);
assert.equal(
  lifecycleDocumentState.elements.get("#callback").listeners.get("click")
    ?.length,
  1,
  "runtime disposal must not invent DOM listener removal",
);
assert.deepEqual(lifecycleRecords.splice(0), []);

const lifecycleDocumentState2 = createVirtualDocumentState();
const lifecycleRecords2 = [];
const lifecycleRuntime2 = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: lifecycleDocumentState2,
  hostBindings: createCallbackHostBindings(lifecycleRecords2),
});
ensureVirtualElementState(lifecycleDocumentState2, "#callback");
assert.equal(
  lifecycleRuntime2.call(
    "HostInterop.mountAndRemoveCallbackEvent",
    "#callback",
  ),
  "1",
);
assert.ok(lifecycleRuntime2.liveCallbacks.size >= 1);
lifecycleDocumentState2.elements
  .get("#callback")
  .listeners.get("click")?.[0]
  ?.dispatch({});
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.deepEqual(
  lifecycleDocumentState2.elements.get("#callback").listeners.get("click"),
  [],
  "removeEventListener must match the original receiver, event, and function",
);
assert.equal(lifecycleRuntime2.call("HostInterop.timeoutRecord", 40), "1");
await wait(10);
assert.deepEqual(lifecycleRecords2.splice(0), [41]);
assert.ok(lifecycleRuntime2.liveCallbacks.size >= 1);
assert.equal(lifecycleRuntime2.call("HostInterop.clearTimeoutRecord", 40), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.startTimeoutLoop", 2), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), [2, 1, 0]);
assert.equal(lifecycleRuntime2.call("HostInterop.animationRecord", 50), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), [52]);
assert.equal(
  lifecycleRuntime2.call("HostInterop.cancelAnimationRecord", 50),
  "1",
);
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.startAnimationLoop", 2), "1");
await wait(80);
assert.deepEqual(lifecycleRecords2.splice(0), [2, 1, 0]);
lifecycleRuntime2.dispose();
assert.throws(
  () => lifecycleRuntime2.call("HostInterop.callbackRoundTrip", 1),
  /disposed/,
);

const pendingDocumentState = createVirtualDocumentState();
const pendingRecords = [];
const pendingRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: pendingDocumentState,
  hostBindings: createCallbackHostBindings(pendingRecords),
});
ensureVirtualElementState(pendingDocumentState, "#pending");
assert.equal(
  pendingRuntime.call("HostInterop.mountCallbackEvent", "#pending"),
  "1",
);
assert.equal(pendingRuntime.call("HostInterop.timeoutRecord", 70), "1");
assert.equal(pendingRuntime.call("HostInterop.animationRecord", 80), "1");
assert.equal(pendingRuntime.liveCallbacks.size, 3);
pendingRuntime.dispose();
assert.equal(pendingRuntime.liveCallbacks.size, 0);
assert.equal(
  pendingDocumentState.elements.get("#pending").listeners.get("click")?.length,
  1,
  "runtime disposal must leave the DOM-owned listener registered",
);
await wait(40);
assert.deepEqual(pendingRecords.splice(0), []);

const reloadDocumentState = createVirtualDocumentState();
const reloadRecords = [];
let reloadBindingDisposals = 0;
const reloadBindings = {
  ...createCallbackHostBindings(reloadRecords),
  [VIR_HOST_DISPOSE]() {
    reloadBindingDisposals += 1;
  },
};
const reloadRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: reloadDocumentState,
  hostBindings: reloadBindings,
});
ensureVirtualElementState(reloadDocumentState, "#reload");
assert.equal(
  reloadRuntime.call("HostInterop.mountCallbackEvent", "#reload"),
  "1",
);
assert.equal(reloadRuntime.call("HostInterop.timeoutRecord", 90), "1");
assert.equal(reloadRuntime.call("HostInterop.animationRecord", 100), "1");
assert.equal(reloadRuntime.liveCallbacks.size, 3);
const resourcesBeforeFailedReload = reloadDocumentState.resources;
const badReloadPackage = Uint8Array.from(hostPackageBytes);
badReloadPackage[4] ^= 1;
assert.throws(
  () => reloadRuntime.loadIrPackageSetBytes([badReloadPackage]),
  /invalid IR package magic/,
);
assert.equal(reloadBindingDisposals, 0);
assert.equal(
  reloadDocumentState.resources,
  resourcesBeforeFailedReload,
  "a rejected replacement should restore the active virtual resource generation",
);
assert.equal(reloadRuntime.liveCallbacks.size, 3);
assert.equal(reloadRuntime.call("HostInterop.callbackRoundTrip", 3), "10");
reloadRuntime.loadIrPackageSetBytes([defaultPackageBytes]);
assert.equal(reloadBindingDisposals, 0);
assert.equal(reloadRuntime.packageInfo.hostImports, 0);
assert.equal(reloadRuntime.liveCallbacks.size, 0);
assert.throws(
  () => reloadRuntime.call("HostInterop.callbackRoundTrip", 1),
  /interface entry not found/,
);
assert.equal(reloadRuntime.call("fib", 12), "144");
assert.equal(
  reloadDocumentState.elements.get("#reload").listeners.get("click")?.length,
  1,
  "package replacement must leave the DOM-owned listener registered",
);
await wait(40);
assert.deepEqual(reloadRecords.splice(0), []);
reloadRuntime.dispose();
assert.equal(reloadBindingDisposals, 1);

ensureTamagotchiVirtualDom(virtualDocumentState);
assert.equal(hostRuntime.call("Tamagotchi.uiMountFromDom"), "8");
assert.ok(hostRuntime.liveCallbacks.size >= 8);
const petReset = hostRuntime.call("Tamagotchi.uiReset", "Mochi", "pet");
assert.deepEqual(petReset, {
  name: "Mochi",
  mood: "happy",
  trace: ["happy"],
  artwork: "pet",
  turns: "0",
  care: "3",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiStep", petReset, "ignore"), {
  name: "Mochi",
  mood: "hungry",
  trace: ["happy", "hungry"],
  artwork: "pet",
  turns: "1",
  care: "2",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiResetFromDom"), {
  name: "Mochi",
  mood: "happy",
  trace: ["happy"],
  artwork: "pet",
  turns: "0",
  care: "3",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiRenameFromDom"), {
  name: "Mochi",
  mood: "happy",
  trace: ["happy"],
  artwork: "pet",
  turns: "0",
  care: "3",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiStepFromDom", "ignore"), {
  name: "Mochi",
  mood: "hungry",
  trace: ["happy", "hungry"],
  artwork: "pet",
  turns: "1",
  care: "2",
});
virtualDocumentState.elements
  .get("[data-action='ignore']")
  .listeners.get("click")?.[0]
  ?.dispatch({});
assert.equal(
  virtualDocumentState.elements.get("#pet-device").attributes.get("data-mood"),
  "angry",
);
assert.equal(
  virtualDocumentState.elements.get("#pet-device").attributes.get("data-trace"),
  "happy,hungry,angry",
);
virtualDocumentState.elements
  .get("#pet-reset-button")
  .listeners.get("click")?.[0]
  ?.dispatch({});
assert.equal(
  virtualDocumentState.elements.get("#pet-device").attributes.get("data-mood"),
  "happy",
);
assert.equal(
  virtualDocumentState.elements.get("#pet-device").attributes.get("data-trace"),
  "happy",
);
virtualDocumentState.elements.get("#pet-name-input").value = "Ada";
virtualDocumentState.elements
  .get("#pet-name-input")
  .listeners.get("change")?.[0]
  ?.dispatch({});
assert.equal(
  virtualDocumentState.elements.get("#pet-device").attributes.get("data-name"),
  "Ada",
);
hostRuntime.dispose();
assert.equal(hostRuntime.liveCallbacks.size, 0);

console.log("vir runtime host bindings smoke ok");
