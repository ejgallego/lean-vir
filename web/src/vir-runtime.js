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
  requireFunctionArgs,
  requireFunctionResult,
  requireCustomInductiveConstructors,
  requireStructureFields,
  requireTaggedUnionConstructors,
  requireTypeField,
  taggedUnionConstructorAt,
} from "./runtime/vir-codec.js";
import { interfaceEffectRuntimeTag } from "./runtime/interface-effects.js";
import { WIRE } from "./runtime/wire-tags.js";
import {
  ExternrefResourceRoots,
  VIR_HOST_DISPOSE,
  isHostResource,
  normalizeHostResource,
} from "./host-resource.js";
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
export {
  VIR_HOST_DISPOSE,
} from "./host-resource.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;
const virCallbackStates = new WeakMap();
const objectLayoutPlanCache = new WeakMap();
const OBJECT_CALL_UNAVAILABLE = Symbol("object-call-unavailable");
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
  "vir_obj_closure_root",
  "vir_obj_decimal_size",
  "vir_obj_expr_app",
  "vir_obj_expr_bvar",
  "vir_obj_expr_const",
  "vir_obj_expr_forall",
  "vir_obj_expr_fvar",
  "vir_obj_expr_lambda",
  "vir_obj_expr_let",
  "vir_obj_expr_lit",
  "vir_obj_expr_mvar",
  "vir_obj_expr_proj",
  "vir_obj_expr_scalar_u8",
  "vir_obj_expr_sort",
  "vir_obj_field",
  "vir_obj_float",
  "vir_obj_float_value",
  "vir_obj_float32",
  "vir_obj_float32_value",
  "vir_obj_int",
  "vir_obj_int_decimal",
  "vir_obj_level_imax",
  "vir_obj_level_max",
  "vir_obj_level_mvar",
  "vir_obj_level_param",
  "vir_obj_level_succ",
  "vir_obj_level_zero",
  "vir_obj_list",
  "vir_obj_list_head",
  "vir_obj_list_is_nil",
  "vir_obj_list_tail",
  "vir_obj_literal_nat",
  "vir_obj_literal_string",
  "vir_obj_name_string",
  "vir_obj_name_string_size",
  "vir_obj_resource",
  "vir_obj_resource_externref",
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
        if (spec.module === "env" && spec.name === "vir_js_call_objects") {
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
    imports.env.vir_js_call_objects = (slot, argvPtr, argc) => {
      try {
        return hostState.callObjects(slot, argvPtr, argc);
      } catch (error) {
        hostState.recordCallError(error);
        return 0;
      }
    };
    imports.env.vir_resource_root = (value) => hostState.rootResource(value);
    imports.env.vir_resource_get = (rootId) => hostState.getRootedResource(rootId);
    imports.env.vir_resource_release = (rootId) => hostState.releaseRootedResource(rootId);
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
      case WIRE.RESOURCE:
        return this.makeObjectResource(value, label);
      case WIRE.FUNCTION:
        throw new Error(`${label} cannot be a JavaScript function in v1`);
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
      case WIRE.EXPR:
        return this.makeObjectExpr(value, label);
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
      for (let index = 0; index < values.length; index++) {
        elementObjs.push(this.makeObjectValue(elementType, values[index], `${label}[${index}]`, selfType));
      }
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
    const plan = objectLayoutPlan(owner, fields, label);
    const layout = objectLayoutSlotsFromPlan(plan);
    try {
      for (const fieldPlan of plan.fields) {
        const field = fieldPlan.field;
        this.writeObjectLayoutField(layout, fieldPlan, values[field.name], `${label}.${field.name}`, selfType);
      }
      return this.makeObjectCtorFromOwnedLayout(tag, layout, label);
    } finally {
      this.releaseOwnedObjects(layout.objectFields);
    }
  }

  writeObjectLayoutField(layout, fieldPlan, value, label, selfType) {
    const field = fieldPlan.field;
    switch (fieldPlan.kind) {
      case "object":
        layout.objectFields[fieldPlan.index] = this.makeObjectValue(field.type, value, label, selfType);
        return;
      case "usize":
        layout.usizeFields[fieldPlan.index] =
          normalizeBoundedUnsignedBigInt(value, label, this.usizeMaxValue(), "USize");
        return;
      case "scalar":
        writeObjectScalarField(layout.scalarBytes, field.type, field.layout, value, label, fieldPlan.offset);
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
    return this.withWasmString(value, label, (inputPtr, inputLen) => {
      const argObj = this.exports.vir_obj_string(inputPtr, inputLen);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean string object`);
      }
      return argObj;
    });
  }

  makeObjectStringConstructor(constructorName, value, stringLabel, objectLabel) {
    return this.withWasmString(requireString(value, stringLabel), stringLabel, (inputPtr, inputLen) => {
      const obj = this.exports[constructorName](inputPtr, inputLen);
      if (obj === 0) {
        throw new Error(`${objectLabel} could not be lowered to a Lean object`);
      }
      return obj;
    });
  }

  withWasmString(value, label, callback) {
    const bytes = textEncoder.encode(requireString(value, label));
    const inputPtr = this.allocBytes(bytes);
    try {
      return callback(inputPtr, bytes.byteLength);
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

  makeObjectResource(value, label) {
    const resource = normalizeHostResource(value, label);
    const argObj = this.exports.vir_obj_resource(resource);
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean host resource object`);
    }
    return argObj;
  }

  makeObjectExpr(value, label) {
    const expr = typeof value === "string"
      ? { kind: "const", name: value, levels: [] }
      : value;
    switch (expr?.kind) {
      case "bvar":
        return this.makeObjectDecimal(
          "vir_obj_expr_bvar",
          normalizeDecimal(expr.index ?? expr.deBruijnIndex, `${label}.index`, { signed: false }),
          label,
        );
      case "fvar":
        return this.makeObjectStringConstructor("vir_obj_expr_fvar", expr.name, `${label}.name`, label);
      case "mvar":
        return this.makeObjectStringConstructor("vir_obj_expr_mvar", expr.name, `${label}.name`, label);
      case "sort": {
        let level = this.makeObjectLevel(expr.level ?? expr.u, `${label}.level`);
        try {
          const obj = this.exports.vir_obj_expr_sort(level);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr sort object`);
          level = 0;
          return obj;
        } finally {
          this.releaseOwnedObjects([level]);
        }
      }
      case "const": {
        let levels = this.makeObjectLevelList(expr.levels ?? [], `${label}.levels`);
        try {
          return this.withWasmString(requireString(expr.name, `${label}.name`), `${label}.name`, (namePtr, nameLen) => {
            const obj = this.exports.vir_obj_expr_const(namePtr, nameLen, levels);
            if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr const object`);
            levels = 0;
            return obj;
          });
        } finally {
          this.releaseOwnedObjects([levels]);
        }
      }
      case "app":
        return this.makeObjectExprBinary("vir_obj_expr_app", expr.fn, `${label}.fn`, expr.arg, `${label}.arg`, label);
      case "lam":
      case "lambda":
        return this.makeObjectExprBinding(
          "vir_obj_expr_lambda",
          expr.name ?? expr.binderName,
          expr.type ?? expr.binderType,
          expr.body,
          normalizeBinderInfo(expr.binderInfo ?? "default", `${label}.binderInfo`),
          label,
        );
      case "forall":
      case "forallE":
        return this.makeObjectExprBinding(
          "vir_obj_expr_forall",
          expr.name ?? expr.binderName,
          expr.type ?? expr.binderType,
          expr.body,
          normalizeBinderInfo(expr.binderInfo ?? "default", `${label}.binderInfo`),
          label,
        );
      case "let":
      case "letE":
        return this.makeObjectExprLet(expr, label);
      case "lit": {
        let literal = this.makeObjectLiteral(expr.literal ?? expr.value, `${label}.literal`);
        try {
          const obj = this.exports.vir_obj_expr_lit(literal);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr literal object`);
          literal = 0;
          return obj;
        } finally {
          this.releaseOwnedObjects([literal]);
        }
      }
      case "mdata":
        return this.makeObjectExpr(expr.expr, `${label}.expr`);
      case "proj":
        return this.makeObjectExprProj(expr, label);
      default:
        throw new Error(`${label} has unsupported Lean.Expr kind ${expr?.kind}`);
    }
  }

  makeObjectLevel(value, label) {
    const level = typeof value === "string" ? { kind: value } : value ?? { kind: "zero" };
    switch (level.kind) {
      case "zero": {
        const obj = this.exports.vir_obj_level_zero();
        if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Level zero object`);
        return obj;
      }
      case "succ": {
        let child = this.makeObjectLevel(level.of ?? level.level, `${label}.of`);
        try {
          const obj = this.exports.vir_obj_level_succ(child);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Level succ object`);
          child = 0;
          return obj;
        } finally {
          this.releaseOwnedObjects([child]);
        }
      }
      case "max":
        return this.makeObjectLevelBinary(
          "vir_obj_level_max",
          level.left ?? level.lhs,
          `${label}.left`,
          level.right ?? level.rhs,
          `${label}.right`,
          label,
        );
      case "imax":
        return this.makeObjectLevelBinary(
          "vir_obj_level_imax",
          level.left ?? level.lhs,
          `${label}.left`,
          level.right ?? level.rhs,
          `${label}.right`,
          label,
        );
      case "param":
        return this.makeObjectStringConstructor("vir_obj_level_param", level.name, `${label}.name`, label);
      case "mvar":
        return this.makeObjectStringConstructor("vir_obj_level_mvar", level.name, `${label}.name`, label);
      default:
        throw new Error(`${label} has unsupported Lean.Level kind ${level.kind}`);
    }
  }

  makeObjectLevelList(levels, label) {
    const values = levels == null ? [] : normalizeArray(levels, label);
    const levelObjs = [];
    try {
      values.forEach((level, index) => {
        levelObjs.push(this.makeObjectLevel(level, `${label}[${index}]`));
      });
      return this.makeObjectSequenceFromOwnedElements("vir_obj_list", levelObjs, label);
    } finally {
      this.releaseOwnedObjects(levelObjs);
    }
  }

  makeObjectLiteral(value, label) {
    const literal =
      typeof value === "string" || typeof value === "number" || typeof value === "bigint"
        ? { kind: typeof value === "string" ? "string" : "nat", value }
        : value;
    switch (literal?.kind) {
      case "nat":
        return this.makeObjectDecimal(
          "vir_obj_literal_nat",
          normalizeDecimal(literal.value, `${label}.value`, { signed: false }),
          label,
        );
      case "string":
        return this.makeObjectStringConstructor("vir_obj_literal_string", literal.value, `${label}.value`, label);
      default:
        throw new Error(`${label} has unsupported Lean.Literal kind ${literal?.kind}`);
    }
  }

  makeObjectLevelBinary(constructorName, leftValue, leftLabel, rightValue, rightLabel, label) {
    let left = this.makeObjectLevel(leftValue, leftLabel);
    let right = 0;
    try {
      right = this.makeObjectLevel(rightValue, rightLabel);
      const obj = this.exports[constructorName](left, right);
      if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Level object`);
      left = 0;
      right = 0;
      return obj;
    } finally {
      this.releaseOwnedObjects([left, right]);
    }
  }

  makeObjectExprBinary(constructorName, leftValue, leftLabel, rightValue, rightLabel, label) {
    let left = this.makeObjectExpr(leftValue, leftLabel);
    let right = 0;
    try {
      right = this.makeObjectExpr(rightValue, rightLabel);
      const obj = this.exports[constructorName](left, right);
      if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr object`);
      left = 0;
      right = 0;
      return obj;
    } finally {
      this.releaseOwnedObjects([left, right]);
    }
  }

  makeObjectExprBinding(constructorName, name, typeValue, bodyValue, binderInfo, label) {
    let type = this.makeObjectExpr(typeValue, `${label}.type`);
    let body = 0;
    try {
      body = this.makeObjectExpr(bodyValue, `${label}.body`);
      return this.withWasmString(requireString(name, `${label}.name`), `${label}.name`, (namePtr, nameLen) => {
        const obj = this.exports[constructorName](namePtr, nameLen, type, body, binderInfo);
        if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr binding object`);
        type = 0;
        body = 0;
        return obj;
      });
    } finally {
      this.releaseOwnedObjects([type, body]);
    }
  }

  makeObjectExprLet(expr, label) {
    let type = this.makeObjectExpr(expr.type, `${label}.type`);
    let value = 0;
    let body = 0;
    try {
      value = this.makeObjectExpr(expr.value, `${label}.value`);
      body = this.makeObjectExpr(expr.body, `${label}.body`);
      return this.withWasmString(
        requireString(expr.name ?? expr.declName, `${label}.name`),
        `${label}.name`,
        (namePtr, nameLen) => {
          const obj = this.exports.vir_obj_expr_let(
            namePtr,
            nameLen,
            type,
            value,
            body,
            expr.nondep ? 1 : 0,
          );
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr let object`);
          type = 0;
          value = 0;
          body = 0;
          return obj;
        },
      );
    } finally {
      this.releaseOwnedObjects([type, value, body]);
    }
  }

  makeObjectExprProj(expr, label) {
    let structure = this.makeObjectExpr(expr.struct ?? expr.expr, `${label}.struct`);
    try {
      return this.withWasmString(requireString(expr.typeName, `${label}.typeName`), `${label}.typeName`, (
        typeNamePtr,
        typeNameLen,
      ) => this.withWasmString(
        normalizeDecimal(expr.index ?? expr.idx, `${label}.index`, { signed: false }),
        `${label}.index`,
        (indexPtr, indexLen) => {
          const obj = this.exports.vir_obj_expr_proj(typeNamePtr, typeNameLen, indexPtr, indexLen, structure);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr proj object`);
          structure = 0;
          return obj;
        },
      ));
    } finally {
      this.releaseOwnedObjects([structure]);
    }
  }

  makeObjectSequenceFromOwnedElements(builderName, elementObjs, label) {
    let valuesPtr = 0;
    try {
      if (elementObjs.length !== 0) {
        valuesPtr = this.allocByteLength(elementObjs.length * 4, `${label} pointer array`);
        this.writePointerArray(valuesPtr, elementObjs);
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
        fieldsPtr = this.allocByteLength(fields.length * 4, `${label} field pointer array`);
        this.writePointerArray(fieldsPtr, fields);
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
        objectFieldsPtr = this.allocByteLength(layout.objectFields.length * 4, `${label} object field pointer array`);
        this.writePointerArray(objectFieldsPtr, layout.objectFields);
      }
      if (layout.usizeFields.length !== 0) {
        const pointerBytes = this.targetPointerBytes();
        usizeFieldsPtr = this.allocByteLength(
          layout.usizeFields.length * pointerBytes,
          `${label} usize field array`,
        );
        const view = new DataView(this.exports.memory.buffer, usizeFieldsPtr, layout.usizeFields.length * pointerBytes);
        for (let index = 0; index < layout.usizeFields.length; index++) {
          const value = layout.usizeFields[index];
          if (pointerBytes === 4) {
            view.setUint32(index * pointerBytes, Number(value), true);
          } else {
            view.setBigUint64(index * pointerBytes, value, true);
          }
        }
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
      this.hostState?.clearCallError();
      if (argObjs.length !== 0) {
        argvPtr = this.allocByteLength(argObjs.length * 4, `${entry.entry} argv pointer array`);
        this.writePointerArray(argvPtr, argObjs);
      }
      resultObj = this.exports.vir_call_resolved_objects(callSlot, argvPtr, argObjs.length);
      argObjs.length = 0;
      const hostError = this.hostState?.takeCallError();
      if (hostError) {
        throw hostError;
      }
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

  readObjectName(obj) {
    const data = this.exports.vir_obj_name_string(obj);
    const len = this.exports.vir_obj_name_string_size();
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

  withOwnedObjectField(obj, index, label, callback) {
    const field = this.ownedObjectField(obj, index, label);
    try {
      return callback(field);
    } finally {
      this.exports.vir_obj_dec(field);
    }
  }

  withOwnedObjectFields(obj, indexes, label, callback) {
    const fields = [];
    try {
      for (const index of indexes) {
        fields.push(this.ownedObjectField(obj, index, label));
      }
      return callback(fields);
    } finally {
      this.releaseOwnedObjects(fields);
    }
  }

  liftObjectExpr(obj, label) {
    const kind = this.exports.vir_obj_tag(obj);
    switch (kind) {
      case 0:
        return this.withOwnedObjectField(obj, 0, label, (index) => ({
          kind: "bvar",
          index: this.readObjectDecimal(index, "vir_obj_nat_decimal"),
        }));
      case 1:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "fvar",
          name: this.readObjectName(name),
        }));
      case 2:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "mvar",
          name: this.readObjectName(name),
        }));
      case 3:
        return this.withOwnedObjectField(obj, 0, label, (level) => ({
          kind: "sort",
          level: this.liftObjectLevel(level, `${label}.level`),
        }));
      case 4:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([name, levels]) => ({
          kind: "const",
          name: this.readObjectName(name),
          levels: this.liftObjectLevelList(levels, `${label}.levels`),
        }));
      case 5:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([fn, arg]) => ({
          kind: "app",
          fn: this.liftObjectExpr(fn, `${label}.fn`),
          arg: this.liftObjectExpr(arg, `${label}.arg`),
        }));
      case 6:
        return this.withOwnedObjectFields(obj, [0, 1, 2], label, ([name, type, body]) => ({
          kind: "lam",
          name: this.readObjectName(name),
          type: this.liftObjectExpr(type, `${label}.type`),
          body: this.liftObjectExpr(body, `${label}.body`),
          binderInfo: decodeBinderInfo(this.exports.vir_obj_expr_scalar_u8(obj, 3)),
        }));
      case 7:
        return this.withOwnedObjectFields(obj, [0, 1, 2], label, ([name, type, body]) => ({
          kind: "forall",
          name: this.readObjectName(name),
          type: this.liftObjectExpr(type, `${label}.type`),
          body: this.liftObjectExpr(body, `${label}.body`),
          binderInfo: decodeBinderInfo(this.exports.vir_obj_expr_scalar_u8(obj, 3)),
        }));
      case 8:
        return this.withOwnedObjectFields(obj, [0, 1, 2, 3], label, ([name, type, value, body]) => ({
          kind: "let",
          name: this.readObjectName(name),
          type: this.liftObjectExpr(type, `${label}.type`),
          value: this.liftObjectExpr(value, `${label}.value`),
          body: this.liftObjectExpr(body, `${label}.body`),
          nondep: this.exports.vir_obj_expr_scalar_u8(obj, 4) !== 0,
        }));
      case 9:
        return this.withOwnedObjectField(obj, 0, label, (literal) => ({
          kind: "lit",
          literal: this.liftObjectLiteral(literal, `${label}.literal`),
        }));
      case 10:
        return this.withOwnedObjectField(obj, 1, label, (expr) => ({
          kind: "mdata",
          expr: this.liftObjectExpr(expr, `${label}.expr`),
        }));
      case 11:
        return this.withOwnedObjectFields(obj, [0, 1, 2], label, ([typeName, index, structure]) => ({
          kind: "proj",
          typeName: this.readObjectName(typeName),
          index: this.readObjectDecimal(index, "vir_obj_nat_decimal"),
          struct: this.liftObjectExpr(structure, `${label}.struct`),
        }));
      default:
        throw new Error(`${label} has unsupported Lean.Expr result kind ${kind}`);
    }
  }

  liftObjectLevel(obj, label) {
    if (this.exports.vir_obj_is_scalar(obj) !== 0) {
      return { kind: "zero" };
    }
    const kind = this.exports.vir_obj_tag(obj);
    switch (kind) {
      case 0:
        return { kind: "zero" };
      case 1:
        return this.withOwnedObjectField(obj, 0, label, (child) => ({
          kind: "succ",
          of: this.liftObjectLevel(child, `${label}.of`),
        }));
      case 2:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([left, right]) => ({
          kind: "max",
          left: this.liftObjectLevel(left, `${label}.left`),
          right: this.liftObjectLevel(right, `${label}.right`),
        }));
      case 3:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([left, right]) => ({
          kind: "imax",
          left: this.liftObjectLevel(left, `${label}.left`),
          right: this.liftObjectLevel(right, `${label}.right`),
        }));
      case 4:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "param",
          name: this.readObjectName(name),
        }));
      case 5:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "mvar",
          name: this.readObjectName(name),
        }));
      default:
        throw new Error(`${label} has unsupported Lean.Level result kind ${kind}`);
    }
  }

  liftObjectLevelList(obj, label) {
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
          values.push(this.liftObjectLevel(head, `${label}[${index}]`));
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

  liftObjectLiteral(obj, label) {
    const kind = this.exports.vir_obj_tag(obj);
    switch (kind) {
      case 0:
        return this.withOwnedObjectField(obj, 0, label, (value) => ({
          kind: "nat",
          value: this.readObjectDecimal(value, "vir_obj_nat_decimal"),
        }));
      case 1:
        return this.withOwnedObjectField(obj, 0, label, (value) => ({
          kind: "string",
          value: this.readObjectString(value),
        }));
      default:
        throw new Error(`${label} has unsupported Lean.Literal result kind ${kind}`);
    }
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
      case WIRE.RESOURCE:
        return this.liftObjectResource(obj, label);
      case WIRE.FUNCTION:
        return this.liftObjectFunction(type, obj, label);
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
      case WIRE.EXPR:
        return this.liftObjectExpr(obj, label);
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

  liftObjectResource(obj, label) {
    const resource = this.exports.vir_obj_resource_externref(obj);
    if (isHostResource(resource)) {
      return resource;
    }
    // Some effect callback paths can expose one IO.ok wrapper around a Js result
    // at the JS lift boundary. Keep this resource-only; ordinary Lean tag-0
    // constructors must continue through their declared value decoders.
    if (this.exports.vir_obj_is_scalar(obj) === 0 && this.exports.vir_obj_tag(obj) === 0) {
      const field = this.exports.vir_obj_field(obj, 0);
      if (field !== 0) {
        try {
          const nested = this.exports.vir_obj_resource_externref(field);
          if (isHostResource(nested)) {
            return nested;
          }
        } finally {
          this.exports.vir_obj_dec(field);
        }
      }
    }
    throw new Error(`${label} did not lift to a live host resource`);
  }

  liftObjectFunction(type, obj, label) {
    const args = requireFunctionArgs(type, label);
    requireFunctionResult(type, label);
    const rootId = this.exports.vir_obj_closure_root(
      obj,
      args.length,
      interfaceEffectRuntimeTag(type.effect),
    );
    if (rootId === 0) {
      throw new Error(`${label} could not be rooted as a Lean callback`);
    }
    return createVirCallback(this, rootId, type);
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
    const plan = objectLayoutPlan(type, fields, label);
    const values = {};
    for (const fieldPlan of plan.fields) {
      const field = fieldPlan.field;
      values[field.name] = this.liftObjectLayoutField(type, obj, fieldPlan, `${label}.${field.name}`);
    }
    return flattenStructureSubobjects(type, values);
  }

  liftObjectTaggedUnionValue(type, obj, label) {
    const tag = this.exports.vir_obj_tag(obj);
    const ctor = taggedUnionConstructorAt(type, tag, label);
    const field = taggedUnionField(ctor);
    const plan = objectLayoutPlan(ctor, [field], label);
    return {
      kind: ctor.jsName,
      value: this.liftObjectLayoutField(ctor, obj, plan.fields[0], `${label}.${ctor.jsName}`, type),
    };
  }

  liftObjectCustomInductiveValue(type, obj, label) {
    const tag = this.exports.vir_obj_tag(obj);
    const ctor = customInductiveConstructorAt(type, tag, label);
    if (ctor.fields.length === 0) {
      return { kind: ctor.jsName };
    }
    const plan = objectLayoutPlan(ctor, ctor.fields, `${label}.${ctor.jsName}`);
    const values = {};
    for (const fieldPlan of plan.fields) {
      const field = fieldPlan.field;
      values[field.name] = this.liftObjectLayoutField(
        ctor,
        obj,
        fieldPlan,
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

  liftObjectLayoutField(owner, obj, fieldPlan, label, selfType = owner) {
    const field = fieldPlan.field;
    switch (fieldPlan.kind) {
      case "object": {
        const fieldObj = this.ownedObjectField(obj, fieldPlan.index, label);
        try {
          return this.liftObjectValue(field.type, fieldObj, label, selfType);
        } finally {
          this.exports.vir_obj_dec(fieldObj);
        }
      }
      case "usize":
        return this.readObjectUSizeField(obj, field.layout.index, label);
      case "scalar":
        return this.readObjectScalarField(owner, obj, field.type, field.layout, label, fieldPlan.offset);
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

  readObjectScalarField(owner, obj, type, layout, label, offset = null) {
    const data = this.exports.vir_obj_ctor_scalar_data(obj, owner.usizeFieldCount);
    if (data === 0) {
      throw new Error(`${label} scalar data is unavailable`);
    }
    return readObjectScalarField(
      new DataView(this.exports.memory.buffer, data, owner.scalarByteSize),
      type,
      layout,
      label,
      offset,
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
    case WIRE.RESOURCE:
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
    case WIRE.EXPR:
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
    case WIRE.RESOURCE:
    case WIRE.FUNCTION:
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
    case WIRE.EXPR:
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
  let plan;
  try {
    plan = objectLayoutPlan(owner, fields, "object layout");
  } catch {
    return false;
  }
  return plan.fields.every((fieldPlan) => objectFieldPlanSupported(fieldPlan, fieldSupported, selfType));
}

function objectFieldPlanSupported(fieldPlan, fieldSupported, selfType) {
  const field = fieldPlan.field;
  switch (fieldPlan.kind) {
    case "object":
      return fieldSupported(field.type, selfType);
    case "usize":
      return field.type?.wireTag === WIRE.USIZE;
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

function objectLayoutSlotsFromPlan(plan) {
  return {
    objectFields: Array(plan.objectFieldCount).fill(0),
    usizeFields: Array(plan.usizeFieldCount).fill(0n),
    scalarBytes: new Uint8Array(plan.scalarByteSize),
  };
}

function objectLayoutPlan(owner, fields, label) {
  const cacheable = owner !== null && (typeof owner === "object" || typeof owner === "function");
  let cachedPlans;
  if (cacheable) {
    cachedPlans = objectLayoutPlanCache.get(owner);
    if (cachedPlans !== undefined) {
      for (const plan of cachedPlans) {
        if (objectLayoutPlanMatches(plan, fields)) {
          return plan;
        }
      }
    }
  }

  const counts = objectRuntimeCounts(owner, label);
  const fieldPlans = [];
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
        fieldPlans.push({ field, kind: "object", index });
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
        fieldPlans.push({ field, kind: "usize", index });
        break;
      }
      case "scalar": {
        const offset = scalarLayoutOffset(field.layout, counts.scalarByteSize, fieldLabel);
        for (let index = field.layout.offset; index < field.layout.offset + field.layout.size; index++) {
          if (seenScalarBytes.has(index)) {
            throw new Error(`${fieldLabel} overlaps scalar byte ${index}`);
          }
          seenScalarBytes.add(index);
        }
        fieldPlans.push({ field, kind: "scalar", offset });
        break;
      }
      default:
        throw new Error(`${fieldLabel} has unsupported object ABI layout`);
    }
  }
  const plan = {
    objectFieldCount: counts.objectFieldCount,
    usizeFieldCount: counts.usizeFieldCount,
    scalarByteSize: counts.scalarByteSize,
    fields: fieldPlans,
  };
  if (!cacheable) {
    return plan;
  }
  if (cachedPlans === undefined) {
    objectLayoutPlanCache.set(owner, [plan]);
  } else {
    cachedPlans.push(plan);
  }
  return plan;
}

function objectLayoutPlanMatches(plan, fields) {
  if (plan.fields.length !== fields.length) {
    return false;
  }
  for (let index = 0; index < fields.length; index++) {
    if (!sameLayoutField(plan.fields[index].field, fields[index])) {
      return false;
    }
  }
  return true;
}

function sameLayoutField(lhs, rhs) {
  return lhs === rhs || (
    lhs?.name === rhs?.name &&
    lhs?.type === rhs?.type &&
    sameLayout(lhs?.layout, rhs?.layout)
  );
}

function sameLayout(lhs, rhs) {
  return lhs === rhs || (
    lhs?.kind === rhs?.kind &&
    lhs?.index === rhs?.index &&
    lhs?.offset === rhs?.offset &&
    lhs?.size === rhs?.size
  );
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

function writeObjectScalarField(bytes, type, layout, value, label, offset = null) {
  offset ??= scalarLayoutOffset(layout, bytes.byteLength, label);
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

function readObjectScalarField(view, type, layout, label, offset = null) {
  offset ??= scalarLayoutOffset(layout, view.byteLength, label);
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

function normalizeBinderInfo(value, label) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3) return value;
  switch (value) {
    case "default":
      return 0;
    case "implicit":
      return 1;
    case "strictImplicit":
      return 2;
    case "instImplicit":
      return 3;
    default:
      throw new Error(`${label} must be default, implicit, strictImplicit, or instImplicit`);
  }
}

function decodeBinderInfo(value) {
  return ["default", "implicit", "strictImplicit", "instImplicit"][value] ?? String(value);
}

function requireString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function isVirCallback(value) {
  return typeof value === "function" && virCallbackStates.has(value);
}

function releaseCallbacks(callbacks) {
  for (const callback of callbacks) {
    callback.release();
  }
  callbacks.length = 0;
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
