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
import { releaseHostResource, retainHostResource } from "../../web/src/host-resource.js";
import {
  assert,
  createCallbackHostBindings,
  jsNatResourceValue,
  readRuntimeArtifacts,
  wait,
} from "./shared.mjs";

const { wasmBytes, hostPackageBytes, defaultPackageBytes } = await readRuntimeArtifacts();

let retainedHostCallback = null;
let transferredHostCallback = null;
let throwFromRetainedHostCallback = false;
const retainedHostErrorDocumentState = createVirtualDocumentState();
const retainedHostErrorBindings = {
  "browser.element.addEventListener": (...args) => {
    transferredHostCallback = args[2];
    retainedHostCallback = transferredHostCallback.retain();
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
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: retainedHostErrorDocumentState,
  hostBindings: retainedHostErrorBindings,
});
ensureVirtualElementState(retainedHostErrorDocumentState, "#retained-host-error");
assert.equal(retainedHostErrorRuntime.call("HostInterop.mountCallbackEvent", "#retained-host-error"), "1");
assert.equal(transferredHostCallback.released, true);
assert.equal(retainedHostCallback.released, false);
const retainedHostEvent = retainedHostErrorDocumentState.resources.resourceForValue({});
throwFromRetainedHostCallback = true;
assert.throws(
  () => retainedHostCallback(retainedHostEvent),
  /retained callback host boom/,
);
throwFromRetainedHostCallback = false;
assert.doesNotThrow(() => retainedHostCallback(retainedHostEvent));
retainedHostErrorDocumentState.elements.get("#retained-host-error").listeners.get("click")[0].remove();
assert.equal(retainedHostCallback.released, false);
assert.equal(retainedHostErrorRuntime.liveCallbacks.size, 1);
assert.doesNotThrow(() => retainedHostCallback(retainedHostEvent));
retainedHostErrorDocumentState.resources.releaseResource(retainedHostEvent);
retainedHostErrorRuntime.dispose();
assert.equal(retainedHostCallback.released, true);

let transferredLeaseCallback = null;
let firstOwnedLease = null;
let secondOwnedLease = null;
const callbackLeaseRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      transferredLeaseCallback = callback;
      firstOwnedLease = callback.retain();
      secondOwnedLease = callback.retain();
      callback.release();
      return input;
    },
    "test.recordNat": () => undefined,
  },
});
assert.equal(callbackLeaseRuntime.call("HostInterop.callbackRoundTrip", 4), "4");
assert.notEqual(firstOwnedLease, transferredLeaseCallback);
assert.notEqual(secondOwnedLease, firstOwnedLease);
assert.equal(transferredLeaseCallback.released, true);
assert.equal(firstOwnedLease.released, false);
assert.equal(secondOwnedLease.released, false);
assert.equal(callbackLeaseRuntime.liveCallbacks.size, 1);
const leaseJsNat = (value) => callbackLeaseRuntime.hostState.defaultBindings["js.nat"](BigInt(value));
const leaseJsNatValue = (value) => callbackLeaseRuntime.hostState.defaultBindings["js.nat.value"](value);
assert.equal(leaseJsNatValue(firstOwnedLease(leaseJsNat(5))), 12n);
assert.equal(firstOwnedLease.release(), true);
assert.equal(firstOwnedLease.release(), false);
assert.equal(secondOwnedLease.released, false);
assert.equal(leaseJsNatValue(secondOwnedLease(leaseJsNat(6))), 13n);
assert.equal(callbackLeaseRuntime.liveCallbacks.size, 1);
assert.equal(secondOwnedLease.release(), true);
assert.equal(secondOwnedLease.released, true);
assert.equal(callbackLeaseRuntime.liveCallbacks.size, 0);
assert.throws(() => firstOwnedLease(leaseJsNat(1)), /released/);
callbackLeaseRuntime.dispose();

let failedRetainedTransfer = null;
let failedRetainedLease = null;
const failedRetainRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      failedRetainedTransfer = callback;
      failedRetainedLease = callback.retain();
      throw new Error("retained lease binding boom");
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => failedRetainRuntime.call("HostInterop.callbackRoundTrip", 1),
  /retained lease binding boom/,
);
assert.equal(failedRetainedTransfer.released, true);
assert.equal(failedRetainedLease.released, true);
assert.equal(failedRetainRuntime.liveCallbacks.size, 0);
assert.throws(() => failedRetainedLease(), /released/);
failedRetainRuntime.dispose();

let reentrantRuntime = null;
let reentrantDepth = 0;
let failedOuterCallback = null;
let retainedNestedCallback = null;
reentrantRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
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
  irPackageSetBytes: [hostPackageBytes],
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
  irPackageSetBytes: [hostPackageBytes],
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
  irPackageSetBytes: [hostPackageBytes],
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

let adoptedResultCallback = null;
let adoptedResultResource = null;
const adoptedResultDocumentState = createVirtualDocumentState();
const adoptedResultRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: adoptedResultDocumentState,
  hostBindings: {
    "test.callNatCallback": (_input, callback) => {
      adoptedResultCallback = callback;
      adoptedResultResource = adoptedResultRuntime.hostState.defaultBindings["js.value.react.eventHandler"]({
        name: "onClick",
        callback,
      });
      return adoptedResultResource;
    },
    "test.recordNat": () => undefined,
  },
});
const lowerAdoptedResult = adoptedResultRuntime.makeHostResourceObjectValue.bind(adoptedResultRuntime);
adoptedResultRuntime.makeHostResourceObjectValue = (type, value, label) => {
  if (value === adoptedResultResource) {
    throw new Error("adopted host result lowering boom");
  }
  return lowerAdoptedResult(type, value, label);
};
assert.throws(
  () => adoptedResultRuntime.call("HostInterop.callbackRoundTrip", 1),
  /adopted host result lowering boom/,
);
assert.equal(adoptedResultCallback.released, true);
assert.equal(adoptedResultRuntime.liveCallbacks.size, 0);
assert.equal(
  adoptedResultDocumentState.resources.debugResourceCounts().owners,
  0,
  "failed result lowering must release a resource that adopted the callback",
);
assert.throws(
  () => adoptedResultDocumentState.resources.resolveResource(adoptedResultResource, "React event handler"),
  /resource is not live/,
);
adoptedResultRuntime.makeHostResourceObjectValue = lowerAdoptedResult;
adoptedResultRuntime.dispose();

