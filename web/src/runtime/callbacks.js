/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

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
    state.runtime.releaseClosure(state.rootId);
    state.runtime.untrackCallback(this);
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
  for (const callback of callbacks) {
    callback.release();
  }
  callbacks.length = 0;
}

function requireVirCallbackState(callback) {
  const state = virCallbackStates.get(callback);
  if (state === undefined) {
    throw new Error("Vir callback state is missing");
  }
  return state;
}
