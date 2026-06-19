/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { validateInterfaceManifest } from "./runtime/interface-manifest.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";
import {
  asBytes,
  normalizeUint32,
} from "./runtime/vir-codec.js";
import { WIRE } from "./runtime/wire-tags.js";
import {
  PRIMITIVE_LANE,
  primitiveLaneForTag,
  readPrimitiveResult,
} from "./runtime/primitive-lanes.js";
import {
  ExternrefResourceRoots,
  isHostResource,
} from "./host-resource.js";
import {
  decodeResolvedCallResult,
  decodeHostCallRequest,
  encodeClosureCallPayload,
  encodeHostCallResult,
  encodeResolvedCallPayload,
} from "./runtime/vir-value-codec.js";
import {
  asByteArrayBytes,
  normalizeFloat,
} from "./runtime/vir-value-normalizers.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");
const virCallbackStates = new WeakMap();
const FAST_CALL_UNAVAILABLE = Symbol("fast-call-unavailable");

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
    imports.env.vir_resource_take = () => hostState.takeIncomingResource();
    imports.env.vir_resource_push = (value) => hostState.pushOutgoingResource(value);
    imports.env.vir_resource_root = (value) => hostState.rootResource(value);
    imports.env.vir_resource_get = (rootId) => hostState.getRootedResource(rootId);
    imports.env.vir_resource_release = (rootId) => hostState.releaseRootedResource(rootId);
    imports.env.vir_closure_push = (rootId) => hostState.pushOutgoingClosureRootId(rootId);
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
    this.incomingResources = [];
    this.outgoingResources = [];
    this.outgoingClosureRootIds = [];
    this.resourceRoots = new ExternrefResourceRoots();
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

  pushIncomingResource(value) {
    this.incomingResources.push(value);
  }

  takeIncomingResource() {
    return this.incomingResources.shift() ?? null;
  }

  clearIncomingResources() {
    this.incomingResources.length = 0;
  }

  pushOutgoingResource(value) {
    this.outgoingResources.push(value);
  }

  takeOutgoingResource(label) {
    const value = this.outgoingResources.shift() ?? null;
    if (!isHostResource(value)) {
      throw new Error(`${label} did not receive an externref resource`);
    }
    return value;
  }

  clearOutgoingResources() {
    this.outgoingResources.length = 0;
  }

  pushOutgoingClosureRootId(rootId) {
    if (!Number.isInteger(rootId) || rootId <= 0 || rootId > 0xffffffff) {
      throw new Error("Lean VIR closure root id must be a positive 32-bit integer");
    }
    this.outgoingClosureRootIds.push(rootId);
    return undefined;
  }

  takeOutgoingClosureRootId(label) {
    const rootId = this.outgoingClosureRootIds.shift() ?? 0;
    if (!Number.isInteger(rootId) || rootId <= 0 || rootId > 0xffffffff) {
      throw new Error(`${label} did not receive a live closure root id`);
    }
    return rootId;
  }

  clearOutgoingClosureRootIds() {
    const rootIds = this.outgoingClosureRootIds.splice(0);
    for (const rootId of rootIds) {
      this.exports?.vir_closure_release?.(rootId);
    }
  }

  clearTransientQueues() {
    this.clearIncomingResources();
    this.clearOutgoingResources();
    this.clearOutgoingClosureRootIds();
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
    const codecOptions = this.runtime?.codecOptions ?? {};
    let args;
    let resultType;
    try {
      ({ args, resultType } = decodeHostCallRequest(request, entry, codecOptions, { compactPayload: true }));
      this.clearOutgoingClosureRootIds();
    } catch (error) {
      this.clearOutgoingClosureRootIds();
      throw error;
    }
    const value = binding(...args);
    if (isPromiseLike(value)) {
      throw new Error(`Vir host import ${entry.target} returned a Promise; v1 host imports must be synchronous`);
    }
    const result = encodeHostCallResult(resultType, value, entry, codecOptions, { compactPayload: true });
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
    this.clearTransientQueues();
    this.clearResourceRoots();
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
    this.requireFunction("vir_resolve_call");
    this.requireFunction("vir_call_resolved");
    this.requireFunction("vir_call_result_size");
    if (args.length !== entry.args.length) {
      throw new Error(`${entry.entry} expects ${entry.args.length} arguments, got ${args.length}`);
    }

    const cache = this.callCacheFor(entry);
    this.hostState?.clearTransientQueues();
    const primitiveResult = this.tryPrimitiveResolvedCall(entry, args, cache);
    if (primitiveResult !== FAST_CALL_UNAVAILABLE) {
      return primitiveResult;
    }
    const objectResult = this.tryObjectResolvedCall(entry, args, cache);
    if (objectResult !== FAST_CALL_UNAVAILABLE) {
      return objectResult;
    }
    let payload;
    try {
      payload = encodeResolvedCallPayload(entry, args, this.codecOptions);
    } catch (error) {
      this.hostState?.clearTransientQueues();
      throw error;
    }
    const payloadPtr = this.allocBytes(payload);
    try {
      const callSlot = this.resolveCallSlot(entry, cache);
      const resultPtr = this.exports.vir_call_resolved(
        callSlot,
        payloadPtr,
        payload.byteLength,
        entry.result.wireTag,
      );
      if (resultPtr === 0) {
        throw new Error(this.lastCallError() || `call failed: ${entry.entry}`);
      }
      const resultLen = this.exports.vir_call_result_size();
      const resultBytes = this.readWasmBytes(resultPtr, resultLen);
      return decodeResolvedCallResult(entry.result, resultBytes, this.codecOptions);
    } finally {
      this.freeBytes(payloadPtr);
      this.hostState?.clearTransientQueues();
    }
  }

  tryPrimitiveResolvedCall(entry, args, cache) {
    if (entry.effect !== "pure" || entry.args.length !== 1) {
      return FAST_CALL_UNAVAILABLE;
    }
    const argType = entry.args[0].type;
    const resultType = entry.result;
    const argTag = argType?.wireTag;
    const resultTag = resultType?.wireTag;
    const argLane = primitiveLaneForTag(argTag);
    const resultLane = primitiveLaneForTag(resultTag);
    if (argLane === null || resultLane === null || resultTag !== argTag) {
      return FAST_CALL_UNAVAILABLE;
    }
    if (typeof this.exports.vir_call_resolved_primitive !== "function") {
      return FAST_CALL_UNAVAILABLE;
    }
    const callSlot = this.resolveCallSlot(entry, cache);
    const label = `${entry.entry} argument ${entry.args[0].name}`;
    const finish = () => {
      if (this.exports.vir_call_resolved_primitive(callSlot, argLane, resultLane) === 0) {
        throw new Error(this.lastCallError() || `primitive call failed: ${entry.entry}`);
      }
      return this.readPrimitiveResult(resultLane, resultTag);
    };

    if (argLane === PRIMITIVE_LANE.UNIT) {
      if (args[0] !== undefined && args[0] !== null) {
        throw new Error(`${label} must be undefined or null`);
      }
      return finish();
    }

    if (argLane === PRIMITIVE_LANE.U32) {
      if (typeof this.exports.vir_call_primitive_set_u32 !== "function") {
        return FAST_CALL_UNAVAILABLE;
      }
      this.exports.vir_call_primitive_set_u32(normalizeDirectU32(args[0], argTag, label));
      return finish();
    }

    if (argLane === PRIMITIVE_LANE.F64) {
      if (typeof this.exports.vir_call_primitive_set_f64 !== "function") {
        return FAST_CALL_UNAVAILABLE;
      }
      this.exports.vir_call_primitive_set_f64(normalizeFloat(args[0], label));
      return finish();
    }

    if (argLane === PRIMITIVE_LANE.STRING) {
      if (
        typeof this.exports.vir_call_primitive_set_string !== "function" ||
        typeof this.exports.vir_call_primitive_string_result !== "function") {
        return FAST_CALL_UNAVAILABLE;
      }
      if (typeof args[0] !== "string") {
        throw new Error(`${label} must be a string`);
      }
      const bytes = textEncoder.encode(args[0]);
      const ptr = this.allocBytes(bytes);
      try {
        if (this.exports.vir_call_primitive_set_string(ptr, bytes.byteLength) === 0) {
          throw new Error(this.lastCallError() || `primitive string argument failed: ${entry.entry}`);
        }
        return finish();
      } finally {
        this.freeBytes(ptr);
      }
    }

    return FAST_CALL_UNAVAILABLE;
  }

  tryObjectResolvedCall(entry, args, cache) {
    if (entry.effect !== "pure" || entry.args.length !== 1) {
      return FAST_CALL_UNAVAILABLE;
    }
    const argTag = entry.args[0].type?.wireTag;
    const resultTag = entry.result?.wireTag;
    if (argTag !== WIRE.BYTE_ARRAY || resultTag !== WIRE.BYTE_ARRAY) {
      return FAST_CALL_UNAVAILABLE;
    }
    if (
      typeof this.exports.vir_call_resolved_objects !== "function" ||
      typeof this.exports.vir_obj_byte_array !== "function" ||
      typeof this.exports.vir_obj_byte_array_data !== "function" ||
      typeof this.exports.vir_obj_byte_array_size !== "function" ||
      typeof this.exports.vir_obj_dec !== "function") {
      return FAST_CALL_UNAVAILABLE;
    }

    const bytes = asByteArrayBytes(args[0]);
    const callSlot = this.resolveCallSlot(entry, cache);
    const inputPtr = this.allocBytes(bytes);
    let argObj = 0;
    let argvPtr = 0;
    let resultObj = 0;
    let callStarted = false;
    try {
      argObj = this.exports.vir_obj_byte_array(inputPtr, bytes.byteLength);
      argvPtr = this.allocBytes(new Uint8Array(4));
      new DataView(this.exports.memory.buffer, argvPtr, 4).setUint32(0, argObj, true);
      resultObj = this.exports.vir_call_resolved_objects(callSlot, argvPtr, 1);
      callStarted = true;
      argObj = 0;
      const error = this.lastCallError();
      if (error !== "") {
        throw new Error(error);
      }
      if (resultObj === 0) {
        throw new Error(`object call failed: ${entry.entry}`);
      }
      return this.readObjectByteArray(resultObj);
    } finally {
      this.freeBytes(inputPtr);
      if (argvPtr !== 0) {
        this.freeBytes(argvPtr);
      }
      if (!callStarted && argObj !== 0) {
        this.exports.vir_obj_dec(argObj);
      }
      if (resultObj !== 0) {
        this.exports.vir_obj_dec(resultObj);
      }
    }
  }

  readPrimitiveResult(lane, tag) {
    return readPrimitiveResult(this, lane, tag);
  }

  readObjectByteArray(obj) {
    return this.readWasmBytes(
      this.exports.vir_obj_byte_array_data(obj),
      this.exports.vir_obj_byte_array_size(obj),
    );
  }

  callCacheFor(entry) {
    let cache = this.entryCallCache.get(entry);
    if (cache === undefined) {
      cache = { nameBytes: textEncoder.encode(entry.entry) };
      this.entryCallCache.set(entry, cache);
    }
    return cache;
  }

  resolveCallSlot(entry, cache) {
    if (cache.callSlot !== undefined) {
      return cache.callSlot;
    }
    const namePtr = this.allocBytes(cache.nameBytes);
    try {
      const callSlot = this.exports.vir_resolve_call(namePtr, cache.nameBytes.byteLength) >>> 0;
      if (callSlot === 0) {
        throw new Error(this.lastCallError() || `call entry not found: ${entry.entry}`);
      }
      cache.callSlot = callSlot;
      return callSlot;
    } finally {
      this.freeBytes(namePtr);
    }
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

  callClosure(rootId, type, args) {
    this.requireLiveRuntime();
    this.requireFunction("vir_closure_call");
    this.requireFunction("vir_closure_call_result_size");
    this.hostState?.clearTransientQueues();
    let payload;
    try {
      payload = encodeClosureCallPayload(type, args, this.codecOptions);
    } catch (error) {
      this.hostState?.clearTransientQueues();
      throw error;
    }
    const payloadPtr = this.allocBytes(payload);
    try {
      const resultPtr = this.exports.vir_closure_call(rootId, payloadPtr, payload.byteLength);
      if (resultPtr === 0) {
        throw new Error(this.lastClosureCallError() || "closure call failed");
      }
      const resultLen = this.exports.vir_closure_call_result_size();
      return decodeResolvedCallResult(type.result, this.readWasmBytes(resultPtr, resultLen), this.codecOptions);
    } finally {
      this.freeBytes(payloadPtr);
      this.hostState?.clearTransientQueues();
    }
  }

  releaseClosure(rootId) {
    this.exports.vir_closure_release?.(rootId);
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

function createVirCallback(runtime, rootId, type) {
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

function requireVirCallbackState(callback) {
  const state = virCallbackStates.get(callback);
  if (state === undefined) {
    throw new Error("Vir callback state is missing");
  }
  return state;
}

function valueCodecOptions(runtime) {
  return runtime === null ? {} : {
    createCallback: (rootId, type) => createVirCallback(runtime, rootId, type),
    pushIncomingResource: (value) => requireVirHostState(runtime).pushIncomingResource(value),
    takeOutgoingResource: (label) => requireVirHostState(runtime).takeOutgoingResource(label),
    takeOutgoingClosureRootId: (label) => requireVirHostState(runtime).takeOutgoingClosureRootId(label),
  };
}

function requireVirHostState(runtime) {
  if (runtime.hostState === null) {
    throw new Error("VirRuntime is missing an attached host state");
  }
  return runtime.hostState;
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

function normalizeDirectU32(value, tag, label) {
  if (tag === WIRE.BOOL) {
    if (typeof value !== "boolean") {
      throw new Error(`${label} must be a boolean`);
    }
    return value ? 1 : 0;
  }
  if (tag === WIRE.UINT8) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new Error(`${label} must be an integer in 0..255`);
    }
    return value;
  }
  if (tag === WIRE.UINT16) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`${label} must be an integer in 0..65535`);
    }
    return value;
  }
  return normalizeUint32(value, label);
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
