/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { ExternrefResourceRoots, VIR_HOST_DISPOSE } from "../host-resource.js";
import { createBrowserHostBindings } from "../vir-host-bindings.js";
import { isVirCallback, releaseCallbacks } from "./callbacks.js";

export class VirHostState {
  constructor({
    hostBindings = null,
    defaultHostBindings = createBrowserHostBindings(),
  } = {}) {
    this.exports = null;
    this.manifest = null;
    this.hostImports = [];
    this.userBindings = hostBindings;
    this.defaultBindings = defaultHostBindings;
    this.runtime = null;
    this.resourceRoots = new ExternrefResourceRoots();
    this.callError = null;
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
    this.callError = error instanceof Error ? error : new Error(String(error));
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
    const binding = lookupHostBinding(entry.target, this.userBindings, this.defaultBindings);
    if (typeof binding !== "function") {
      throw new Error(`Vir host import binding not found: ${entry.target}`);
    }

    const args = [];
    const liftedCallbacks = [];
    try {
      const argObjects = this.readObjectArgv(argvPtr, argc);
      if (argObjects.length !== entry.args.length) {
        throw new Error(`Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argObjects.length}`);
      }
      entry.args.forEach((arg, index) => {
        const value = this.runtime.liftObjectValue(arg.type, argObjects[index], `${entry.target} argument ${arg.name}`);
        if (isVirCallback(value)) {
          liftedCallbacks.push(value);
        }
        args.push(value);
      });
    } catch (error) {
      releaseCallbacks(liftedCallbacks);
      throw error;
    }
    let value;
    try {
      value = binding(...args);
    } catch (error) {
      releaseCallbacks(liftedCallbacks);
      throw error;
    }
    if (isPromiseLike(value)) {
      releaseCallbacks(liftedCallbacks);
      throw new Error(`Vir host import ${entry.target} returned a Promise; v1 host imports must be synchronous`);
    }
    return this.runtime.makeObjectValue(entry.result, value, `${entry.target} result`);
  }

  readObjectArgv(argvPtr, argc) {
    if (argvPtr === 0 && argc !== 0) {
      throw new Error("Vir host import object argv pointer is null");
    }
    const view = new DataView(this.exports.memory.buffer, argvPtr, argc * 4);
    return Array.from({ length: argc }, (_value, index) => view.getUint32(index * 4, true));
  }

  dispose() {
    this.clearCallError();
    this.clearResourceRoots();
    disposeHostBindings(this.userBindings);
    disposeHostBindings(this.defaultBindings);
  }
}

function disposeHostBindings(bindings) {
  if (bindings === null || bindings === undefined) return;
  const disposer = bindings[VIR_HOST_DISPOSE] ?? bindings.dispose;
  if (typeof disposer === "function") {
    disposer.call(bindings);
  }
}

function lookupHostBinding(target, userBindings, defaultBindings) {
  if (userBindings instanceof Map && userBindings.has(target)) {
    return userBindings.get(target);
  }
  if (userBindings !== null && typeof userBindings === "object" && Object.hasOwn(userBindings, target)) {
    return userBindings[target];
  }
  return defaultBindings[target];
}

function isPromiseLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
