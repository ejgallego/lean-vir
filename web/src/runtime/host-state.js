/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  abandonHostResource,
  commitHostResource,
  ExternrefResourceRoots,
  isHostResource,
  releaseHostResource,
  retainHostResource,
  VIR_HOST_DISPOSE,
  VIR_HOST_RESOLVE_BINDING,
} from "../host-resource.js";
import { createBrowserHostBindings } from "../vir-host-bindings.js";
import { releaseCallbackRoots } from "./callbacks.js";
import { collectCleanupError, throwCollectedErrors, throwWithCleanup } from "./cleanup.js";
import { HOST_IMPORT_BOUNDARY } from "./interface-manifest.js";
import { INTERFACE_TAG } from "./interface-tags.js";

const MAX_FINALIZER_ERRORS = 16;
const MAX_FINALIZER_ERROR_MESSAGE_LENGTH = 2048;

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
      this.callError = error instanceof Error ? error : new Error(String(error));
    }
  }

  takeCallError() {
    const error = this.callError;
    this.callError = null;
    return error;
  }

  rootResource(value, owned = 0) {
    return this.resourceRoots.root(value, { owned: owned !== 0 });
  }

  getRootedResource(rootId, take = 0) {
    return this.resourceRoots.get(rootId, { take: take !== 0 });
  }

  rootedResourceIsOwned(rootId) {
    return this.resourceRoots.isOwned(rootId) ? 1 : 0;
  }

  releaseRootedResource(rootId) {
    return this.resourceRoots.release(rootId);
  }

  releaseRootedResourceFromFinalizer(rootId) {
    try {
      return this.releaseRootedResource(rootId);
    } catch (error) {
      this.recordFinalizerError(error);
      return undefined;
    }
  }

  recordFinalizerError(error) {
    if (this.finalizerErrorMessages.length >= MAX_FINALIZER_ERRORS) {
      this.droppedFinalizerErrors++;
      return;
    }
    const name = error instanceof Error && error.name ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    this.finalizerErrorMessages.push(`${name}: ${message}`.slice(0, MAX_FINALIZER_ERROR_MESSAGE_LENGTH));
  }

  takeFinalizerErrors() {
    const messages = this.finalizerErrorMessages.splice(0);
    const dropped = this.droppedFinalizerErrors;
    this.droppedFinalizerErrors = 0;
    if (dropped !== 0) {
      messages.push(`${dropped} additional finalizer error${dropped === 1 ? " was" : "s were"} discarded`);
    }
    return messages.map((message) => new Error(message));
  }

  clearResourceRoots() {
    this.resourceRoots.clear();
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
      const resultLabel = `${entry.target} result`;
      const retainedIdentityResult = isHostResource(value) && args.includes(value)
        ? retainHostResource(value, resultLabel)
        : null;
      const ownedResultResource = retainedIdentityResult ?? (isHostResource(value) ? value : null);
      try {
        const resultValue = retainedIdentityResult ?? value;
        const resultObject = explicitConversionTarget
          ? this.runtime.makeExplicitConversionObjectValue(entry.result, resultValue, resultLabel)
          : this.runtime.makeHostResourceObjectValue(entry.result, resultValue, resultLabel);
        if (ownedResultResource !== null) {
          commitHostResource(ownedResultResource);
        }
        return resultObject;
      } catch (error) {
        if (ownedResultResource === null) throw error;
        throwWithCleanup(
          error,
          () => abandonHostResource(ownedResultResource),
          `Vir host import ${entry.target} failed during result ownership cleanup`,
        );
      }
    } catch (error) {
      throwWithCleanup(
        error,
        () => releaseCallbackRoots(liftedCallbacks),
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
      try {
        return this.runtime.makeHostResourceObjectValue(entry.result, resource, `${entry.target} result`);
      } catch (error) {
        throwWithCleanup(
          error,
          () => releaseHostResource(resource),
          `${entry.target} failed during result cleanup`,
        );
      }
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
    if (entry.target === "js.leanRef.retain" && entry.args.length === 1 &&
        isGenericJsResourceDescriptor(entry.args[0]?.type) && isGenericJsResourceDescriptor(entry.result)) {
      const resource = this.runtime.liftHostResourceObjectValue(
        entry.args[0].type,
        argObjects[0],
        `${entry.target} argument ${entry.args[0].name}`,
      );
      const alias = this.runtime.retainLeanObjectHandleResource(
        resource,
        `${entry.target} argument ${entry.args[0].name}`,
      );
      try {
        return this.runtime.makeHostResourceObjectValue(entry.result, alias, `${entry.target} result`);
      } catch (error) {
        throwWithCleanup(
          error,
          () => releaseHostResource(alias),
          `${entry.target} failed during result cleanup`,
        );
      }
    }
    if (entry.target === "js.leanRef.release" && entry.args.length === 1 &&
        isGenericJsResourceDescriptor(entry.args[0]?.type) && isUnitDescriptor(entry.result)) {
      const resource = this.runtime.liftHostResourceObjectValue(
        entry.args[0].type,
        argObjects[0],
        `${entry.target} argument ${entry.args[0].name}`,
      );
      this.runtime.releaseLeanObjectHandleResource(resource, `${entry.target} argument ${entry.args[0].name}`);
      releaseHostResource(resource);
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
    if (this.disposed || this.disposing) return;
    this.disposing = true;
    const errors = [];
    try {
      this.clearCallError();

      const userRelease = collectCleanupError(errors, () => this.releaseHostBindings?.() ?? true);
      if (disposeBindings && userRelease.ok && userRelease.value) {
        collectCleanupError(errors, () => disposeHostBindings(this.userBindings));
      }
      const defaultRelease = collectCleanupError(errors, () => this.releaseDefaultHostBindings?.() ?? true);
      if (disposeBindings && defaultRelease.ok && defaultRelease.value) {
        collectCleanupError(errors, () => disposeHostBindings(this.defaultBindings));
      }

      collectCleanupError(errors, () => this.releaseLeanObjectHandleCells());
      collectCleanupError(errors, () => this.clearResourceRoots());
      errors.push(...this.takeFinalizerErrors());
    } finally {
      this.disposed = true;
      this.disposing = false;
      this.runtime = null;
      this.exports = null;
    }
    throwCollectedErrors(errors, "Vir host state disposal failed");
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
