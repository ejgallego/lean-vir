/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import {
  assert,
  createCallbackHostBindings,
  readRuntimeArtifacts,
  wait,
} from "./shared.mjs";
import { ensureTamagotchiVirtualDom } from "../virtual-fixtures.mjs";

const { wasmBytes, hostPackageBytes, irPackageBytes } = await readRuntimeArtifacts();

const virtualDocumentState = createVirtualDocumentState();
const hostRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState,
  hostBindings: createCallbackHostBindings(),
});

let retainedCallback = null;
const retainedCallbackRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      retainedCallback = callback;
      return callback(input);
    },
    "test.recordNat": () => undefined,
  },
});
assert.equal(retainedCallbackRuntime.call("HostInterop.callbackRoundTrip", 3), "10");
assert.equal(retainedCallbackRuntime.liveCallbacks.size, 1);
assert.equal(retainedCallback(4), "11");
assert.deepEqual(Object.keys(retainedCallback), []);
assert.equal(Object.hasOwn(retainedCallback, "handle"), false);
assert.equal("handle" in retainedCallback, false);
assert.equal(Object.hasOwn(retainedCallback, "type"), false);
const staleCallbackRootId = 1;
const staleCallbackType = retainedCallbackRuntime.interfaceManifest.hostImports
  .find((entry) => entry.target === "test.callNatCallback")
  ?.args[1]?.type;
assert.ok(staleCallbackType);
assert.equal(retainedCallback.release(), true);
assert.equal(retainedCallback.release(), false);
assert.equal(retainedCallback.released, true);
assert.equal(retainedCallbackRuntime.liveCallbacks.size, 0);
assert.throws(() => retainedCallback(4), /released/);
assert.throws(
  () => retainedCallbackRuntime.callClosure(staleCallbackRootId, staleCallbackType, [4]),
  /closure root id is not live/,
);
retainedCallbackRuntime.dispose();

const nestedCallbackErrorRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input, input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => nestedCallbackErrorRuntime.call("HostInterop.callbackRoundTrip", 1),
  /callback expects 1 arguments, got 2/,
);
assert.equal(nestedCallbackErrorRuntime.liveCallbacks.size, 0);
nestedCallbackErrorRuntime.dispose();

const lifecycleDocumentState = createVirtualDocumentState();
const lifecycleRecords = [];
const lifecycleRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: lifecycleDocumentState,
  hostBindings: createCallbackHostBindings(lifecycleRecords),
});
ensureVirtualElementState(lifecycleDocumentState, "#callback");
assert.equal(lifecycleRuntime.call("HostInterop.mountCallbackEvent", "#callback"), "1");
lifecycleDocumentState.elements.get("#callback").listeners.get("click")[0].dispatch({});
assert.deepEqual(lifecycleRecords.splice(0), [101]);
lifecycleRuntime.dispose();
assert.equal(lifecycleRuntime.liveCallbacks.size, 0);
lifecycleDocumentState.elements.get("#callback").listeners.get("click")?.[0]?.dispatch({});
assert.deepEqual(lifecycleRecords.splice(0), []);

const lifecycleDocumentState2 = createVirtualDocumentState();
const lifecycleRecords2 = [];
const lifecycleRuntime2 = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: lifecycleDocumentState2,
  hostBindings: createCallbackHostBindings(lifecycleRecords2),
});
ensureVirtualElementState(lifecycleDocumentState2, "#callback");
assert.equal(lifecycleRuntime2.call("HostInterop.mountAndRemoveCallbackEvent", "#callback"), "1");
assert.equal(lifecycleRuntime2.liveCallbacks.size, 0);
lifecycleDocumentState2.elements.get("#callback").listeners.get("click")?.[0]?.dispatch({});
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.timeoutRecord", 40), "1");
await wait(10);
assert.deepEqual(lifecycleRecords2.splice(0), [41]);
assert.equal(lifecycleRuntime2.liveCallbacks.size, 0);
assert.equal(lifecycleRuntime2.call("HostInterop.clearTimeoutRecord", 40), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.startTimeoutLoop", 2), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), [2, 1, 0]);
assert.equal(lifecycleRuntime2.call("HostInterop.animationRecord", 50), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), [52]);
assert.equal(lifecycleRuntime2.call("HostInterop.cancelAnimationRecord", 50), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.startAnimationLoop", 2), "1");
await wait(80);
assert.deepEqual(lifecycleRecords2.splice(0), [2, 1, 0]);
lifecycleRuntime2.dispose();
assert.throws(() => lifecycleRuntime2.call("HostInterop.callbackRoundTrip", 1), /disposed/);

const pendingDocumentState = createVirtualDocumentState();
const pendingRecords = [];
const pendingRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: pendingDocumentState,
  hostBindings: createCallbackHostBindings(pendingRecords),
});
ensureVirtualElementState(pendingDocumentState, "#pending");
assert.equal(pendingRuntime.call("HostInterop.mountCallbackEvent", "#pending"), "1");
assert.equal(pendingRuntime.call("HostInterop.timeoutRecord", 70), "1");
assert.equal(pendingRuntime.call("HostInterop.animationRecord", 80), "1");
assert.equal(pendingRuntime.liveCallbacks.size, 3);
pendingRuntime.dispose();
assert.equal(pendingRuntime.liveCallbacks.size, 0);
pendingDocumentState.elements.get("#pending").listeners.get("click")?.[0]?.dispatch({});
await wait(40);
assert.deepEqual(pendingRecords.splice(0), []);

const reloadDocumentState = createVirtualDocumentState();
const reloadRecords = [];
const reloadRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: reloadDocumentState,
  hostBindings: createCallbackHostBindings(reloadRecords),
});
ensureVirtualElementState(reloadDocumentState, "#reload");
assert.equal(reloadRuntime.call("HostInterop.mountCallbackEvent", "#reload"), "1");
assert.equal(reloadRuntime.call("HostInterop.timeoutRecord", 90), "1");
assert.equal(reloadRuntime.call("HostInterop.animationRecord", 100), "1");
assert.equal(reloadRuntime.liveCallbacks.size, 3);
reloadRuntime.loadIrPackageBytes(irPackageBytes);
assert.equal(reloadRuntime.packageInfo.hostImports, 0);
assert.equal(reloadRuntime.liveCallbacks.size, 0);
assert.throws(() => reloadRuntime.call("HostInterop.callbackRoundTrip", 1), /interface entry not found/);
assert.equal(reloadRuntime.call("fib", 12), "144");
reloadDocumentState.elements.get("#reload").listeners.get("click")?.[0]?.dispatch({});
await wait(40);
assert.deepEqual(reloadRecords.splice(0), []);
reloadRuntime.dispose();

ensureTamagotchiVirtualDom(virtualDocumentState);
assert.equal(hostRuntime.call("Tamagotchi.uiMountFromDom"), "8");
assert.equal(hostRuntime.liveCallbacks.size, 8);
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
virtualDocumentState.elements.get("[data-action='ignore']").listeners.get("click")?.[0]?.dispatch({});
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-mood"), "angry");
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-trace"), "happy,hungry,angry");
virtualDocumentState.elements.get("#pet-reset-button").listeners.get("click")?.[0]?.dispatch({});
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-mood"), "happy");
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-trace"), "happy");
virtualDocumentState.elements.get("#pet-name-input").value = "Ada";
virtualDocumentState.elements.get("#pet-name-input").listeners.get("change")?.[0]?.dispatch({});
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-name"), "Ada");
hostRuntime.dispose();
assert.equal(hostRuntime.liveCallbacks.size, 0);

console.log("vir runtime host bindings smoke ok");
