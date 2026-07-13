/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { validateInterfaceManifest } from "./interface-manifest.js";
import { ObjectValueRuntime } from "./object-values.js";
import {
  asBytes,
  requireFunctionArgs,
  requireFunctionResult,
} from "./vir-codec.js";
import {
  objectArgumentSupported,
  objectResultSupported,
  objectTypeNeedsBoxedBoundary,
} from "./object-abi.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;
const OBJECT_CALL_UNAVAILABLE = Symbol("object-call-unavailable");

export class VirRuntime extends ObjectValueRuntime {
  constructor(exports, {
    module = null,
    packageInfo = null,
    hostState = null,
    createReplacementRuntime = null,
  } = {}) {
    super();
    this.exports = exports;
    this.module = module;
    this.hostState = hostState;
    this.packageInfo = packageInfo;
    this.interfaceManifest = null;
    this.packageMetadata = null;
    this.boxedCallEntryNames = new Set();
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
    this.disposed = false;
    this.liveCallbacks = new Set();
    this.createReplacementRuntime = createReplacementRuntime;
    this.hostState?.attachRuntime(this);

    if (!this.exports.memory) {
      throw new Error("WASM memory export is missing");
    }
    if (typeof this.exports.vir_package_interface_manifest_size === "function" &&
        this.exports.vir_package_interface_manifest_size() !== 0) {
      this.interfaceManifest = this.readPackageManifest();
      this.hostState?.setManifest(this.interfaceManifest);
      this.packageMetadata = this.interfaceManifest.metadata;
      this.boxedCallEntryNames = boxedCallEntryNames(this.interfaceManifest);
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
    const packageBytes = asBytes(bytes, "IR package bytes");
    if (this.hasPackageState() || this.liveCallbacks.size !== 0) {
      if (typeof this.createReplacementRuntime !== "function") {
        throw new Error("IR package reload requires a factory-managed VirRuntime");
      }
      return this.replaceIrPackageBytes(packageBytes);
    }
    return this.installIrPackageBytes(packageBytes);
  }

  installIrPackageBytes(packageBytes) {
    this.requireFunction("vir_alloc_bytes");
    this.requireFunction("vir_load_ir_package");
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
      this.boxedCallEntryNames = boxedCallEntryNames(this.interfaceManifest);
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

  replaceIrPackageBytes(packageBytes) {
    const replacement = this.createReplacementRuntime();
    let packageInfo;
    try {
      packageInfo = replacement.installIrPackageBytes(packageBytes);
    } catch (error) {
      replacement.dispose({ disposeBindings: false });
      throw error;
    }

    try {
      this.teardownPackageResources();
    } catch (error) {
      replacement.dispose({ disposeBindings: false });
      throw error;
    }
    this.adoptRuntimeState(replacement);
    return packageInfo;
  }

  adoptRuntimeState(replacement) {
    this.exports = replacement.exports;
    this.module = replacement.module;
    this.hostState = replacement.hostState;
    this.packageInfo = replacement.packageInfo;
    this.interfaceManifest = replacement.interfaceManifest;
    this.packageMetadata = replacement.packageMetadata;
    this.boxedCallEntryNames = replacement.boxedCallEntryNames;
    this.liveCallbacks = replacement.liveCallbacks;
    this.hostState?.attachRuntime(this);
    this.rebuildManifestExports();

    replacement.disposed = true;
    replacement.hostState = null;
    replacement.liveCallbacks = new Set();
    replacement.exportsByName = Object.create(null);
  }

  clearPackageMetadata() {
    this.packageInfo = null;
    this.interfaceManifest = null;
    this.hostState?.setManifest(null);
    this.packageMetadata = null;
    this.boxedCallEntryNames = new Set();
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
  }

  hasPackageState() {
    return this.packageInfo !== null ||
      this.interfaceManifest !== null ||
      this.packageMetadata !== null ||
      (this.exports.vir_package_interface_manifest_size?.() ?? 0) !== 0 ||
      (this.packageDeclCount() ?? 0) !== 0;
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
    if (args.length !== entry.args.length) {
      throw new Error(`${entry.entry} expects ${entry.args.length} arguments, got ${args.length}`);
    }

    const cache = this.callCacheFor(entry);
    const objectResult = this.tryObjectResolvedCall(entry, args, cache);
    if (objectResult !== OBJECT_CALL_UNAVAILABLE) {
      return objectResult;
    }
    throw new Error(`object ABI does not support interface entry ${entry.entry}`);
  }

  tryObjectResolvedCall(entry, args, cache) {
    const plan = this.objectCallPlanFor(entry, cache);
    if (plan === null) {
      return OBJECT_CALL_UNAVAILABLE;
    }
    if (!this.hasObjectValueExports()) {
      return OBJECT_CALL_UNAVAILABLE;
    }
    const argObjs = [];
    try {
      for (let index = 0; index < plan.args.length; index++) {
        const arg = plan.args[index];
        argObjs.push(this.makeObjectValue(arg.type, args[index], `${entry.entry} argument ${arg.name}`));
      }
      return this.callResolvedObjects(entry, cache, argObjs, (resultObj) =>
        this.liftObjectValue(plan.resultType, resultObj, `${entry.entry} result`));
    } finally {
      this.releaseOwnedObjects(argObjs);
    }
  }

  objectCallPlanFor(entry, cache) {
    if (cache.objectCallPlan !== undefined) {
      return cache.objectCallPlan;
    }
    const resultType = entry.result;
    if (!objectResultSupported(resultType) ||
        !entry.args.every((arg) => objectArgumentSupported(arg.type))) {
      cache.objectCallPlan = null;
      return null;
    }
    const hasBoxedDecl = this.boxedCallEntryNames.has(entry.entry);
    if (
      !hasBoxedDecl &&
      (objectTypeNeedsBoxedBoundary(resultType) ||
        entry.args.some((arg) => objectTypeNeedsBoxedBoundary(arg.type)))
    ) {
      cache.objectCallPlan = null;
      return null;
    }
    cache.objectCallPlan = {
      args: entry.args,
      resultType,
    };
    return cache.objectCallPlan;
  }

  usizeMaxValue() {
    return this.targetPointerBytes() === 4 ? MAX_UINT32 : MAX_UINT64;
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
    const view = asBytes(bytes, "bytes");
    const ptr = this.allocByteLength(view.byteLength, "bytes");
    new Uint8Array(this.exports.memory.buffer, ptr, view.byteLength).set(view);
    return ptr;
  }

  allocByteLength(byteLength, label) {
    this.requireFunction("vir_alloc_bytes");
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      throw new Error(`${label} byte length must be a non-negative integer`);
    }
    const ptr = this.exports.vir_alloc_bytes(byteLength);
    if (ptr === 0 && byteLength !== 0) {
      throw new Error(`${label} allocation failed`);
    }
    return ptr;
  }

  writePointerArray(ptr, values) {
    const view = new DataView(this.exports.memory.buffer, ptr, values.length * 4);
    for (let index = 0; index < values.length; index++) {
      view.setUint32(index * 4, values[index], true);
    }
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
    this.requireFunction("vir_closure_call_objects");
    const fnArgs = requireFunctionArgs(type, "callback");
    if (args.length !== fnArgs.length) {
      throw new Error(`callback expects ${fnArgs.length} arguments, got ${args.length}`);
    }
    const argObjs = [];
    try {
      fnArgs.forEach((arg, index) => {
        argObjs.push(this.makeObjectValue(arg.type, args[index], `callback argument ${arg.name}`));
      });
      return this.callClosureObjects(rootId, type, argObjs);
    } finally {
      this.releaseOwnedObjects(argObjs);
    }
  }

  callClosureObjects(rootId, type, argObjs) {
    let argvPtr = 0;
    let resultObj = 0;
    try {
      if (argObjs.length !== 0) {
        argvPtr = this.allocByteLength(argObjs.length * 4, "callback argv pointer array");
        this.writePointerArray(argvPtr, argObjs);
      }
      resultObj = this.exports.vir_closure_call_objects(rootId, argvPtr, argObjs.length);
      argObjs.length = 0;
      if (resultObj === 0) {
        throw new Error(this.lastClosureCallError() || "closure call failed");
      }
      return this.liftObjectValue(requireFunctionResult(type, "callback"), resultObj, "callback result");
    } finally {
      if (argvPtr !== 0) {
        this.freeBytes(argvPtr);
      }
      if (resultObj !== 0) {
        this.exports.vir_obj_dec(resultObj);
      }
    }
  }

  releaseClosure(rootId) {
    this.exports.vir_closure_release?.(rootId);
  }

  lastClosureCallError() {
    const len = this.exports.vir_closure_call_error_size?.() ?? 0;
    return len === 0 ? "" : this.readWasmString(this.exports.vir_closure_call_error(), len);
  }

  dispose({ disposeBindings = true } = {}) {
    if (this.disposed) return;
    this.teardownPackageResources({ disposeBindings });
    this.disposed = true;
    this.hostState = null;
    this.exportsByName = Object.create(null);
  }

  teardownPackageResources({ disposeBindings = true } = {}) {
    this.hostState?.dispose({ disposeBindings });
    this.releaseLiveCallbacks();
  }

  releaseLiveCallbacks() {
    for (const callback of Array.from(this.liveCallbacks)) {
      callback.release();
    }
  }
}

function registerManifestEntryKey(map, key, entry) {
  if (typeof key === "string" && key !== "" && map[key] === undefined) {
    map[key] = entry;
  }
}

function boxedCallEntryNames(manifest) {
  const names = new Set();
  for (const target of manifest?.metadata?.targets ?? []) {
    for (const root of target?.resolvedRoots ?? []) {
      if (typeof root === "string" && root.endsWith("._boxed")) {
        names.add(root.slice(0, -("._boxed".length)));
      }
    }
  }
  return names;
}

function isIdentifier(text) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
}
