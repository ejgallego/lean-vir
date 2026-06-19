/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { validateInterfaceManifest } from "./runtime/interface-manifest.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";
import {
  asBytes,
  customInductiveConstructorAt,
  normalizeUint32,
  requireCustomInductiveConstructors,
  requireStructureFields,
  requireTaggedUnionConstructors,
  requireTypeField,
  taggedUnionConstructorAt,
} from "./runtime/vir-codec.js";
import { WIRE } from "./runtime/wire-tags.js";
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
  enumValue,
  flattenStructureSubobjects,
  normalizeArray,
  normalizeCustomInductive,
  normalizeDecimal,
  normalizeEnum,
  normalizeFloat,
  normalizeInteger,
  normalizeOption,
  normalizePair,
  normalizeStructure,
  normalizeTaggedUnion,
} from "./runtime/vir-value-normalizers.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;
export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");
const virCallbackStates = new WeakMap();
const FAST_CALL_UNAVAILABLE = Symbol("fast-call-unavailable");
const OBJECT_VALUE_EXPORTS = [
  "vir_obj_array",
  "vir_obj_array_get",
  "vir_obj_array_size",
  "vir_obj_byte_array",
  "vir_obj_byte_array_data",
  "vir_obj_byte_array_size",
  "vir_obj_ctor",
  "vir_obj_ctor_layout",
  "vir_obj_ctor_scalar_data",
  "vir_obj_ctor_usize_decimal",
  "vir_obj_decimal_size",
  "vir_obj_field",
  "vir_obj_float",
  "vir_obj_float_value",
  "vir_obj_float32",
  "vir_obj_float32_value",
  "vir_obj_int",
  "vir_obj_int_decimal",
  "vir_obj_list",
  "vir_obj_list_head",
  "vir_obj_list_is_nil",
  "vir_obj_list_tail",
  "vir_obj_nat",
  "vir_obj_nat_decimal",
  "vir_obj_is_scalar",
  "vir_obj_scalar",
  "vir_obj_scalar_value",
  "vir_obj_string",
  "vir_obj_string_data",
  "vir_obj_string_size",
  "vir_obj_tag",
  "vir_obj_uint32",
  "vir_obj_uint32_value",
  "vir_obj_uint64",
  "vir_obj_uint64_decimal",
  "vir_obj_usize",
  "vir_obj_usize_decimal",
];

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
    this.boxedCallEntryNames = new Set();
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

  tryObjectResolvedCall(entry, args, cache) {
    if (entry.effect !== "pure") {
      return FAST_CALL_UNAVAILABLE;
    }
    const resultType = entry.result;
    if (!objectResultSupported(resultType) ||
        !entry.args.every((arg) => objectArgumentSupported(arg.type))) {
      return FAST_CALL_UNAVAILABLE;
    }
    const hasBoxedDecl = this.boxedCallEntryNames.has(entry.entry);
    if (
      !hasBoxedDecl &&
      (objectTypeNeedsBoxedBoundary(resultType) ||
        entry.args.some((arg) => objectTypeNeedsBoxedBoundary(arg.type)))
    ) {
      return FAST_CALL_UNAVAILABLE;
    }
    if (!this.hasObjectValueExports()) {
      return FAST_CALL_UNAVAILABLE;
    }
    const argObjs = [];
    try {
      entry.args.forEach((arg, index) => {
        argObjs.push(this.makeObjectValue(arg.type, args[index], `${entry.entry} argument ${arg.name}`));
      });
      return this.callResolvedObjects(entry, cache, argObjs, (resultObj) =>
        this.liftObjectValue(resultType, resultObj, `${entry.entry} result`));
    } finally {
      this.releaseOwnedObjects(argObjs);
    }
  }

  hasObjectValueExports() {
    return this.hasObjectCallExports(...OBJECT_VALUE_EXPORTS);
  }

  makeObjectValue(type, value, label, selfType = null) {
    const tag = type?.wireTag;
    switch (tag) {
      case WIRE.RECURSIVE_SELF:
        if (selfType === null) {
          throw new Error(`${label} has a recursive self reference without an enclosing type`);
        }
        return this.makeObjectValue(selfType, value, label, selfType);
      case WIRE.UNIT:
        if (value !== undefined && value !== null) throw new Error(`${label} must be undefined or null`);
        return this.makeObjectScalar(0, label);
      case WIRE.BOOL:
        if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
        return this.makeObjectScalar(value ? 1 : 0, label);
      case WIRE.UINT8:
        return this.makeObjectScalar(normalizeInteger(value, label, 0, 0xff), label);
      case WIRE.UINT16:
        return this.makeObjectScalar(normalizeInteger(value, label, 0, 0xffff), label);
      case WIRE.SIMPLE_ENUM:
        return this.makeObjectScalar(normalizeEnum(value, type, label), label);
      case WIRE.NAT:
        return this.makeObjectDecimal("vir_obj_nat", normalizeDecimal(value, label, { signed: false }), label);
      case WIRE.INT:
        return this.makeObjectDecimal("vir_obj_int", normalizeDecimal(value, label, { signed: true }), label);
      case WIRE.STRING:
        return this.makeObjectString(value, label);
      case WIRE.UINT32:
        return this.makeObjectUint32(value, label);
      case WIRE.UINT64:
        return this.makeObjectDecimal(
          "vir_obj_uint64",
          normalizeBoundedUnsignedDecimal(value, label, MAX_UINT64, "UInt64"),
          label,
        );
      case WIRE.USIZE:
        return this.makeObjectDecimal(
          "vir_obj_usize",
          normalizeBoundedUnsignedDecimal(value, label, this.usizeMaxValue(), "USize"),
          label,
        );
      case WIRE.BYTE_ARRAY:
        return this.makeObjectByteArray(value, label);
      case WIRE.FLOAT:
        return this.makeObjectFloat(value, label);
      case WIRE.FLOAT32:
        return this.makeObjectFloat32(value, label);
      case WIRE.ARRAY:
      case WIRE.LIST:
        return this.makeObjectSequenceValue(type, value, label, selfType);
      case WIRE.OPTION:
        return this.makeObjectOptionValue(type, value, label, selfType);
      case WIRE.PROD:
        return this.makeObjectProdValue(type, value, label, selfType);
      case WIRE.STRUCTURE:
        return this.makeObjectStructureValue(type, value, label);
      case WIRE.TAGGED_UNION:
        return this.makeObjectTaggedUnionValue(type, value, label);
      case WIRE.CUSTOM_INDUCTIVE:
        return this.makeObjectCustomInductiveValue(type, value, label);
      default:
        throw new Error(`${label} has unsupported object ABI argument type`);
    }
  }

  makeObjectSequenceValue(sequenceType, value, label, selfType) {
    const sequenceTag = sequenceType?.wireTag;
    const builderName =
      sequenceTag === WIRE.ARRAY ? "vir_obj_array" :
      sequenceTag === WIRE.LIST ? "vir_obj_list" :
      null;
    if (builderName === null) {
      throw new Error(`${label} has unsupported object ABI sequence type`);
    }
    const values = normalizeArray(value, label);
    if (values.length > 0xffffffff) {
      throw new Error(`${label} has too many elements`);
    }

    const elementType = requireTypeField(sequenceType, "element", label);
    const elementObjs = [];
    try {
      values.forEach((value, index) => {
        elementObjs.push(this.makeObjectValue(elementType, value, `${label}[${index}]`, selfType));
      });
      return this.makeObjectSequenceFromOwnedElements(builderName, elementObjs, label);
    } finally {
      this.releaseOwnedObjects(elementObjs);
    }
  }

  makeObjectOptionValue(type, value, label, selfType) {
    const option = normalizeOption(value, label);
    if (!option.some) {
      return this.makeObjectScalar(0, label);
    }
    const fields = [
      this.makeObjectValue(requireTypeField(type, "element", label), option.value, `${label}.value`, selfType),
    ];
    try {
      return this.makeObjectCtorFromOwnedFields(1, fields, label);
    } finally {
      this.releaseOwnedObjects(fields);
    }
  }

  makeObjectProdValue(type, value, label, selfType) {
    const pair = normalizePair(value, label);
    const fields = [];
    try {
      fields.push(this.makeObjectValue(requireTypeField(type, "fst", label), pair.fst, `${label}.fst`, selfType));
      fields.push(this.makeObjectValue(requireTypeField(type, "snd", label), pair.snd, `${label}.snd`, selfType));
      return this.makeObjectCtorFromOwnedFields(0, fields, label);
    } finally {
      this.releaseOwnedObjects(fields);
    }
  }

  makeObjectStructureValue(type, value, label) {
    const fields = requireStructureFields(type, label);
    const record = normalizeStructure(value, fields, label);
    const trivial = trivialStructureField(type, fields);
    if (trivial !== null) {
      return this.makeObjectValue(trivial.type, record[trivial.name], `${label}.${trivial.name}`, type);
    }
    return this.makeObjectCtorFromLayout(0, type, fields, record, label, type);
  }

  makeObjectTaggedUnionValue(type, value, label) {
    const { index, ctor, payload } = normalizeTaggedUnion(value, type, label);
    const field = taggedUnionField(ctor);
    return this.makeObjectCtorFromLayout(index, ctor, [field], { [field.name]: payload }, label, type);
  }

  makeObjectCustomInductiveValue(type, value, label) {
    const { index, ctor, fields } = normalizeCustomInductive(value, type, label);
    if (ctor.fields.length === 0) {
      return this.makeObjectScalar(index, label);
    }
    return this.makeObjectCtorFromLayout(index, ctor, ctor.fields, fields, label, type);
  }

  makeObjectCtorFromLayout(tag, owner, fields, values, label, selfType) {
    const layout = objectLayoutSlots(owner, fields, label);
    try {
      for (const field of fields) {
        this.writeObjectLayoutField(layout, owner, field, values[field.name], `${label}.${field.name}`, selfType);
      }
      return this.makeObjectCtorFromOwnedLayout(tag, layout, label);
    } finally {
      this.releaseOwnedObjects(layout.objectFields);
    }
  }

  writeObjectLayoutField(layout, owner, field, value, label, selfType) {
    switch (field.layout.kind) {
      case "object":
        layout.objectFields[field.layout.index] = this.makeObjectValue(field.type, value, label, selfType);
        return;
      case "usize":
        layout.usizeFields[usizeLayoutIndex(owner, field.layout, label)] =
          normalizeBoundedUnsignedBigInt(value, label, this.usizeMaxValue(), "USize");
        return;
      case "scalar":
        writeObjectScalarField(layout.scalarBytes, field.type, field.layout, value, label);
        return;
      default:
        throw new Error(`${label} has unsupported object ABI layout`);
    }
  }

  makeObjectScalar(value, label) {
    const argObj = this.exports.vir_obj_scalar(value);
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean scalar object`);
    }
    return argObj;
  }

  makeObjectDecimal(constructorName, decimal, label) {
    const bytes = textEncoder.encode(decimal);
    const inputPtr = this.allocBytes(bytes);
    try {
      const argObj = this.exports[constructorName](inputPtr, bytes.byteLength);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean object`);
      }
      return argObj;
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectByteArray(value, label) {
    const bytes = asByteArrayBytes(value);
    const inputPtr = this.allocBytes(bytes);
    try {
      const argObj = this.exports.vir_obj_byte_array(inputPtr, bytes.byteLength);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean ByteArray object`);
      }
      return argObj;
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectString(value, label) {
    if (typeof value !== "string") {
      throw new Error(`${label} must be a string`);
    }
    const bytes = textEncoder.encode(value);
    const inputPtr = this.allocBytes(bytes);
    try {
      const argObj = this.exports.vir_obj_string(inputPtr, bytes.byteLength);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean string object`);
      }
      return argObj;
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectUint32(value, label) {
    const argObj = this.exports.vir_obj_uint32(normalizeUint32(value, label));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean UInt32 object`);
    }
    return argObj;
  }

  makeObjectFloat(value, label) {
    const argObj = this.exports.vir_obj_float(normalizeFloat(value, label));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean Float object`);
    }
    return argObj;
  }

  makeObjectFloat32(value, label) {
    const argObj = this.exports.vir_obj_float32(Math.fround(normalizeFloat(value, label)));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean Float32 object`);
    }
    return argObj;
  }

  makeObjectSequenceFromOwnedElements(builderName, elementObjs, label) {
    let valuesPtr = 0;
    try {
      if (elementObjs.length !== 0) {
        valuesPtr = this.allocBytes(new Uint8Array(elementObjs.length * 4));
        const view = new DataView(this.exports.memory.buffer, valuesPtr, elementObjs.length * 4);
        elementObjs.forEach((obj, index) => view.setUint32(index * 4, obj, true));
      }
      const sequenceObj = this.exports[builderName](valuesPtr, elementObjs.length);
      if (sequenceObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean sequence object`);
      }
      elementObjs.length = 0;
      return sequenceObj;
    } finally {
      if (valuesPtr !== 0) {
        this.freeBytes(valuesPtr);
      }
    }
  }

  makeObjectCtorFromOwnedFields(tag, fields, label) {
    let fieldsPtr = 0;
    try {
      if (fields.length !== 0) {
        fieldsPtr = this.allocBytes(new Uint8Array(fields.length * 4));
        const view = new DataView(this.exports.memory.buffer, fieldsPtr, fields.length * 4);
        fields.forEach((obj, index) => view.setUint32(index * 4, obj, true));
      }
      const obj = this.exports.vir_obj_ctor(tag, fieldsPtr, fields.length);
      if (obj === 0) {
        throw new Error(`${label} could not be lowered to a Lean constructor object`);
      }
      fields.length = 0;
      return obj;
    } finally {
      if (fieldsPtr !== 0) {
        this.freeBytes(fieldsPtr);
      }
    }
  }

  makeObjectCtorFromOwnedLayout(tag, layout, label) {
    let objectFieldsPtr = 0;
    let usizeFieldsPtr = 0;
    let scalarFieldsPtr = 0;
    try {
      if (layout.objectFields.length !== 0) {
        objectFieldsPtr = this.allocBytes(new Uint8Array(layout.objectFields.length * 4));
        const view = new DataView(this.exports.memory.buffer, objectFieldsPtr, layout.objectFields.length * 4);
        layout.objectFields.forEach((obj, index) => view.setUint32(index * 4, obj, true));
      }
      if (layout.usizeFields.length !== 0) {
        const pointerBytes = this.targetPointerBytes();
        usizeFieldsPtr = this.allocBytes(new Uint8Array(layout.usizeFields.length * pointerBytes));
        const view = new DataView(this.exports.memory.buffer, usizeFieldsPtr, layout.usizeFields.length * pointerBytes);
        layout.usizeFields.forEach((value, index) => {
          if (pointerBytes === 4) {
            view.setUint32(index * pointerBytes, Number(value), true);
          } else {
            view.setBigUint64(index * pointerBytes, value, true);
          }
        });
      }
      if (layout.scalarBytes.byteLength !== 0) {
        scalarFieldsPtr = this.allocBytes(layout.scalarBytes);
      }
      const obj = this.exports.vir_obj_ctor_layout(
        tag,
        objectFieldsPtr,
        layout.objectFields.length,
        usizeFieldsPtr,
        layout.usizeFields.length,
        scalarFieldsPtr,
        layout.scalarBytes.byteLength,
      );
      if (obj === 0) {
        throw new Error(`${label} could not be lowered to a Lean constructor object`);
      }
      layout.objectFields.length = 0;
      return obj;
    } finally {
      if (objectFieldsPtr !== 0) {
        this.freeBytes(objectFieldsPtr);
      }
      if (usizeFieldsPtr !== 0) {
        this.freeBytes(usizeFieldsPtr);
      }
      if (scalarFieldsPtr !== 0) {
        this.freeBytes(scalarFieldsPtr);
      }
    }
  }

  releaseOwnedObjects(objects) {
    for (const obj of objects) {
      if (obj !== 0) {
        this.exports.vir_obj_dec(obj);
      }
    }
    objects.length = 0;
  }

  callResolvedObjects(entry, cache, argObjs, liftResult) {
    const callSlot = this.resolveCallSlot(entry, cache);
    let argvPtr = 0;
    let resultObj = 0;
    try {
      if (argObjs.length !== 0) {
        argvPtr = this.allocBytes(new Uint8Array(argObjs.length * 4));
        const view = new DataView(this.exports.memory.buffer, argvPtr, argObjs.length * 4);
        argObjs.forEach((argObj, index) => view.setUint32(index * 4, argObj, true));
      }
      resultObj = this.exports.vir_call_resolved_objects(callSlot, argvPtr, argObjs.length);
      argObjs.length = 0;
      const error = this.lastCallError();
      if (error !== "") {
        throw new Error(error);
      }
      if (resultObj === 0) {
        throw new Error(`object call failed: ${entry.entry}`);
      }
      return liftResult(resultObj);
    } finally {
      if (argvPtr !== 0) {
        this.freeBytes(argvPtr);
      }
      if (resultObj !== 0) {
        this.exports.vir_obj_dec(resultObj);
      }
    }
  }

  hasObjectCallExports(...names) {
    return (
      typeof this.exports.vir_call_resolved_objects === "function" &&
      typeof this.exports.vir_obj_dec === "function" &&
      names.every((name) => typeof this.exports[name] === "function")
    );
  }

  readObjectByteArray(obj) {
    return this.readWasmBytes(
      this.exports.vir_obj_byte_array_data(obj),
      this.exports.vir_obj_byte_array_size(obj),
    );
  }

  readObjectString(obj) {
    return this.readWasmString(
      this.exports.vir_obj_string_data(obj),
      this.exports.vir_obj_string_size(obj),
    );
  }

  readObjectDecimal(obj, decimalName) {
    const data = this.exports[decimalName](obj);
    const len = this.exports.vir_obj_decimal_size();
    return this.readWasmString(data, len);
  }

  readObjectScalar(obj, label) {
    if (this.exports.vir_obj_is_scalar(obj) === 0) {
      throw new Error(`${label} is not a Lean scalar object`);
    }
    return this.exports.vir_obj_scalar_value(obj) >>> 0;
  }

  ownedObjectField(obj, index, label) {
    const field = this.exports.vir_obj_field(obj, index);
    if (field === 0) {
      throw new Error(`${label} field ${index} is unavailable`);
    }
    return field;
  }

  liftObjectValue(type, obj, label, selfType = null) {
    const tag = type?.wireTag;
    switch (tag) {
      case WIRE.RECURSIVE_SELF:
        if (selfType === null) {
          throw new Error(`${label} has a recursive self reference without an enclosing type`);
        }
        return this.liftObjectValue(selfType, obj, label, selfType);
      case WIRE.UNIT:
        return undefined;
      case WIRE.BOOL:
        return this.readObjectScalar(obj, label) !== 0;
      case WIRE.UINT8:
        return this.readBoundedObjectScalar(obj, label, 0xff);
      case WIRE.UINT16:
        return this.readBoundedObjectScalar(obj, label, 0xffff);
      case WIRE.SIMPLE_ENUM:
        return enumValue(type, this.readObjectScalar(obj, label));
      case WIRE.NAT:
        return this.readObjectDecimal(obj, "vir_obj_nat_decimal");
      case WIRE.INT:
        return this.readObjectDecimal(obj, "vir_obj_int_decimal");
      case WIRE.STRING:
        return this.readObjectString(obj);
      case WIRE.UINT32:
        return this.exports.vir_obj_uint32_value(obj) >>> 0;
      case WIRE.UINT64:
        return this.readObjectDecimal(obj, "vir_obj_uint64_decimal");
      case WIRE.USIZE:
        return this.readObjectDecimal(obj, "vir_obj_usize_decimal");
      case WIRE.BYTE_ARRAY:
        return this.readObjectByteArray(obj);
      case WIRE.FLOAT:
        return this.exports.vir_obj_float_value(obj);
      case WIRE.FLOAT32:
        return Math.fround(this.exports.vir_obj_float32_value(obj));
      case WIRE.ARRAY:
        return this.liftObjectArrayValue(type, obj, label, selfType);
      case WIRE.LIST:
        return this.liftObjectListValue(type, obj, label, selfType);
      case WIRE.OPTION:
        return this.liftObjectOptionValue(type, obj, label, selfType);
      case WIRE.PROD:
        return this.liftObjectProdValue(type, obj, label, selfType);
      case WIRE.STRUCTURE:
        return this.liftObjectStructureValue(type, obj, label);
      case WIRE.TAGGED_UNION:
        return this.liftObjectTaggedUnionValue(type, obj, label);
      case WIRE.CUSTOM_INDUCTIVE:
        return this.liftObjectCustomInductiveValue(type, obj, label);
      default:
        throw new Error(`${label} has unsupported object ABI result type`);
    }
  }

  readBoundedObjectScalar(obj, label, max) {
    const value = this.readObjectScalar(obj, label);
    if (value > max) {
      throw new Error(`${label} scalar value ${value} exceeds ${max}`);
    }
    return value;
  }

  liftObjectArrayValue(type, obj, label, selfType) {
    const len = this.exports.vir_obj_array_size(obj);
    const elementType = requireTypeField(type, "element", label);
    const values = [];
    for (let index = 0; index < len; index++) {
      const element = this.exports.vir_obj_array_get(obj, index);
      if (element === 0) {
        throw new Error(`${label}[${index}] is unavailable`);
      }
      try {
        values.push(this.liftObjectValue(elementType, element, `${label}[${index}]`, selfType));
      } finally {
        this.exports.vir_obj_dec(element);
      }
    }
    return values;
  }

  liftObjectListValue(type, obj, label, selfType) {
    const elementType = requireTypeField(type, "element", label);
    const values = [];
    let cursor = obj;
    let ownsCursor = false;
    try {
      while (this.exports.vir_obj_list_is_nil(cursor) === 0) {
        const index = values.length;
        const head = this.exports.vir_obj_list_head(cursor);
        if (head === 0) {
          throw new Error(`${label}[${index}] is unavailable`);
        }
        try {
          values.push(this.liftObjectValue(elementType, head, `${label}[${index}]`, selfType));
        } finally {
          this.exports.vir_obj_dec(head);
        }

        let tail = this.exports.vir_obj_list_tail(cursor);
        try {
          if (tail === 0) {
            throw new Error(`${label} tail after index ${index} is unavailable`);
          }
          if (ownsCursor) {
            this.exports.vir_obj_dec(cursor);
          }
          cursor = tail;
          ownsCursor = true;
          tail = 0;
        } finally {
          if (tail !== 0) {
            this.exports.vir_obj_dec(tail);
          }
        }
      }
      return values;
    } finally {
      if (ownsCursor) {
        this.exports.vir_obj_dec(cursor);
      }
    }
  }

  liftObjectOptionValue(type, obj, label, selfType) {
    const tag = this.exports.vir_obj_tag(obj);
    if (tag === 0) {
      return null;
    }
    if (tag !== 1) {
      throw new Error(`${label} has unexpected Option constructor tag ${tag}`);
    }
    const field = this.ownedObjectField(obj, 0, label);
    try {
      return this.liftObjectValue(requireTypeField(type, "element", label), field, `${label}.value`, selfType);
    } finally {
      this.exports.vir_obj_dec(field);
    }
  }

  liftObjectProdValue(type, obj, label, selfType) {
    const fst = this.ownedObjectField(obj, 0, label);
    try {
      const snd = this.ownedObjectField(obj, 1, label);
      try {
        return {
          fst: this.liftObjectValue(requireTypeField(type, "fst", label), fst, `${label}.fst`, selfType),
          snd: this.liftObjectValue(requireTypeField(type, "snd", label), snd, `${label}.snd`, selfType),
        };
      } finally {
        this.exports.vir_obj_dec(snd);
      }
    } finally {
      this.exports.vir_obj_dec(fst);
    }
  }

  liftObjectStructureValue(type, obj, label) {
    const fields = requireStructureFields(type, label);
    const trivial = trivialStructureField(type, fields);
    if (trivial !== null) {
      return { [trivial.name]: this.liftObjectValue(trivial.type, obj, `${label}.${trivial.name}`, type) };
    }
    const values = {};
    for (const field of fields) {
      values[field.name] = this.liftObjectLayoutField(type, obj, field, `${label}.${field.name}`);
    }
    return flattenStructureSubobjects(type, values);
  }

  liftObjectTaggedUnionValue(type, obj, label) {
    const tag = this.exports.vir_obj_tag(obj);
    const ctor = taggedUnionConstructorAt(type, tag, label);
    const field = taggedUnionField(ctor);
    return {
      kind: ctor.jsName,
      value: this.liftObjectLayoutField(ctor, obj, field, `${label}.${ctor.jsName}`, type),
    };
  }

  liftObjectCustomInductiveValue(type, obj, label) {
    const tag = this.exports.vir_obj_tag(obj);
    const ctor = customInductiveConstructorAt(type, tag, label);
    if (ctor.fields.length === 0) {
      return { kind: ctor.jsName };
    }
    objectLayoutSlots(ctor, ctor.fields, `${label}.${ctor.jsName}`);
    const values = {};
    for (const field of ctor.fields) {
      values[field.name] = this.liftObjectLayoutField(
        ctor,
        obj,
        field,
        `${label}.${ctor.jsName}.${field.name}`,
        type,
      );
    }
    return ctor.fields.length === 1 ? {
      kind: ctor.jsName,
      value: values[ctor.fields[0].name],
    } : {
      kind: ctor.jsName,
      fields: values,
    };
  }

  liftObjectLayoutField(owner, obj, field, label, selfType = owner) {
    switch (field.layout.kind) {
      case "object": {
        const fieldObj = this.ownedObjectField(obj, field.layout.index, label);
        try {
          return this.liftObjectValue(field.type, fieldObj, label, selfType);
        } finally {
          this.exports.vir_obj_dec(fieldObj);
        }
      }
      case "usize":
        usizeLayoutIndex(owner, field.layout, label);
        return this.readObjectUSizeField(obj, field.layout.index, label);
      case "scalar":
        return this.readObjectScalarField(owner, obj, field.type, field.layout, label);
      default:
        throw new Error(`${label} has unsupported object ABI layout`);
    }
  }

  readObjectUSizeField(obj, index, label) {
    const data = this.exports.vir_obj_ctor_usize_decimal(obj, index);
    if (data === 0) {
      throw new Error(`${label} USize field ${index} is unavailable`);
    }
    return this.readWasmString(data, this.exports.vir_obj_decimal_size());
  }

  readObjectScalarField(owner, obj, type, layout, label) {
    const data = this.exports.vir_obj_ctor_scalar_data(obj, owner.usizeFieldCount);
    if (data === 0) {
      throw new Error(`${label} scalar data is unavailable`);
    }
    return readObjectScalarField(
      new DataView(this.exports.memory.buffer, data, owner.scalarByteSize),
      type,
      layout,
      label,
    );
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

function objectArgumentSupported(type, selfType = null) {
  const tag = type?.wireTag;
  switch (tag) {
    case WIRE.RECURSIVE_SELF:
      return selfType !== null;
    case WIRE.UNIT:
    case WIRE.BOOL:
    case WIRE.NAT:
    case WIRE.INT:
    case WIRE.STRING:
    case WIRE.UINT8:
    case WIRE.UINT16:
    case WIRE.UINT32:
    case WIRE.UINT64:
    case WIRE.USIZE:
    case WIRE.BYTE_ARRAY:
    case WIRE.FLOAT:
    case WIRE.FLOAT32:
    case WIRE.SIMPLE_ENUM:
      return true;
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
      return objectArgumentSupported(requireTypeField(type, "element", "object argument"), selfType);
    case WIRE.PROD:
      return objectArgumentSupported(requireTypeField(type, "fst", "object argument"), selfType) &&
        objectArgumentSupported(requireTypeField(type, "snd", "object argument"), selfType);
    case WIRE.STRUCTURE:
      return objectStructureSupported(type, objectArgumentSupported);
    case WIRE.TAGGED_UNION:
      return objectTaggedUnionSupported(type, objectArgumentSupported);
    case WIRE.CUSTOM_INDUCTIVE:
      return objectCustomInductiveSupported(type, objectArgumentSupported);
    default:
      return false;
  }
}

function objectResultSupported(type, selfType = null) {
  const tag = type?.wireTag;
  switch (tag) {
    case WIRE.RECURSIVE_SELF:
      return selfType !== null;
    case WIRE.UNIT:
    case WIRE.BOOL:
    case WIRE.NAT:
    case WIRE.INT:
    case WIRE.STRING:
    case WIRE.UINT8:
    case WIRE.UINT16:
    case WIRE.UINT32:
    case WIRE.UINT64:
    case WIRE.USIZE:
    case WIRE.BYTE_ARRAY:
    case WIRE.FLOAT:
    case WIRE.FLOAT32:
    case WIRE.SIMPLE_ENUM:
      return true;
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
      return objectResultSupported(requireTypeField(type, "element", "object result"), selfType);
    case WIRE.PROD:
      return objectResultSupported(requireTypeField(type, "fst", "object result"), selfType) &&
        objectResultSupported(requireTypeField(type, "snd", "object result"), selfType);
    case WIRE.STRUCTURE:
      return objectStructureSupported(type, objectResultSupported);
    case WIRE.TAGGED_UNION:
      return objectTaggedUnionSupported(type, objectResultSupported);
    case WIRE.CUSTOM_INDUCTIVE:
      return objectCustomInductiveSupported(type, objectResultSupported);
    default:
      return false;
  }
}

function objectTypeNeedsBoxedBoundary(type) {
  switch (type?.wireTag) {
    case WIRE.FLOAT:
    case WIRE.FLOAT32:
    case WIRE.UINT64:
      return true;
    case WIRE.STRUCTURE: {
      const fields = requireStructureFields(type, "object boundary");
      const trivial = trivialStructureField(type, fields);
      return trivial !== null && objectTypeNeedsBoxedBoundary(trivial.type);
    }
    default:
      return false;
  }
}

function objectStructureSupported(type, fieldSupported) {
  const fields = requireStructureFields(type, "object structure");
  const trivial = trivialStructureField(type, fields);
  if (trivial !== null) {
    return fieldSupported(trivial.type, type);
  }
  return objectLayoutSupported(type, fields, fieldSupported, type);
}

function objectTaggedUnionSupported(type, fieldSupported) {
  return requireTaggedUnionConstructors(type, "object tagged union").every((ctor) =>
    objectLayoutSupported(ctor, [taggedUnionField(ctor)], fieldSupported, type));
}

function objectCustomInductiveSupported(type, fieldSupported) {
  return requireCustomInductiveConstructors(type, "object custom inductive").every((ctor) => {
    if (ctor.fields.length === 0) {
      const counts = objectRuntimeCounts(ctor, "object custom inductive");
      return counts.objectFieldCount === 0 && counts.usizeFieldCount === 0 && counts.scalarByteSize === 0;
    }
    return objectLayoutSupported(ctor, ctor.fields, fieldSupported, type);
  });
}

function objectLayoutSupported(owner, fields, fieldSupported, selfType) {
  try {
    objectLayoutSlots(owner, fields, "object layout");
  } catch {
    return false;
  }
  return fields.every((field) => objectFieldLayoutSupported(owner, field, fieldSupported, selfType));
}

function objectFieldLayoutSupported(owner, field, fieldSupported, selfType) {
  switch (field.layout.kind) {
    case "object":
      return objectLayoutIndex(owner, field.layout, field.name ?? "field") !== null &&
        fieldSupported(field.type, selfType);
    case "usize":
      return field.type?.wireTag === WIRE.USIZE &&
        usizeLayoutIndex(owner, field.layout, field.name ?? "field") !== null;
    case "scalar":
      return objectScalarFieldSupported(field.type, field.layout);
    default:
      return false;
  }
}

function trivialStructureField(type, fields) {
  const index = type?.trivialFieldIndex;
  if (!Number.isInteger(index)) {
    return null;
  }
  if (index < 0 || index >= fields.length) {
    throw new Error(`${type?.type ?? "structure"} has invalid trivial field index`);
  }
  return fields[index];
}

function taggedUnionField(ctor) {
  return {
    name: ctor.jsName,
    type: ctor.type,
    layout: ctor.layout,
  };
}

function objectLayoutSlots(owner, fields, label) {
  const counts = objectRuntimeCounts(owner, label);
  const objectFields = Array(counts.objectFieldCount).fill(0);
  const usizeFields = Array(counts.usizeFieldCount).fill(0n);
  const scalarBytes = new Uint8Array(counts.scalarByteSize);
  const seenObjects = new Set();
  const seenUSize = new Set();
  const seenScalarBytes = new Set();
  for (const field of fields) {
    const fieldLabel = `${label}.${field.name ?? "field"}`;
    switch (field.layout.kind) {
      case "object": {
        const index = objectLayoutIndex(owner, field.layout, fieldLabel);
        if (index === null) {
          throw new Error(`${fieldLabel} has unsupported object ABI layout`);
        }
        if (seenObjects.has(index)) {
          throw new Error(`${fieldLabel} duplicates object field index ${index}`);
        }
        seenObjects.add(index);
        break;
      }
      case "usize": {
        const index = usizeLayoutIndex(owner, field.layout, fieldLabel);
        if (index === null) {
          throw new Error(`${fieldLabel} has unsupported object ABI layout`);
        }
        if (seenUSize.has(index)) {
          throw new Error(`${fieldLabel} duplicates USize field index ${field.layout.index}`);
        }
        seenUSize.add(index);
        break;
      }
      case "scalar":
        scalarLayoutOffset(field.layout, counts.scalarByteSize, fieldLabel);
        for (let index = field.layout.offset; index < field.layout.offset + field.layout.size; index++) {
          if (seenScalarBytes.has(index)) {
            throw new Error(`${fieldLabel} overlaps scalar byte ${index}`);
          }
          seenScalarBytes.add(index);
        }
        break;
      default:
        throw new Error(`${fieldLabel} has unsupported object ABI layout`);
    }
  }
  return { objectFields, usizeFields, scalarBytes };
}

function objectRuntimeCounts(owner, label) {
  const objectFieldCount = owner?.objectFieldCount;
  const usizeFieldCount = owner?.usizeFieldCount;
  const scalarByteSize = owner?.scalarByteSize;
  if (
    !Number.isInteger(objectFieldCount) || objectFieldCount < 0 ||
    !Number.isInteger(usizeFieldCount) || usizeFieldCount < 0 ||
    !Number.isInteger(scalarByteSize) || scalarByteSize < 0
  ) {
    throw new Error(`${label} has unsupported object ABI runtime counts`);
  }
  return { objectFieldCount, usizeFieldCount, scalarByteSize };
}

function objectLayoutIndex(owner, layout, label) {
  if (layout?.kind !== "object" || !Number.isInteger(layout.index)) {
    return null;
  }
  const { objectFieldCount } = objectRuntimeCounts(owner, label);
  return layout.index >= 0 && layout.index < objectFieldCount ? layout.index : null;
}

function usizeLayoutIndex(owner, layout, label) {
  if (layout?.kind !== "usize" || !Number.isInteger(layout.index)) {
    return null;
  }
  const { objectFieldCount, usizeFieldCount } = objectRuntimeCounts(owner, label);
  const index = layout.index - objectFieldCount;
  return index >= 0 && index < usizeFieldCount ? index : null;
}

function scalarLayoutOffset(layout, scalarByteSize, label) {
  if (
    layout?.kind !== "scalar" ||
    !Number.isInteger(layout.offset) ||
    !Number.isInteger(layout.size) ||
    layout.offset < 0 ||
    layout.size <= 0 ||
    layout.offset + layout.size > scalarByteSize
  ) {
    throw new Error(`${label} has unsupported object ABI scalar layout`);
  }
  return layout.offset;
}

function objectScalarFieldSupported(type, layout) {
  if (layout?.kind !== "scalar") {
    return false;
  }
  switch (type?.wireTag) {
    case WIRE.BOOL:
    case WIRE.SIMPLE_ENUM:
      return [1, 2, 4, 8].includes(layout.size);
    case WIRE.UINT8:
      return layout.size === 1;
    case WIRE.UINT16:
      return layout.size === 2;
    case WIRE.UINT32:
    case WIRE.FLOAT32:
      return layout.size === 4;
    case WIRE.UINT64:
    case WIRE.FLOAT:
      return layout.size === 8;
    default:
      return false;
  }
}

function writeObjectScalarField(bytes, type, layout, value, label) {
  const offset = scalarLayoutOffset(layout, bytes.byteLength, label);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type?.wireTag) {
    case WIRE.BOOL:
      if (typeof value !== "boolean") {
        throw new Error(`${label} must be a boolean`);
      }
      writeScalarUnsigned(view, offset, layout.size, value ? 1n : 0n, label);
      return;
    case WIRE.UINT8:
      requireScalarSize(layout, 1, label);
      view.setUint8(offset, normalizeInteger(value, label, 0, 0xff));
      return;
    case WIRE.UINT16:
      requireScalarSize(layout, 2, label);
      view.setUint16(offset, normalizeInteger(value, label, 0, 0xffff), true);
      return;
    case WIRE.UINT32:
      requireScalarSize(layout, 4, label);
      view.setUint32(offset, normalizeUint32(value, label), true);
      return;
    case WIRE.UINT64:
      requireScalarSize(layout, 8, label);
      view.setBigUint64(offset, normalizeBoundedUnsignedBigInt(value, label, MAX_UINT64, "UInt64"), true);
      return;
    case WIRE.FLOAT:
      requireScalarSize(layout, 8, label);
      view.setFloat64(offset, normalizeFloat(value, label), true);
      return;
    case WIRE.FLOAT32:
      requireScalarSize(layout, 4, label);
      view.setFloat32(offset, Math.fround(normalizeFloat(value, label)), true);
      return;
    case WIRE.SIMPLE_ENUM:
      writeScalarUnsigned(view, offset, layout.size, BigInt(normalizeEnum(value, type, label)), label);
      return;
    default:
      throw new Error(`${label} has unsupported object ABI scalar type`);
  }
}

