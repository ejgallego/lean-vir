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
    if (state.released) {
      throw new Error("Vir callback has been released");
    }
    return state.runtime.callClosure(state.rootId, state.type, args);
  }

  release() {
    const state = requireVirCallbackState(this);
    if (state.released) return false;
    state.released = true;
    const errors = [];
    collectCleanupError(errors, () => state.runtime.releaseClosure(state.rootId));
    collectCleanupError(errors, () => state.runtime.untrackCallback(this));
    throwCollectedErrors(errors, "Vir callback release failed");
    return true;
  }

  dispose() {
    return this.release();
  }

  get released() {
    return requireVirCallbackState(this).released;
  }
}

Object.setPrototypeOf(VirCallback.prototype, Function.prototype);

export function createVirCallback(runtime, rootId, type) {
  if (!Number.isInteger(rootId) || rootId <= 0 || rootId > 0xffffffff) {
    throw new Error("callback root id must be a positive 32-bit integer");
  }
  const callback = function virCallback(...args) {
    return callback.call(...args);
  };
  Object.setPrototypeOf(callback, VirCallback.prototype);
  virCallbackStates.set(callback, {
    runtime,
    rootId,
    type,
    released: false,
  });
  runtime.trackCallback(callback);
  return callback;
}

export function isVirCallback(value) {
  return typeof value === "function" && virCallbackStates.has(value);
}

export function releaseCallbacks(callbacks) {
  const pending = Array.from(callbacks);
  if (Array.isArray(callbacks)) {
    callbacks.length = 0;
  } else if (typeof callbacks.clear === "function") {
    callbacks.clear();
  }
  const errors = [];
  for (const callback of pending) {
    collectCleanupError(errors, () => callback.release());
  }
  throwCollectedErrors(errors, "Vir callback releases failed");
}

function requireVirCallbackState(callback) {
  const state = virCallbackStates.get(callback);
  if (state === undefined) {
    throw new Error("Vir callback state is missing");
  }
  return state;
}
