/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  abortHostCallTransaction,
  beginHostCallTransaction,
  commitHostCallTransaction,
  disposeHostBindings,
} from "../host-boundary.js";
import {
  asError,
  collectCleanupError,
  throwCollectedErrors,
  throwWithCleanup,
} from "./cleanup.js";
import { HOST_IMPORT_BOUNDARY } from "./interface-manifest.js";
import { INTERFACE_TAG } from "./interface-tags.js";

const MAX_FINALIZER_ERRORS = 16;
const MAX_FINALIZER_ERROR_MESSAGE_LENGTH = 2048;

/** Host targets implemented directly by the object-handle dispatcher. */
export const RUNTIME_INTRINSIC_HOST_TARGETS = Object.freeze({
  leanRef: "js.leanRef",
  leanRefValue: "js.leanRef.value",
});

export class VirHostState {
  constructor({
    hostBindings = null,
    defaultHostBindings = null,
    ownsDefaultHostBindings = false,
  } = {}) {
    this.exports = null;
    this.manifest = null;
    this.hostImports = [];
    this.userBindings = hostBindings;
    this.defaultBindings = defaultHostBindings;
    this.ownsDefaultHostBindings = ownsDefaultHostBindings;
    this.runtime = null;
    this.leanObjectHandleCells = new Set();
    this.leanObjectHandleTrackingClosed = false;
    this.callError = null;
    this.callTimings = [];
    this.finalizerErrorMessages = [];
    this.droppedFinalizerErrors = 0;
    this.disposed = false;
    this.disposing = false;
  }

  attach(exports) {
    this.exports = exports;
  }

  attachRuntime(runtime) {
    this.runtime = runtime;
  }

  setManifest(manifest) {
    this.manifest = manifest;
    this.hostImports = manifest?.hostImports ?? [];
  }

  clearCallError() {
    this.callError = null;
  }

  beginCallTiming(timing) {
    this.callTimings.push(timing);
  }

  endCallTiming(timing) {
    if (this.callTimings.pop() !== timing) {
      throw new Error("Vir host call timing stack is inconsistent");
    }
  }

  recordCallError(error) {
    if (this.callError === null) {
      // Quarantine before inspecting an arbitrary thrown value.
      this.callError = new Error("JavaScript host exception", { cause: error });
      this.callError = asError(error, "JavaScript host exception");
    }
  }

  takeCallError() {
    const error = this.callError;
    this.callError = null;
    return error;
  }

  resourceRootCounts() {
    if (this.exports === null) return { active: 0, capacity: 0, reusable: 0 };
    return {
      active: this.exports.vir_resource_roots_active(),
      capacity: this.exports.vir_resource_roots_capacity(),
      reusable: this.exports.vir_resource_roots_reusable(),
    };
  }

  recordFinalizerError(error) {
    if (this.finalizerErrorMessages.length >= MAX_FINALIZER_ERRORS) {
      this.droppedFinalizerErrors++;
      return;
    }
    const name = error instanceof Error && error.name ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    this.finalizerErrorMessages.push(
      `${name}: ${message}`.slice(0, MAX_FINALIZER_ERROR_MESSAGE_LENGTH),
    );
  }

  takeFinalizerErrors() {
    const messages = this.finalizerErrorMessages.splice(0);
    const dropped = this.droppedFinalizerErrors;
    this.droppedFinalizerErrors = 0;
    if (dropped !== 0) {
      messages.push(
        `${dropped} additional finalizer error${dropped === 1 ? " was" : "s were"} discarded`,
      );
    }
    return messages.map((message) => new Error(message));
  }

  clearResourceRoots() {
    // Small hostless modules used by the raw boundary may have no resource ABI.
    this.exports?.vir_resource_roots_clear?.();
  }

  callObjects(slot, argvPtr, argc) {
    const timing = this.callTimings[this.callTimings.length - 1] ?? null;
    if (timing === null) return this.callObjectsImpl(slot, argvPtr, argc);
    const started = timing.beginHost();
    try {
      return this.callObjectsImpl(slot, argvPtr, argc);
    } finally {
      timing.endHost(started);
    }
  }