function readObjectScalarField(view, type, layout, label) {
  const offset = scalarLayoutOffset(layout, view.byteLength, label);
  switch (type?.wireTag) {
    case WIRE.BOOL:
      return readScalarUnsigned(view, offset, layout.size, label) !== 0n;
    case WIRE.UINT8:
      requireScalarSize(layout, 1, label);
      return view.getUint8(offset);
    case WIRE.UINT16:
      requireScalarSize(layout, 2, label);
      return view.getUint16(offset, true);
    case WIRE.UINT32:
      requireScalarSize(layout, 4, label);
      return view.getUint32(offset, true);
    case WIRE.UINT64:
      requireScalarSize(layout, 8, label);
      return view.getBigUint64(offset, true).toString();
    case WIRE.FLOAT:
      requireScalarSize(layout, 8, label);
      return view.getFloat64(offset, true);
    case WIRE.FLOAT32:
      requireScalarSize(layout, 4, label);
      return Math.fround(view.getFloat32(offset, true));
    case WIRE.SIMPLE_ENUM: {
      const tag = readScalarUnsigned(view, offset, layout.size, label);
      if (tag > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label} enum tag is too large for JavaScript`);
      }
      return enumValue(type, Number(tag));
    }
    default:
      throw new Error(`${label} has unsupported object ABI scalar type`);
  }
}

function requireScalarSize(layout, expected, label) {
  if (layout.size !== expected) {
    throw new Error(`${label} has scalar size ${layout.size}, expected ${expected}`);
  }
}

function writeScalarUnsigned(view, offset, size, value, label) {
  const normalized = typeof value === "bigint" ? value : BigInt(value);
  if (normalized < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  switch (size) {
    case 1:
      if (normalized > 0xffn) throw new Error(`${label} exceeds UInt8 scalar field size`);
      view.setUint8(offset, Number(normalized));
      return;
    case 2:
      if (normalized > 0xffffn) throw new Error(`${label} exceeds UInt16 scalar field size`);
      view.setUint16(offset, Number(normalized), true);
      return;
    case 4:
      if (normalized > MAX_UINT32) throw new Error(`${label} exceeds UInt32 scalar field size`);
      view.setUint32(offset, Number(normalized), true);
      return;
    case 8:
      if (normalized > MAX_UINT64) throw new Error(`${label} exceeds UInt64 scalar field size`);
      view.setBigUint64(offset, normalized, true);
      return;
    default:
      throw new Error(`${label} has unsupported scalar field size ${size}`);
  }
}

function readScalarUnsigned(view, offset, size, label) {
  switch (size) {
    case 1:
      return BigInt(view.getUint8(offset));
    case 2:
      return BigInt(view.getUint16(offset, true));
    case 4:
      return BigInt(view.getUint32(offset, true));
    case 8:
      return view.getBigUint64(offset, true);
    default:
      throw new Error(`${label} has unsupported scalar field size ${size}`);
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

function normalizeBoundedUnsignedDecimal(value, label, max, typeName) {
  const decimal = normalizeDecimal(value, label, { signed: false });
  const normalized = BigInt(decimal);
  if (normalized > max) {
    throw new Error(`${label} is out of range for ${typeName}`);
  }
  return decimal;
}

function normalizeBoundedUnsignedBigInt(value, label, max, typeName) {
  return BigInt(normalizeBoundedUnsignedDecimal(value, label, max, typeName));
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
