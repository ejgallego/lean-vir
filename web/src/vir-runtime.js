/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { validateInterfaceManifest } from "./runtime/interface-manifest.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";
import {
  asBytes,
} from "./runtime/vir-codec.js";
import {
  decodeCallResult,
  decodeHostCallRequest,
  encodeCallPayload,
  encodeClosureCallPayload,
  encodeHostCallResult,
} from "./runtime/vir-value-codec.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");

export {
  roundTripInterfaceTypeDescriptor,
  sameInterfaceWireType,
} from "./runtime/vir-codec.js";

export async function fetchBytes(path, init = { cache: "no-store" }) {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function createVirImports(module, overrides = {}, hostState = null) {
  const imports = {};

  for (const spec of WebAssembly.Module.imports(module)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
          throw new Error(`WASI proc_exit(${args[0]})`);
        }
        if (spec.module === "env" && spec.name === "vir_js_call") {
          throw new Error("Vir JavaScript host import called without an attached host state");
        }
        return 0;
      };
    }
  }

  for (const [moduleName, moduleImports] of Object.entries(overrides)) {
    imports[moduleName] = {
      ...(imports[moduleName] ?? {}),
      ...moduleImports,
    };
  }

  if (hostState !== null) {
    imports.env ??= {};
    imports.env.vir_js_call = (slot, requestPtr, requestLen) =>
      hostState.call(slot, requestPtr, requestLen);
    imports.env.vir_js_call_result_size = () => hostState.resultSize();
  }

  return imports;
}

export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}

