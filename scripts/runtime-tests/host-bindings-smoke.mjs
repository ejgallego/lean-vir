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
  jsNatResourceValue,
  readRuntimeArtifacts,
  wait,
} from "./shared.mjs";
import { createHostResourceState } from "../../web/src/vir-host-bindings.js";
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
const retainedJsNat = (value) => retainedCallbackRuntime.hostState.defaultBindings["js.nat"](BigInt(value));
const retainedJsNatValue = (value) => retainedCallbackRuntime.hostState.defaultBindings["js.nat.value"](value);
assert.equal(retainedJsNatValue(retainedCallback(retainedJsNat(4))), 11n);
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
  () => retainedCallbackRuntime.callClosure(staleCallbackRootId, staleCallbackType, [retainedJsNat(4)]),
  /closure root id is not live/,
);
retainedCallbackRuntime.dispose();

let retainedHostCallback = null;
let throwFromRetainedHostCallback = false;
const retainedHostErrorDocumentState = createVirtualDocumentState();
const retainedHostErrorBindings = {
  "browser.element.addEventListener": (...args) => {
    retainedHostCallback = args[2];
    return retainedHostErrorRuntime.hostState.defaultBindings["browser.element.addEventListener"](...args);
  },
  "test.recordNat": () => {
    if (throwFromRetainedHostCallback) {
      throw new Error("retained callback host boom");
    }
    return undefined;
  },
};
let retainedHostErrorRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: retainedHostErrorDocumentState,
  hostBindings: retainedHostErrorBindings,
});
ensureVirtualElementState(retainedHostErrorDocumentState, "#retained-host-error");
assert.equal(retainedHostErrorRuntime.call("HostInterop.mountCallbackEvent", "#retained-host-error"), "1");
const retainedHostEvent = retainedHostErrorDocumentState.resources.resourceForValue({});
throwFromRetainedHostCallback = true;
assert.throws(
  () => retainedHostCallback(retainedHostEvent),
  /retained callback host boom/,
);
throwFromRetainedHostCallback = false;
assert.doesNotThrow(() => retainedHostCallback(retainedHostEvent));
retainedHostErrorDocumentState.resources.releaseResource(retainedHostEvent);
retainedHostErrorRuntime.dispose();
assert.equal(retainedHostCallback.released, true);

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

let throwingCallback = null;
const throwingBindingRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      throwingCallback = callback;
      throw new Error("host binding boom");
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => throwingBindingRuntime.call("HostInterop.callbackRoundTrip", 1),
  /host binding boom/,
);
assert.ok(throwingCallback);
assert.equal(throwingCallback.released, true);
assert.equal(throwingBindingRuntime.liveCallbacks.size, 0);
throwingBindingRuntime.dispose();

let reentrantRuntime = null;
let reentrantDepth = 0;
let failedOuterCallback = null;
let retainedNestedCallback = null;
reentrantRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      if (reentrantDepth !== 0) {
        retainedNestedCallback = callback;
        return input;
      }
      failedOuterCallback = callback;
      reentrantDepth += 1;
      try {
        assert.equal(reentrantRuntime.call("HostInterop.callbackRoundTrip", 2), "2");
        throw new Error("outer reentrant binding boom");
      } finally {
        reentrantDepth -= 1;
      }
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => reentrantRuntime.call("HostInterop.callbackRoundTrip", 1),
  /outer reentrant binding boom/,
);
assert.equal(failedOuterCallback.released, true);
assert.equal(retainedNestedCallback.released, false);
assert.equal(reentrantRuntime.liveCallbacks.size, 1);
assert.equal(
  reentrantRuntime.hostState.defaultBindings["js.nat.value"](
    retainedNestedCallback(reentrantRuntime.hostState.defaultBindings["js.nat"](3n)),
  ),
  10n,
);
retainedNestedCallback.release();
reentrantRuntime.dispose();

let argumentLiftCallback = null;
const argumentLiftRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: createCallbackHostBindings(),
});
const liftHostResourceObjectValue = argumentLiftRuntime.liftHostResourceObjectValue.bind(argumentLiftRuntime);
argumentLiftRuntime.liftHostResourceObjectValue = (...args) => {
  const value = liftHostResourceObjectValue(...args);
  if (typeof value === "function" && typeof value.release === "function") {
    argumentLiftCallback = value;
    throw new Error("host argument lift boom");
  }
  return value;
};
assert.throws(
  () => argumentLiftRuntime.call("HostInterop.callbackRoundTrip", 1),
  /host argument lift boom/,
);
assert.ok(argumentLiftCallback);
assert.equal(argumentLiftCallback.released, true);
assert.equal(argumentLiftRuntime.liveCallbacks.size, 0);
argumentLiftRuntime.liftHostResourceObjectValue = liftHostResourceObjectValue;
argumentLiftRuntime.dispose();

