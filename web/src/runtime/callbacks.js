/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { collectCleanupError, throwCollectedErrors } from "./cleanup.js";

const virCallbackStates = new WeakMap();

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
    const state = requireVirCallbackState(this);
    if (state.released || state.root.released) return false;
    state.released = true;
    state.root.leases.delete(this);
    if (state.root.leases.size === 0) {
      releaseVirCallbackRoot(state.root);
    }
    return true;
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
  const callback = createVirCallbackLease(root);
  root.tracker = callback;
  runtime.trackCallback(callback);
  return callback;
}

function createVirCallbackLease(root) {
  const callback = function virCallback(...args) {
    return callback.call(...args);
  };
  Object.setPrototypeOf(callback, VirCallback.prototype);
  virCallbackStates.set(callback, {
    root,
    released: false,
  });
  root.leases.add(callback);
  return callback;
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
  for (const callback of pending) {
    roots.add(requireVirCallbackState(callback).root);
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
  for (const callback of root.leases) {
    const state = virCallbackStates.get(callback);
    if (state !== undefined) {
      state.released = true;
    }
  }
  root.leases.clear();
  const errors = [];
  collectCleanupError(errors, () => root.runtime.releaseClosure(root.rootId));
  collectCleanupError(errors, () => root.runtime.untrackCallback(root.tracker));
  throwCollectedErrors(errors, "Vir callback root release failed");
  return true;
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
