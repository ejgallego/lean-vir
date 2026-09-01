/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { collectCleanupError, throwCollectedErrors } from "./cleanup.js";

const callbackRoots = new WeakMap();
const callbackFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((root) => finalizeCallbackRoot(root))
    : null;

export function createVirCallback(runtime, rootId, type) {
  if (!Number.isInteger(rootId) || rootId <= 0 || rootId > 0xffffffff) {
    throw new Error("callback root id must be a positive 32-bit integer");
  }
  const root = {
    runtime,
    rootId,
    type,
    released: false,
  };
  const callback = function virCallback(...args) {
    if (root.released)
      throw new Error("Vir callback belongs to a disposed runtime");
    return root.runtime.callClosure(root.rootId, root.type, args);
  };
  callbackRoots.set(callback, root);
  callbackFinalizer?.register(callback, root, root);
  runtime.trackCallback(root);
  return callback;
}

export function releaseCallbackRoot(callbackOrRoot) {
  return releaseVirCallbackRoot(requireCallbackRoot(callbackOrRoot));
}

export function releaseCallbackRoots(callbacks) {
  const roots = new Set(Array.from(callbacks, requireCallbackRoot));
  if (Array.isArray(callbacks)) callbacks.length = 0;
  else if (typeof callbacks.clear === "function") callbacks.clear();
  const errors = [];
  for (const root of roots) {
    collectCleanupError(errors, () => releaseVirCallbackRoot(root));
  }
  throwCollectedErrors(errors, "Vir callback root releases failed");
}

function releaseVirCallbackRoot(root, { unregister = true } = {}) {
  if (root.released) return false;
  root.released = true;
  if (unregister) callbackFinalizer?.unregister(root);
  const errors = [];
  collectCleanupError(errors, () => root.runtime.releaseClosure(root.rootId));
  collectCleanupError(errors, () => root.runtime.untrackCallback(root));
  throwCollectedErrors(errors, "Vir callback root release failed");
  return true;
}

function finalizeCallbackRoot(root) {
  try {
    releaseVirCallbackRoot(root, { unregister: false });
  } catch (error) {
    try {
      root.runtime.hostState?.recordFinalizerError(error);
    } catch {
      // Finalization must never surface through the host job queue.
    }
  }
}

function requireCallbackRoot(value) {
  const root = callbackRoots.get(value) ?? value;
  if (
    root === null ||
    typeof root !== "object" ||
    !Number.isInteger(root.rootId) ||
    typeof root.runtime !== "object"
  ) {
    throw new Error("Vir callback root is missing");
  }
  return root;
}