  callObjectsImpl(slot, argvPtr, argc) {
    if (this.runtime?.failure != null) throw this.runtime.failure;
    // A recorded exception belongs to the active JS call. Even if Lean catches
    // the IO error used for propagation, it must not dispatch further host work.
    if (this.callError !== null) throw this.callError;
    if (this.disposed) {
      throw new Error("Vir host state has been disposed");
    }
    if (this.exports === null) {
      throw new Error(
        "Vir host import called before WASM exports were attached",
      );
    }
    if (this.runtime === null) {
      throw new Error("Vir host import called before runtime was attached");
    }
    const entry = this.hostImports[slot] ?? null;
    if (entry === null) {
      throw new Error(`Vir host import slot ${slot} is not registered`);
    }
    if (entry.boundary === HOST_IMPORT_BOUNDARY.OBJECT_HANDLE) {
      return this.callObjectHandle(entry, argvPtr, argc);
    }
    const binding = lookupHostBinding(
      entry.target,
      this.userBindings,
      this.defaultBindings,
    );
    if (typeof binding !== "function") {
      throw new Error(`Vir host import binding not found: ${entry.target}`);
    }

    const explicitConversionTarget =
      entry.boundary === HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION;
    const argObjects = this.readObjectArgv(argvPtr, argc);
    if (argObjects.length !== entry.args.length) {
      throw new Error(
        `Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argObjects.length}`,
      );
    }
    // Lifted callbacks own their closure roots through JS reachability, even if
    // this call fails. Explicit host effects still use transactional rollback.
    const args = entry.args.map((arg, index) =>
      explicitConversionTarget
        ? this.runtime.liftObjectValue(
            arg.type,
            argObjects[index],
            `${entry.target} argument ${arg.name}`,
          )
        : this.runtime.liftJsObjectValue(
            arg.type,
            argObjects[index],
            `${entry.target} argument ${arg.name}`,
          ),
    );
    const transaction = beginHostCallTransaction();
    try {
      const value = binding(...args);
      if (this.runtime.failure != null) throw this.runtime.failure;
      if (
        !isGenericJsResourceDescriptor(entry.result) &&
        isPromiseLike(value)
      ) {
        throw new Error(
          `Vir host import ${entry.target} returned a Promise where ${entry.result?.type ?? "the declared result"} requires a synchronously lowered value`,
        );
      }
      const resultLabel = `${entry.target} result`;
      const resultObject = explicitConversionTarget
        ? this.runtime.makeObjectValue(entry.result, value, resultLabel)
        : this.runtime.makeJsObjectValue(entry.result, value, resultLabel);
      if (this.runtime.failure != null) throw this.runtime.failure;
      commitHostCallTransaction(transaction);
      return resultObject;
    } catch (error) {
      throwWithCleanup(
        error,
        () => abortHostCallTransaction(transaction),
        `Vir host import ${entry.target} failed during transactional rollback`,
      );
    }
  }

  callObjectHandle(entry, argvPtr, argc) {
    const argObjects = this.readObjectArgv(argvPtr, argc);
    if (argObjects.length !== entry.args.length) {
      throw new Error(
        `Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argObjects.length}`,
      );
    }
    if (
      entry.target === RUNTIME_INTRINSIC_HOST_TARGETS.leanRef &&
      entry.args.length === 1 &&
      isLeanObjectDescriptor(entry.args[0]?.type) &&
      isGenericJsResourceDescriptor(entry.result)
    ) {
      const resource = this.runtime.makeLeanObjectHandleResource(
        argObjects[0],
        `${entry.target} argument ${entry.args[0].name}`,
      );
      const cell = this.runtime.leanObjectHandleCell(
        resource,
        `${entry.target} result`,
      );
      try {
        return this.runtime.makeJsObjectValue(
          entry.result,
          resource,
          `${entry.target} result`,
        );
      } catch (error) {
        throwWithCleanup(
          error,
          () => this.runtime.releaseLeanObjectHandleCell(cell),
          `${entry.target} failed during result cleanup`,
        );
      }
    }
    if (
      entry.target === RUNTIME_INTRINSIC_HOST_TARGETS.leanRefValue &&
      entry.args.length === 1 &&
      isGenericJsResourceDescriptor(entry.args[0]?.type) &&
      isLeanObjectDescriptor(entry.result)
    ) {
      const resource = this.runtime.liftJsObjectValue(
        entry.args[0].type,
        argObjects[0],
        `${entry.target} argument ${entry.args[0].name}`,
      );
      return this.runtime.retainLeanObjectHandleValue(
        resource,
        `${entry.target} argument ${entry.args[0].name}`,
      );
    }
    throw new Error(
      `Vir host import ${entry.target} has unsupported objectHandle signature`,
    );
  }