export async function createVirRuntime(options = {}) {
  const { irPackageBytes, irPackageUrl, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({ irPackageBytes, irPackageUrl });
}

export class VirRuntimeFactory {
  constructor({
    wasmBytes = null,
    wasmModule = null,
    wasmUrl = null,
    fetchBytes: loadBytes = fetchBytes,
    imports = null,
    hostBindings = null,
    defaultHostBindings = null,
  } = {}) {
    this.wasmBytes = wasmBytes;
    this.wasmModule = wasmModule;
    this.wasmUrl = wasmUrl;
    this.fetchBytes = loadBytes;
    this.imports = imports;
    this.hostBindings = hostBindings;
    this.defaultHostBindings = defaultHostBindings;
  }

  async module() {
    if (this.wasmModule !== null) {
      return this.wasmModule;
    }
    if (this.wasmBytes === null) {
      if (this.wasmUrl === null) {
        throw new Error("wasmUrl, wasmBytes, or wasmModule is required");
      }
      this.wasmBytes = await this.fetchBytes(this.wasmUrl);
    }
    this.wasmModule = new WebAssembly.Module(asBytes(this.wasmBytes, "wasmBytes"));
    return this.wasmModule;
  }

  async instantiate() {
    const module = await this.module();
    const defaultHostBindings =
      typeof this.defaultHostBindings === "function"
        ? this.defaultHostBindings()
        : (this.defaultHostBindings ?? createBrowserHostBindings());
    const hostState = new VirHostState({
      hostBindings: this.hostBindings,
      defaultHostBindings,
    });
    const imports =
      typeof this.imports === "function"
        ? this.imports(module, hostState)
        : createVirImports(module, this.imports ?? {}, hostState);
    const instance = await WebAssembly.instantiate(module, imports);
    hostState.attach(instance.exports);
    instance.exports.__wasm_call_ctors?.();
    const runtime = new VirRuntime(instance.exports, { module, hostState });
    return runtime;
  }

  async createRuntime({ irPackageBytes = null, irPackageUrl = null } = {}) {
    const runtime = await this.instantiate();
    if (irPackageBytes !== null || irPackageUrl !== null) {
      const bytes = irPackageBytes ?? (await this.fetchBytes(irPackageUrl));
      await runtime.loadIrPackageBytes(bytes);
    }
    return runtime;
  }
}

class VirHostState {
  constructor({ hostBindings = null, defaultHostBindings = createBrowserHostBindings() } = {}) {
    this.exports = null;
    this.manifest = null;
    this.hostImports = [];
    this.userBindings = hostBindings;
    this.lastResultSize = 0;
    this.defaultBindings = defaultHostBindings;
    this.runtime = null;
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

  resultSize() {
    return this.lastResultSize;
  }

  call(slot, requestPtr, requestLen) {
    if (this.exports === null) {
      throw new Error("Vir host import called before WASM exports were attached");
    }
    const entry = this.hostImports[slot] ?? null;
    if (entry === null) {
      throw new Error(`Vir host import slot ${slot} is not registered`);
    }
    const binding = lookupHostBinding(entry.target, this.userBindings, this.defaultBindings);
    if (typeof binding !== "function") {
      throw new Error(`Vir host import binding not found: ${entry.target}`);
    }

    const request = this.readWasmBytes(requestPtr, requestLen);
    const { args, resultType } = decodeHostCallRequest(request, entry, this.runtime?.codecOptions ?? {});
    const value = binding(...args);
    if (isPromiseLike(value)) {
      throw new Error(`Vir host import ${entry.target} returned a Promise; v1 host imports must be synchronous`);
    }
    const result = encodeHostCallResult(resultType, value, entry);
    const ptr = this.exports.vir_alloc_bytes(result.byteLength);
    new Uint8Array(this.exports.memory.buffer, ptr, result.byteLength).set(result);
    this.lastResultSize = result.byteLength;
    return ptr;
  }

  readWasmBytes(ptr, len) {
    if (ptr === 0 && len !== 0) {
      throw new Error("Vir host import request pointer is null");
    }
    return new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
  }

  dispose() {
    disposeHostBindings(this.userBindings);
    disposeHostBindings(this.defaultBindings);
  }
}

export class VirRuntime {
  constructor(exports, { module = null, packageInfo = null, hostState = null } = {}) {
    this.exports = exports;
    this.module = module;
    this.hostState = hostState;
    this.packageInfo = packageInfo;
    this.interfaceManifest = null;
    this.packageMetadata = null;
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
    this.codecOptions = valueCodecOptions(this);
    this.disposed = false;
    this.liveCallbacks = new Set();
    this.hostState?.attachRuntime(this);

    if (!this.exports.memory) {
      throw new Error("WASM memory export is missing");
    }
    if (typeof this.exports.vir_package_interface_manifest_size === "function" &&
        this.exports.vir_package_interface_manifest_size() !== 0) {
      this.interfaceManifest = this.readPackageManifest();
      this.hostState?.setManifest(this.interfaceManifest);
      this.packageMetadata = this.interfaceManifest.metadata;
      this.rebuildManifestExports();
    }
  }

  targetPointerBytes() {
    return this.exports.vir_upstream_target_pointer_bytes?.() ?? null;
  }

  packageDeclCount() {
    return this.exports.vir_package_decl_count?.() ?? null;
  }

  lastPackageError() {
    const len = this.exports.vir_last_package_error_size?.() ?? 0;
    return len === 0 ? "" : this.readWasmString(this.exports.vir_last_package_error(), len);
  }

  loadIrPackageBytes(bytes) {
    this.requireLiveRuntime();
    this.requireFunction("vir_alloc_bytes");
    this.requireFunction("vir_load_ir_package");

    const packageBytes = asBytes(bytes, "IR package bytes");
    if (this.hasPackageState() || this.liveCallbacks.size !== 0) {
      this.teardownPackageResources();
    }
    this.clearPackageMetadata();
    const ptr = this.allocBytes(packageBytes);
    try {
      const count = this.exports.vir_load_ir_package(ptr, packageBytes.byteLength);
      if (count === 0) {
        const detail = this.lastPackageError();
        throw new Error(`IR package load failed${detail ? `: ${detail}` : ""}`);
      }
      const providerCount = this.packageDeclCount();
      if (providerCount !== null && providerCount !== count) {
        throw new Error(`IR package declaration count mismatch: load returned ${count}, provider has ${providerCount}`);
      }
      this.interfaceManifest = this.readPackageManifest();
      this.hostState?.setManifest(this.interfaceManifest);
      this.packageMetadata = this.interfaceManifest.metadata;
      this.rebuildManifestExports();
      this.packageInfo = {
        count: providerCount ?? count,
        byteLength: packageBytes.byteLength,
        interfaceExports: this.interfaceManifest.exports.length,
        hostImports: this.interfaceManifest.hostImports?.length ?? 0,
        metadata: this.packageMetadata,
      };
      return this.packageInfo;
    } finally {
      this.freeBytes(ptr);
    }
  }

  clearPackageMetadata() {
    this.packageInfo = null;
    this.interfaceManifest = null;
    this.hostState?.setManifest(null);
    this.packageMetadata = null;
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
  }

  hasPackageState() {
    return this.packageInfo !== null || this.interfaceManifest !== null || this.packageMetadata !== null;
  }

  readPackageManifest() {
    this.requireFunction("vir_package_interface_manifest");
    this.requireFunction("vir_package_interface_manifest_size");

    const len = this.exports.vir_package_interface_manifest_size();
    if (len === 0) {
      throw new Error("IR package does not contain an embedded interface manifest");
    }
    const text = this.readWasmString(this.exports.vir_package_interface_manifest(), len);
    const manifest = JSON.parse(text);
    return validateInterfaceManifest(manifest);
  }

  rebuildManifestExports() {
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
    for (const entry of this.interfaceManifest?.exports ?? []) {
      registerManifestEntryKey(this.entriesByName, entry.entry, entry);
      registerManifestEntryKey(this.entriesByName, entry.id, entry);
      registerManifestEntryKey(this.entriesByName, entry.jsName, entry);
      this.entryCallCache.set(entry, {
        nameBytes: textEncoder.encode(entry.entry),
      });
      if (entry.jsName && isIdentifier(entry.jsName)) {
        this.exportsByName[entry.jsName] = (...args) => this.callEntry(entry, args);
      }
    }
  }

  findManifestEntry(name) {
    return typeof name === "string" ? (this.entriesByName[name] ?? null) : null;
  }

  call(name, ...args) {
    const entry = this.findManifestEntry(name);
    if (entry === null) {
      throw new Error(`interface entry not found: ${name}`);
    }
    return this.callEntry(entry, args);
  }

  callEntry(entry, args) {
    this.requireLiveRuntime();
    this.requireFunction("vir_call");
    this.requireFunction("vir_call_result_size");
    if (args.length !== entry.args.length) {
      throw new Error(`${entry.entry} expects ${entry.args.length} arguments, got ${args.length}`);
    }

    const { nameBytes } = this.callCacheFor(entry);
    const payload = encodeCallPayload(entry, args);
    const namePtr = this.allocBytes(nameBytes);
    const payloadPtr = this.allocBytes(payload);
    try {
      const resultPtr = this.exports.vir_call(
        namePtr,
        nameBytes.byteLength,
        payloadPtr,
        payload.byteLength,
        entry.result.wireTag,
      );
      if (resultPtr === 0) {
        throw new Error(this.lastCallError() || `call failed: ${entry.entry}`);
      }
      const resultLen = this.exports.vir_call_result_size();
      return decodeCallResult(entry.result, this.readWasmBytes(resultPtr, resultLen), this.codecOptions);
    } finally {
      this.freeBytes(payloadPtr);
      this.freeBytes(namePtr);
    }
  }

  callCacheFor(entry) {
    let cache = this.entryCallCache.get(entry);
    if (cache === undefined) {
      cache = { nameBytes: textEncoder.encode(entry.entry) };
      this.entryCallCache.set(entry, cache);
    }
    return cache;
  }

  lastCallError() {
    const len = this.exports.vir_call_error_size?.() ?? 0;
    return len === 0 ? "" : this.readWasmString(this.exports.vir_call_error(), len);
  }

  allocBytes(bytes) {
    this.requireFunction("vir_alloc_bytes");

    const view = asBytes(bytes, "bytes");
    const ptr = this.exports.vir_alloc_bytes(view.byteLength);
    new Uint8Array(this.exports.memory.buffer, ptr, view.byteLength).set(view);
    return ptr;
  }

  freeBytes(ptr) {
    this.exports.vir_free_bytes?.(ptr);
  }

  readWasmString(ptr, len) {
    return textDecoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, len));
  }

  readWasmBytes(ptr, len) {
    return new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
  }

  requireFunction(name) {
    if (typeof this.exports[name] !== "function") {
      throw new Error(`${name} export is missing`);
    }
  }

  requireLiveRuntime() {
    if (this.disposed) {
      throw new Error("VirRuntime has been disposed");
    }
  }

  trackCallback(callback) {
    this.liveCallbacks.add(callback);
  }

  untrackCallback(callback) {
    this.liveCallbacks.delete(callback);
  }

  callClosure(handle, type, args) {
    this.requireLiveRuntime();
    this.requireFunction("vir_closure_call");
    this.requireFunction("vir_closure_call_result_size");
    const payload = encodeClosureCallPayload(type, args);
    const payloadPtr = this.allocBytes(payload);
    try {
      const resultPtr = this.exports.vir_closure_call(handle, payloadPtr, payload.byteLength);
      if (resultPtr === 0) {
        throw new Error(this.lastClosureCallError() || `closure call failed: ${handle}`);
      }
      const resultLen = this.exports.vir_closure_call_result_size();
      return decodeCallResult(type.result, this.readWasmBytes(resultPtr, resultLen), this.codecOptions);
    } finally {
      this.freeBytes(payloadPtr);
    }
  }

  releaseClosure(handle) {
    this.exports.vir_closure_release?.(handle);
  }

  lastClosureCallError() {
    const len = this.exports.vir_closure_call_error_size?.() ?? 0;
    return len === 0 ? "" : this.readWasmString(this.exports.vir_closure_call_error(), len);
  }

  dispose() {
    if (this.disposed) return;
    this.teardownPackageResources();
    this.disposed = true;
    this.hostState = null;
    this.exportsByName = Object.create(null);
  }

  teardownPackageResources() {
    this.hostState?.dispose();
    this.releaseLiveCallbacks();
  }

  releaseLiveCallbacks() {
    for (const callback of Array.from(this.liveCallbacks)) {
      callback.release();
    }
  }
}