let promiseCallback = null;
const promiseBindingRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      promiseCallback = callback;
      return Promise.resolve(null);
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => promiseBindingRuntime.call("HostInterop.callbackRoundTrip", 1),
  /returned a Promise; host imports must be synchronous/,
);
assert.ok(promiseCallback);
assert.equal(promiseCallback.released, true);
assert.equal(promiseBindingRuntime.liveCallbacks.size, 0);
promiseBindingRuntime.dispose();

let resultLiftCallback = null;
const resultLiftRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      resultLiftCallback = callback;
      return 17;
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => resultLiftRuntime.call("HostInterop.callbackRoundTrip", 1),
  /must be a live host resource/,
);
assert.ok(resultLiftCallback);
assert.equal(resultLiftCallback.released, true);
assert.equal(resultLiftRuntime.liveCallbacks.size, 0);
resultLiftRuntime.dispose();

const callbackErrorDocumentState = createVirtualDocumentState();
const callbackErrorRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: callbackErrorDocumentState,
  hostBindings: {
    "test.callNatCallback": createCallbackHostBindings()["test.callNatCallback"],
    "test.recordNat": (value) => {
      throw new Error(`scheduled callback host boom ${jsNatResourceValue(value)}`);
    },
  },
});
ensureVirtualElementState(callbackErrorDocumentState, "#callback-error");
const reportedCallbackErrors = [];
const reportConsoleError = console.error;
console.error = (error) => {
  reportedCallbackErrors.push(error);
};
try {
  assert.equal(callbackErrorRuntime.call("HostInterop.mountCallbackEvent", "#callback-error"), "1");
  callbackErrorDocumentState.elements.get("#callback-error").listeners.get("click")[0].dispatch({});
  assert.equal(callbackErrorRuntime.call("HostInterop.timeoutRecord", 40), "1");
  await wait(10);
  assert.equal(callbackErrorRuntime.call("HostInterop.animationRecord", 50), "1");
  await wait(30);
} finally {
  console.error = reportConsoleError;
}
assert.deepEqual(
  reportedCallbackErrors.map((error) => error.message),
  [
    "scheduled callback host boom 101",
    "scheduled callback host boom 41",
    "scheduled callback host boom 52",
  ],
);
callbackErrorRuntime.dispose();

const callbackReleaseRuntimeCallbacks = [];
const callbackReleaseRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      callbackReleaseRuntimeCallbacks.push(callback);
      return input;
    },
    "test.recordNat": () => undefined,
  },
});
assert.equal(callbackReleaseRuntime.call("HostInterop.callbackRoundTrip", 1), "1");
assert.equal(callbackReleaseRuntime.call("HostInterop.callbackRoundTrip", 2), "2");
const releaseCallbackClosure = callbackReleaseRuntime.releaseClosure.bind(callbackReleaseRuntime);
let callbackReleaseCount = 0;
callbackReleaseRuntime.releaseClosure = (rootId) => {
  releaseCallbackClosure(rootId);
  callbackReleaseCount += 1;
  throw new Error(`callback release boom ${callbackReleaseCount}`);
};
assert.throws(
  () => callbackReleaseRuntime.dispose(),
  (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((item) => item.message), [
      "callback release boom 1",
      "callback release boom 2",
    ]);
    return true;
  },
);
assert.equal(callbackReleaseRuntime.liveCallbacks.size, 0);
assert.equal(callbackReleaseRuntimeCallbacks.every((callback) => callback.released), true);
assert.throws(() => callbackReleaseRuntime.call("HostInterop.callbackRoundTrip", 1), /disposed/);
assert.doesNotThrow(() => callbackReleaseRuntime.dispose());

const throwingResources = createHostResourceState();
const throwingResourceCleanup = [];
const liveThrowingResource = throwingResources.resourceForValue({ kind: "cleanup sentinel" });
throwingResources.addDisposable({
  dispose() {
    throwingResourceCleanup.push("first");
    throw new Error("first resource disposer boom");
  },
});
throwingResources.addDisposable({
  dispose() {
    throwingResourceCleanup.push("second");
    throw new Error("second resource disposer boom");
  },
});
assert.throws(
  () => throwingResources.dispose(),
  (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((item) => item.message), [
      "first resource disposer boom",
      "second resource disposer boom",
    ]);
    return true;
  },
);
assert.deepEqual(throwingResourceCleanup, ["first", "second"]);
assert.deepEqual(throwingResources.debugResourceCounts(), {
  live: 0,
  primitives: 0,
  temporaryScopes: 0,
  disposables: 0,
});
assert.throws(() => throwingResources.resolveResource(liveThrowingResource, "cleanup sentinel"), /not live/);
assert.doesNotThrow(() => throwingResources.dispose());