const abandonedListenerDocumentState = createVirtualDocumentState();
ensureVirtualElementState(abandonedListenerDocumentState, "#abandoned-listener-result");
const abandonedListenerRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: abandonedListenerDocumentState,
  hostBindings: {
    "test.recordNat": () => undefined,
  },
});
const lowerAbandonedListenerResult = abandonedListenerRuntime.makeHostResourceObjectValue.bind(
  abandonedListenerRuntime,
);
abandonedListenerRuntime.makeHostResourceObjectValue = (type, value, label) => {
  if (label === "browser.element.addEventListener result") {
    throw new Error("active listener result lowering boom");
  }
  return lowerAbandonedListenerResult(type, value, label);
};
assert.throws(
  () => abandonedListenerRuntime.call("HostInterop.mountCallbackEvent", "#abandoned-listener-result"),
  /active listener result lowering boom/,
);
const abandonedListenerTarget = abandonedListenerDocumentState.elements.get("#abandoned-listener-result");
assert.equal(
  abandonedListenerTarget.listeners.get("click")?.length ?? 0,
  0,
  "failed result lowering must remove the listener installed by that call",
);
assert.equal(
  abandonedListenerDocumentState.resources.debugResourceCounts().owners,
  0,
  "failed result lowering must release the active registration owner",
);
assert.equal(abandonedListenerRuntime.liveCallbacks.size, 0);
abandonedListenerRuntime.makeHostResourceObjectValue = lowerAbandonedListenerResult;
abandonedListenerRuntime.dispose();

for (const existingRoot of [false, true]) {
  const selector = existingRoot
    ? "#selector-result-existing-root"
    : "#selector-result-new-root";
  const documentState = createVirtualDocumentState();
  const target = ensureVirtualElementState(documentState, selector);
  const selectorResultRuntime = await createVirRuntime({
    wasmBytes,
    irPackageSetBytes: [hostPackageBytes],
    virtualDocumentState: documentState,
    hostBindings: { "test.recordNat": () => undefined },
  });
  if (existingRoot) {
    assert.equal(
      selectorResultRuntime.call("ReactCounter.renderStaticIntoSelector", selector),
      true,
    );
    assert.ok(target.reactRoot, "the setup render must create the existing selector root");
  }
  const lowerSelectorResult = selectorResultRuntime.makeHostResourceObjectValue.bind(
    selectorResultRuntime,
  );
  selectorResultRuntime.makeHostResourceObjectValue = (type, value, label) => {
    if (label === "react.root.renderComponentIntoSelector result") {
      throw new Error("selector result lowering boom");
    }
    return lowerSelectorResult(type, value, label);
  };
  assert.throws(
    () => selectorResultRuntime.call("ReactCounter.renderStaticIntoSelector", selector),
    /selector result lowering boom/,
  );
  assert.equal(
    target.reactRoot ?? null,
    null,
    "failed selector result publication must terminate the affected root",
  );
  assert.equal(
    documentState.resources.debugResourceCounts().owners,
    0,
    "failed selector result publication must release every root owner",
  );
  assert.equal(
    selectorResultRuntime.liveCallbacks.size,
    0,
    "failed selector result publication must not leave a mounted dead callback",
  );
  selectorResultRuntime.makeHostResourceObjectValue = lowerSelectorResult;
  selectorResultRuntime.dispose();
}

let combinedFailureCallback = null;
const combinedFailureRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
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
  irPackageSetBytes: [hostPackageBytes],
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
  irPackageSetBytes: [hostPackageBytes],
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

let disposePhaseCallback = null;
let disposePhaseInput = null;
let disposePhaseResult = null;
const disposePhaseBindings = {
  "test.callNatCallback": (input, callback) => {
    disposePhaseInput = retainHostResource(input, "dispose-phase callback input");
    disposePhaseCallback = callback;
    return input;
  },
  "test.recordNat": () => undefined,
  [VIR_HOST_DISPOSE]() {
    try {
      disposePhaseResult = jsNatResourceValue(disposePhaseCallback(disposePhaseInput));
    } finally {
      disposePhaseCallback.release();
      releaseHostResource(disposePhaseInput);
    }
  },
};
const disposePhaseRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  hostBindings: disposePhaseBindings,
});
assert.equal(disposePhaseRuntime.call("HostInterop.callbackRoundTrip", 3), "3");
assert.doesNotThrow(() => disposePhaseRuntime.dispose());
assert.equal(disposePhaseResult, 10n);
assert.equal(disposePhaseRuntime.liveCallbacks.size, 0);

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
  scoped: 0,
  temporaryScopes: 0,
  owners: 0,
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
  irPackageSetBytes: [hostPackageBytes],
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
  irPackageSetBytes: [hostPackageBytes],
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
  () => handoverTeardownRuntime.loadIrPackageSetBytes([defaultPackageBytes]),
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