  trackLeanObjectHandleCell(cell) {
    const isCallback = cell.callType != null;
    if (
      this.disposed ||
      this.runtime === null ||
      this.leanObjectHandleTrackingClosed ||
      (this.disposing && !isCallback)
    ) {
      throw new Error(
        "cannot track a Lean object handle in an inactive host state",
      );
    }
    cell.onRelease = () => {
      this.leanObjectHandleCells.delete(cell);
    };
    this.leanObjectHandleCells.add(cell);
    return cell;
  }

  readObjectArgv(argvPtr, argc) {
    if (argvPtr === 0 && argc !== 0) {
      throw new Error("Vir host import object argv pointer is null");
    }
    const view = new DataView(this.exports.memory.buffer, argvPtr, argc * 4);
    return Array.from({ length: argc }, (_value, index) =>
      view.getUint32(index * 4, true),
    );
  }

  dispose() {
    if (this.disposed || this.disposing) return;
    this.disposing = true;
    const errors = [];
    try {
      this.clearCallError();

      if (this.ownsDefaultHostBindings) {
        collectCleanupError(errors, () =>
          disposeHostBindings(this.defaultBindings),
        );
      }

      collectCleanupError(errors, () => this.releaseLeanObjectHandleCells());
      collectCleanupError(errors, () => this.clearResourceRoots());
      errors.push(...this.takeFinalizerErrors());
    } finally {
      this.disposed = true;
      this.disposing = false;
      this.runtime = null;
      this.exports = null;
      this.userBindings = null;
      this.defaultBindings = null;
    }
    throwCollectedErrors(errors, "Vir host state disposal failed");
  }

  releaseLeanObjectHandleCells() {
    // Providers may synchronously convert callbacks while cleaning up. Close
    // acquisition before the final snapshot so every accepted cell is retired.
    this.leanObjectHandleTrackingClosed = true;
    const errors = [];
    for (const cell of Array.from(this.leanObjectHandleCells)) {
      collectCleanupError(errors, () =>
        this.runtime.releaseLeanObjectHandleCell(cell),
      );
    }
    this.leanObjectHandleCells.clear();
    throwCollectedErrors(errors, "Lean object handle release failed");
  }
}

function isLeanObjectDescriptor(type) {
  return (
    type?.interfaceTag === INTERFACE_TAG.LEAN_OBJECT &&
    type?.kind === "leanObject"
  );
}

function isGenericJsResourceDescriptor(type) {
  return (
    type?.interfaceTag === INTERFACE_TAG.RESOURCE &&
    type?.kind === "resource" &&
    type?.name === "Lean.Vir.Js"
  );
}

function lookupHostBinding(target, userBindings, defaultBindings) {
  const userBinding = lookupHostBindingIn(target, userBindings);
  if (typeof userBinding === "function") {
    return userBinding;
  }
  return lookupHostBindingIn(target, defaultBindings);
}

function lookupHostBindingIn(target, bindings) {
  if (bindings === null || bindings === undefined) {
    return undefined;
  }
  if (bindings instanceof Map && bindings.has(target)) {
    return bindings.get(target);
  }
  if (typeof bindings === "object" && Object.hasOwn(bindings, target)) {
    return bindings[target];
  }
  return undefined;
}

function isPromiseLike(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}
