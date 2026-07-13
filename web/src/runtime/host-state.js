/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { ExternrefResourceRoots, VIR_HOST_DISPOSE, VIR_HOST_RESOLVE_BINDING } from "../host-resource.js";
import { createBrowserHostBindings } from "../vir-host-bindings.js";
import { releaseCallbacks } from "./callbacks.js";
import { collectCleanupError, throwCollectedErrors, throwWithCleanup } from "./cleanup.js";
import { HOST_IMPORT_BOUNDARY } from "./interface-manifest.js";
import { INTERFACE_TAG } from "./interface-tags.js";

export class VirHostState {
  constructor({
    hostBindings = null,
    defaultHostBindings = createBrowserHostBindings(),
    releaseHostBindings = null,
    releaseDefaultHostBindings = null,
  } = {}) {
    this.exports = null;
    this.manifest = null;
    this.hostImports = [];
    this.userBindings = hostBindings;
    this.defaultBindings = defaultHostBindings;
    this.releaseHostBindings = releaseHostBindings;
    this.releaseDefaultHostBindings = releaseDefaultHostBindings;
    this.runtime = null;
    this.resourceRoots = new ExternrefResourceRoots();
    this.leanObjectHandleCells = new Set();
    this.callError = null;
    this.disposed = false;
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

  recordCallError(error) {
    if (this.callError === null) {
      this.callError = error instanceof Error ? error : new Error(String(error));
    }
  }

  takeCallError() {
    const error = this.callError;
    this.callError = null;
    return error;
  }

  rootResource(value) {
    return this.resourceRoots.root(value);
  }

  getRootedResource(rootId) {
    return this.resourceRoots.get(rootId);
  }

  releaseRootedResource(rootId) {
    return this.resourceRoots.release(rootId);
  }

  clearResourceRoots() {
    this.resourceRoots.clear();
  }

  callObjects(slot, argvPtr, argc) {
    if (this.disposed) {
      throw new Error("Vir host state has been disposed");
    }
    if (this.exports === null) {
      throw new Error("Vir host import called before WASM exports were attached");
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
    const binding = lookupHostBinding(entry.target, this.userBindings, this.defaultBindings);
    if (typeof binding !== "function") {
      throw new Error(`Vir host import binding not found: ${entry.target}`);
    }

    const args = [];
    const liftedCallbacks = new Set();
    const explicitConversionTarget = entry.boundary === HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION;
    try {
      const argObjects = this.readObjectArgv(argvPtr, argc);
      if (argObjects.length !== entry.args.length) {
        throw new Error(`Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argObjects.length}`);
      }
      entry.args.forEach((arg, index) => {
        const callbacksBeforeArgument = new Set(this.runtime.liveCallbacks);
        try {
          const value = explicitConversionTarget
            ? this.runtime.liftExplicitConversionObjectValue(arg.type, argObjects[index], `${entry.target} argument ${arg.name}`)
            : this.runtime.liftHostResourceObjectValue(arg.type, argObjects[index], `${entry.target} argument ${arg.name}`);
          args.push(value);
        } finally {
          captureCallbacksCreatedSince(this.runtime.liveCallbacks, callbacksBeforeArgument, liftedCallbacks);
        }
      });
      const value = binding(...args);
      if (isPromiseLike(value)) {
        throw new Error(`Vir host import ${entry.target} returned a Promise; host imports must be synchronous`);
      }
      return explicitConversionTarget
        ? this.runtime.makeExplicitConversionObjectValue(entry.result, value, `${entry.target} result`)
        : this.runtime.makeHostResourceObjectValue(entry.result, value, `${entry.target} result`);
    } catch (error) {
      throwWithCleanup(
        error,
        () => releaseCallbacks(liftedCallbacks),
        `Vir host import ${entry.target} failed during callback cleanup`,
      );
    }
  }

  callObjectHandle(entry, argvPtr, argc) {
    const argObjects = this.readObjectArgv(argvPtr, argc);
    if (argObjects.length !== entry.args.length) {
      throw new Error(`Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argObjects.length}`);
    }
    if (entry.target === "js.leanRef" && entry.args.length === 1 &&
        isLeanObjectDescriptor(entry.args[0]?.type) && isGenericJsResourceDescriptor(entry.result)) {
      const resource = this.runtime.makeLeanObjectHandleResource(argObjects[0], `${entry.target} argument ${entry.args[0].name}`);
      const cell = this.runtime.leanObjectHandleCell(resource, `${entry.target} result`);
      cell.onRelease = () => {
        this.leanObjectHandleCells.delete(cell);
      };
      this.leanObjectHandleCells.add(cell);
      return this.runtime.makeHostResourceObjectValue(entry.result, resource, `${entry.target} result`);
    }
    if (entry.target === "js.leanRef.value" && entry.args.length === 1 &&
        isGenericJsResourceDescriptor(entry.args[0]?.type) && isLeanObjectDescriptor(entry.result)) {
      const resource = this.runtime.liftHostResourceObjectValue(
        entry.args[0].type,
        argObjects[0],
        `${entry.target} argument ${entry.args[0].name}`,
      );
      return this.runtime.retainLeanObjectHandleValue(resource, `${entry.target} argument ${entry.args[0].name}`);
    }
    if (entry.target === "js.leanRef.release" && entry.args.length === 1 &&
        isGenericJsResourceDescriptor(entry.args[0]?.type) && isUnitDescriptor(entry.result)) {
      const resource = this.runtime.liftHostResourceObjectValue(
        entry.args[0].type,
        argObjects[0],
        `${entry.target} argument ${entry.args[0].name}`,
      );
      const cell = this.runtime.leanObjectHandleCell(resource, `${entry.target} argument ${entry.args[0].name}`);
      this.runtime.releaseLeanObjectHandleCell(cell);
      return this.runtime.makeHostResourceObjectValue(entry.result, undefined, `${entry.target} result`);
    }
    throw new Error(`Vir host import ${entry.target} has unsupported objectHandle signature`);
  }

  readObjectArgv(argvPtr, argc) {
    if (argvPtr === 0 && argc !== 0) {
      throw new Error("Vir host import object argv pointer is null");
    }
    const view = new DataView(this.exports.memory.buffer, argvPtr, argc * 4);
    return Array.from({ length: argc }, (_value, index) => view.getUint32(index * 4, true));
  }

  dispose({ disposeBindings = true } = {}) {
    if (this.disposed) return false;
    this.disposed = true;
    const errors = [];
    this.clearCallError();
    collectCleanupError(errors, () => this.clearResourceRoots());

    const userRelease = collectCleanupError(errors, () => this.releaseHostBindings?.() ?? true);
    if (disposeBindings && userRelease.ok && userRelease.value) {
      collectCleanupError(errors, () => disposeHostBindings(this.userBindings));
    }
    const defaultRelease = collectCleanupError(errors, () => this.releaseDefaultHostBindings?.() ?? true);
    if (disposeBindings && defaultRelease.ok && defaultRelease.value) {
      collectCleanupError(errors, () => disposeHostBindings(this.defaultBindings));
    }

    collectCleanupError(errors, () => this.releaseLeanObjectHandleCells());
    this.runtime = null;
    this.exports = null;
    throwCollectedErrors(errors, "Vir host state disposal failed");
    return true;
  }

  releaseLeanObjectHandleCells() {
    const errors = [];
    for (const cell of Array.from(this.leanObjectHandleCells)) {
      collectCleanupError(errors, () => this.runtime.releaseLeanObjectHandleCell(cell));
    }
    this.leanObjectHandleCells.clear();
    throwCollectedErrors(errors, "Lean object handle release failed");
  }
}

function isLeanObjectDescriptor(type) {
  return type?.interfaceTag === INTERFACE_TAG.LEAN_OBJECT && type?.kind === "leanObject";
}

function isUnitDescriptor(type) {
  return type?.interfaceTag === INTERFACE_TAG.UNIT;
}

function isGenericJsResourceDescriptor(type) {
  return type?.interfaceTag === INTERFACE_TAG.RESOURCE && type?.kind === "resource" && type?.name === "Lean.Vir.Js";
}

function disposeHostBindings(bindings) {
  if (bindings === null || bindings === undefined) return;
  const disposer = bindings[VIR_HOST_DISPOSE] ?? bindings.dispose;
  if (typeof disposer === "function") {
    disposer.call(bindings);
  }
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
  const resolver = bindings[VIR_HOST_RESOLVE_BINDING];
  if (typeof resolver === "function") {
    return resolver.call(bindings, target);
  }
  return undefined;
}

function isPromiseLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}

function captureCallbacksCreatedSince(liveCallbacks, callbacksBeforeArgument, liftedCallbacks) {
  for (const callback of liveCallbacks) {
    if (!callbacksBeforeArgument.has(callback)) {
      liftedCallbacks.add(callback);
    }
  }
}