let teardownCallback = null;
const throwingBindingCleanup = [];
const throwingBindingMap = {
  "test.callNatCallback": (input, callback) => {
    teardownCallback = callback;
    return input;
  },
  "test.recordNat": () => undefined,
  [VIR_HOST_DISPOSE]() {
    throwingBindingCleanup.push("user");
    throw new Error("user binding disposer boom");
  },
};
const throwingTeardownRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: throwingBindingMap,
});
assert.equal(throwingTeardownRuntime.call("HostInterop.callbackRoundTrip", 3), "3");
assert.equal(throwingTeardownRuntime.liveCallbacks.size, 1);
const disposeDefaultBindings = throwingTeardownRuntime.hostState.defaultBindings[VIR_HOST_DISPOSE];
throwingTeardownRuntime.hostState.defaultBindings[VIR_HOST_DISPOSE] = function disposeThrowingDefaults() {
  try {
    disposeDefaultBindings.call(this);
  } finally {
    throwingBindingCleanup.push("default");
    throw new Error("default binding disposer boom");
  }
};
assert.throws(
  () => throwingTeardownRuntime.dispose(),
  (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((item) => item.message), [
      "user binding disposer boom",
      "default binding disposer boom",
    ]);
    return true;
  },
);
assert.deepEqual(throwingBindingCleanup, ["user", "default"]);
assert.equal(teardownCallback.released, true);
assert.equal(throwingTeardownRuntime.liveCallbacks.size, 0);
assert.throws(() => throwingTeardownRuntime.call("HostInterop.callbackRoundTrip", 1), /disposed/);
assert.doesNotThrow(() => throwingTeardownRuntime.dispose());

let handoverTeardownCallback = null;
const handoverTeardownRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      handoverTeardownCallback = callback;
      return input;
    },
    "test.recordNat": () => undefined,
  },
});
assert.equal(handoverTeardownRuntime.call("HostInterop.callbackRoundTrip", 4), "4");
const disposeHandoverDefaults = handoverTeardownRuntime.hostState.defaultBindings[VIR_HOST_DISPOSE];
handoverTeardownRuntime.hostState.defaultBindings[VIR_HOST_DISPOSE] = function disposeOldHandoverDefaults() {
  try {
    disposeHandoverDefaults.call(this);
  } finally {
    throw new Error("old package teardown boom");
  }
};
assert.throws(
  () => handoverTeardownRuntime.loadIrPackageBytes(irPackageBytes),
  /old package teardown boom/,
);
assert.equal(handoverTeardownCallback.released, true);
assert.equal(handoverTeardownRuntime.liveCallbacks.size, 0);
assert.throws(() => handoverTeardownRuntime.call("HostInterop.callbackRoundTrip", 1), /disposed/);
assert.doesNotThrow(() => handoverTeardownRuntime.dispose());

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
let reloadBindingDisposals = 0;
const reloadBindings = {
  ...createCallbackHostBindings(reloadRecords),
  [VIR_HOST_DISPOSE]() {
    reloadBindingDisposals += 1;
  },
};
const reloadRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: reloadDocumentState,
  hostBindings: reloadBindings,
});
ensureVirtualElementState(reloadDocumentState, "#reload");
assert.equal(reloadRuntime.call("HostInterop.mountCallbackEvent", "#reload"), "1");
assert.equal(reloadRuntime.call("HostInterop.timeoutRecord", 90), "1");
assert.equal(reloadRuntime.call("HostInterop.animationRecord", 100), "1");
assert.equal(reloadRuntime.liveCallbacks.size, 3);
const badReloadPackage = Uint8Array.from(hostPackageBytes);
badReloadPackage[4] ^= 1;
assert.throws(
  () => reloadRuntime.loadIrPackageBytes(badReloadPackage),
  /invalid IR package magic/,
);
assert.equal(reloadBindingDisposals, 0);
assert.equal(reloadRuntime.liveCallbacks.size, 3);
assert.equal(reloadRuntime.call("HostInterop.callbackRoundTrip", 3), "10");
reloadRuntime.loadIrPackageBytes(irPackageBytes);
assert.equal(reloadBindingDisposals, 0);
assert.equal(reloadRuntime.packageInfo.hostImports, 0);
assert.equal(reloadRuntime.liveCallbacks.size, 0);
assert.throws(() => reloadRuntime.call("HostInterop.callbackRoundTrip", 1), /interface entry not found/);
assert.equal(reloadRuntime.call("fib", 12), "144");
reloadDocumentState.elements.get("#reload").listeners.get("click")?.[0]?.dispatch({});
await wait(40);
assert.deepEqual(reloadRecords.splice(0), []);
reloadRuntime.dispose();
assert.equal(reloadBindingDisposals, 1);

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
