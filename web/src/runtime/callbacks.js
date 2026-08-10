/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { collectCleanupError, throwCollectedErrors } from "./cleanup.js";

const virCallbackStates = new WeakMap();
const virCallbackRootTrackers = new WeakMap();
const virCallbackFinalizer = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry((lease) => finalizeVirCallbackLease(lease))
  : null;

export class VirCallback {
  call(...args) {
    const state = requireVirCallbackState(this);
    if (state.released || state.root.released) {
      throw new Error("Vir callback has been released");
    }
    return state.root.runtime.callClosure(state.root.rootId, state.root.type, args);
  }

  retain() {
    const state = requireVirCallbackState(this);
    if (state.released || state.root.released) {
      throw new Error("Vir callback has been released");
    }
    return createVirCallbackLease(state.root);
  }

  release() {
    return releaseVirCallbackLease(requireVirCallbackState(this));
  }

  dispose() {
    return this.release();
  }

  get released() {
    const state = requireVirCallbackState(this);
    return state.released || state.root.released;
  }
}

Object.setPrototypeOf(VirCallback.prototype, Function.prototype);

export function createVirCallback(runtime, rootId, type) {
  if (!Number.isInteger(rootId) || rootId <= 0 || rootId > 0xffffffff) {
    throw new Error("callback root id must be a positive 32-bit integer");
  }
  const root = {
    runtime,
    rootId,
    type,
    leases: new Set(),
    tracker: null,
    released: false,
  };
  const tracker = Object.freeze({});
  root.tracker = tracker;
  virCallbackRootTrackers.set(tracker, root);
  const callback = createVirCallbackLease(root);
  runtime.trackCallback(tracker);
  return callback;
}

function createVirCallbackLease(root) {
  const lease = {
    root,
    released: false,
  };
  const callback = function virCallback(...args) {
    return callback.call(...args);
  };
  Object.setPrototypeOf(callback, VirCallback.prototype);
  virCallbackStates.set(callback, lease);
  root.leases.add(lease);
  virCallbackFinalizer?.register(callback, lease, lease);
  return callback;
}

function releaseVirCallbackLease(lease, { unregister = true } = {}) {
  if (lease.released || lease.root.released) return false;
  lease.released = true;
  if (unregister) virCallbackFinalizer?.unregister(lease);
  lease.root.leases.delete(lease);
  if (lease.root.leases.size === 0) {
    releaseVirCallbackRoot(lease.root);
  }
  return true;
}

function finalizeVirCallbackLease(lease) {
  try {
    releaseVirCallbackLease(lease, { unregister: false });
  } catch (error) {
    try {
      lease.root.runtime.hostState?.recordFinalizerError(error);
    } catch {
      // Finalization must never surface an exception through the host job queue.
    }
  }
}

// Takes the callback lease transferred into a built-in host binding and gives
// the long-lived owner a distinct, independently releasable lease. Minimal
// releasable callback stand-ins used by direct binding tests already represent
// their only lease and are kept compatible here.
export function takeCallbackLease(callback, label = "Vir callback") {
  if (typeof callback !== "function" || typeof callback.release !== "function") {
    throw new Error(`${label} must be a releasable function`);
  }
  if (typeof callback.retain !== "function") {
    return callback;
  }
  const lease = retainCallbackLease(callback, label);
  try {
    callback.release();
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, () => lease.release());
    throwCollectedErrors(errors, `${label} lease transfer failed`);
  }
  return lease;
}

// Borrows the supplied lease and gives another owner an independent lease.
// Unlike takeCallbackLease, this never releases the source callback.
export function retainCallbackLease(callback, label = "Vir callback") {
  if (typeof callback !== "function" || typeof callback.release !== "function") {
    throw new Error(`${label} must be a releasable function`);
  }
  if (typeof callback.retain !== "function") {
    throw new Error(`${label} must support retain() for independent ownership`);
  }
  const lease = callback.retain();
  if (lease === callback || typeof lease !== "function" || typeof lease.release !== "function") {
    if (lease !== callback && typeof lease?.release === "function") {
      lease.release();
    }
    throw new Error(`${label}.retain() must return a distinct releasable function`);
  }
  return lease;
}

export function releaseCallbacks(callbacks) {
  const pending = takeCallbacks(callbacks);
  const errors = [];
  for (const callback of pending) {
    collectCleanupError(errors, () => callback.release());
  }
  throwCollectedErrors(errors, "Vir callback releases failed");
}

export function releaseCallbackRoots(callbacks) {
  const pending = takeCallbacks(callbacks);
  const roots = new Set();
  for (const callbackOrTracker of pending) {
    roots.add(requireVirCallbackRoot(callbackOrTracker));
  }
  const errors = [];
  for (const root of roots) {
    collectCleanupError(errors, () => releaseVirCallbackRoot(root));
  }
  throwCollectedErrors(errors, "Vir callback root releases failed");
}

function releaseVirCallbackRoot(root) {
  if (root.released) return false;
  root.released = true;
  for (const lease of root.leases) {
    lease.released = true;
    virCallbackFinalizer?.unregister(lease);
  }
  root.leases.clear();
  const errors = [];
  collectCleanupError(errors, () => root.runtime.releaseClosure(root.rootId));
  collectCleanupError(errors, () => root.runtime.untrackCallback(root.tracker));
  throwCollectedErrors(errors, "Vir callback root release failed");
  return true;
}

function requireVirCallbackRoot(callbackOrTracker) {
  const trackedRoot = virCallbackRootTrackers.get(callbackOrTracker);
  if (trackedRoot !== undefined) return trackedRoot;
  return requireVirCallbackState(callbackOrTracker).root;
}

function takeCallbacks(callbacks) {
  const pending = Array.from(callbacks);
  if (Array.isArray(callbacks)) {
    callbacks.length = 0;
  } else if (typeof callbacks.clear === "function") {
    callbacks.clear();
  }
  return pending;
}

function requireVirCallbackState(callback) {
  const state = virCallbackStates.get(callback);
  if (state === undefined) {
    throw new Error("Vir callback state is missing");
  }
  return state;
}
