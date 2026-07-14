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
import { createHostResourceState } from "../../web/src/vir-host-bindings.js";
import {
  assert,
  createCallbackHostBindings,
  jsNatResourceValue,
  readRuntimeArtifacts,
  wait,
} from "./shared.mjs";

const { wasmBytes, hostPackageBytes, irPackageBytes } = await readRuntimeArtifacts();

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
const retainedHostErrorRuntime = await createVirRuntime({
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

let combinedFailureCallback = null;
const combinedFailureRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      combinedFailureCallback = callback;
      throw new Error("combined host binding boom");
    },
    "test.recordNat": () => undefined,
  },
});
const releaseCombinedFailureClosure = combinedFailureRuntime.releaseClosure.bind(combinedFailureRuntime);
combinedFailureRuntime.releaseClosure = (rootId) => {
  releaseCombinedFailureClosure(rootId);
  throw new Error("combined callback cleanup boom");
};
assertAggregateMessages(
  () => combinedFailureRuntime.call("HostInterop.callbackRoundTrip", 1),
  ["combined host binding boom", "combined callback cleanup boom"],
);
assert.equal(combinedFailureCallback.released, true);
assert.equal(combinedFailureRuntime.liveCallbacks.size, 0);
combinedFailureRuntime.dispose();

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
assertAggregateMessages(
  () => callbackReleaseRuntime.dispose(),
  ["callback release boom 1", "callback release boom 2"],
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
assertAggregateMessages(
  () => throwingResources.dispose(),
  ["first resource disposer boom", "second resource disposer boom"],
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
assertAggregateMessages(
  () => throwingTeardownRuntime.dispose(),
  ["user binding disposer boom", "default binding disposer boom"],
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

console.log("vir callback lifecycle smoke ok");

function assertAggregateMessages(run, messages) {
  assert.throws(
    run,
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors.map((item) => item.message), messages);
      return true;
    },
  );
}