export class VirCallback {
  call(...args) {
    if (this._released) {
      throw new Error(`Vir callback ${this.handle} has been released`);
    }
    return this._runtime.callClosure(this.handle, this.type, args);
  }

  release() {
    if (this._released) return false;
    this._released = true;
    this._runtime.releaseClosure(this.handle);
    this._runtime.untrackCallback(this);
    return true;
  }

  dispose() {
    return this.release();
  }

  get released() {
    return this._released;
  }
}

Object.setPrototypeOf(VirCallback.prototype, Function.prototype);

function createVirCallback(runtime, handle, type) {
  if (!Number.isInteger(handle) || handle <= 0 || handle > 0xffffffff) {
    throw new Error("callback handle must be a positive 32-bit integer");
  }
  const callback = function virCallback(...args) {
    return callback.call(...args);
  };
  Object.setPrototypeOf(callback, VirCallback.prototype);
  Object.defineProperties(callback, {
    _runtime: { value: runtime },
    _released: { value: false, writable: true },
    handle: { value: handle, enumerable: true },
    type: { value: type, enumerable: true },
  });
  runtime.trackCallback(callback);
  return callback;
}

function valueCodecOptions(runtime) {
  return runtime === null ? {} : {
    createCallback: (handle, type) => createVirCallback(runtime, handle, type),
  };
}

function registerManifestEntryKey(map, key, entry) {
  if (typeof key === "string" && key !== "" && map[key] === undefined) {
    map[key] = entry;
  }
}

function disposeHostBindings(bindings) {
  if (bindings === null || bindings === undefined) return;
  const disposer = bindings[VIR_HOST_DISPOSE] ?? bindings.dispose;
  if (typeof disposer === "function") {
    disposer.call(bindings);
  }
}

function isIdentifier(text) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
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
