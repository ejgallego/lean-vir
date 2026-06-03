/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { validateInterfaceManifest } from "./interface-manifest.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");

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
    const runtimeRef = { runtime: null };
    const defaultHostBindings =
      typeof this.defaultHostBindings === "function"
        ? this.defaultHostBindings(runtimeRef)
        : (this.defaultHostBindings ?? createBrowserHostBindings({ runtimeRef }));
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
    runtimeRef.runtime = runtime;
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
    const { args, resultType } = decodeHostCallRequest(request, entry, this.runtime);
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
    for (const entry of this.interfaceManifest?.exports ?? []) {
      if (entry.jsName && isIdentifier(entry.jsName)) {
        this.exportsByName[entry.jsName] = (...args) => this.call(entry.entry, ...args);
      }
    }
  }

  findManifestEntry(name) {
    const entries = this.interfaceManifest?.exports ?? [];
    return entries.find((entry) => entry.entry === name || entry.id === name || entry.jsName === name) ?? null;
  }

  call(name, ...args) {
    this.requireLiveRuntime();
    this.requireFunction("vir_call");
    this.requireFunction("vir_call_result_size");
    const entry = this.findManifestEntry(name);
    if (entry === null) {
      throw new Error(`interface entry not found: ${name}`);
    }
    if (args.length !== entry.args.length) {
      throw new Error(`${entry.entry} expects ${entry.args.length} arguments, got ${args.length}`);
    }

    const payload = encodeCallPayload(entry, args);
    const nameBytes = textEncoder.encode(entry.entry);
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
      return decodeCallResult(entry.result, this.readWasmBytes(resultPtr, resultLen), this);
    } finally {
      this.freeBytes(payloadPtr);
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
      return decodeCallResult(type.result, this.readWasmBytes(resultPtr, resultLen), this);
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

function disposeHostBindings(bindings) {
  if (bindings === null || bindings === undefined) return;
  const disposer = bindings[VIR_HOST_DISPOSE] ?? bindings.dispose;
  if (typeof disposer === "function") {
    disposer.call(bindings);
  }
}

function asBytes(bytes, label) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new Error(`${label} must be an ArrayBuffer or Uint8Array`);
}

class BinaryWriter {
  constructor() {
    this.bytes = [];
  }

  u8(value) {
    this.bytes.push(value & 0xff);
  }

  u32(value) {
    const normalized = normalizeUint32(value, "u32");
    this.bytes.push(
      normalized & 0xff,
      (normalized >>> 8) & 0xff,
      (normalized >>> 16) & 0xff,
      (normalized >>> 24) & 0xff,
    );
  }

  rawBytes(bytes) {
    for (const byte of bytes) {
      this.u8(byte);
    }
  }

  f64(value) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    this.rawBytes(new Uint8Array(buffer));
  }

  f32(value) {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, true);
    this.rawBytes(new Uint8Array(buffer));
  }

  bytesValue(bytes) {
    const view = asBytes(bytes, "bytes");
    this.u32(view.byteLength);
    this.rawBytes(view);
  }

  string(value) {
    this.bytesValue(textEncoder.encode(value));
  }

  take() {
    return Uint8Array.from(this.bytes);
  }
}

class BinaryReader {
  constructor(bytes) {
    this.bytes = asBytes(bytes, "result bytes");
    this.offset = 0;
  }

  u8() {
    if (this.offset >= this.bytes.byteLength) {
      throw new Error("unexpected end of result payload");
    }
    return this.bytes[this.offset++];
  }

  u32() {
    const b0 = this.u8();
    const b1 = this.u8();
    const b2 = this.u8();
    const b3 = this.u8();
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }

  rawBytes(len) {
    if (len > this.bytes.byteLength - this.offset) {
      throw new Error("result byte length exceeds payload");
    }
    const out = this.bytes.slice(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  f64() {
    const buffer = new ArrayBuffer(8);
    new Uint8Array(buffer).set(this.rawBytes(8));
    return new DataView(buffer).getFloat64(0, true);
  }

  f32() {
    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer).set(this.rawBytes(4));
    return new DataView(buffer).getFloat32(0, true);
  }

  bytesValue() {
    const len = this.u32();
    return this.rawBytes(len);
  }

  string() {
    return textDecoder.decode(this.bytesValue());
  }

  requireEnd() {
    if (this.offset !== this.bytes.byteLength) {
      throw new Error("trailing bytes after result payload");
    }
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

function encodeCallPayload(entry, args) {
  const writer = new BinaryWriter();
  writer.u32(args.length);
  entry.args.forEach((arg, index) => {
    encodeValue(writer, arg.type, args[index], `${entry.entry} argument ${arg.name}`);
  });
  encodeTypeDescriptor(writer, entry.result, `${entry.entry} result`);
  writer.u8(entry.effect === "io" ? 1 : 0);
  return writer.take();
}

function encodeClosureCallPayload(type, args) {
  const fnArgs = requireFunctionArgs(type, "callback");
  if (args.length !== fnArgs.length) {
    throw new Error(`callback expects ${fnArgs.length} arguments, got ${args.length}`);
  }
  const writer = new BinaryWriter();
  writer.u32(args.length);
  fnArgs.forEach((arg, index) => {
    encodeValue(writer, arg.type, args[index], `callback argument ${arg.name}`);
  });
  encodeTypeDescriptor(writer, requireFunctionResult(type, "callback"), "callback result");
  writer.u8(type.effect === "io" ? 1 : 0);
  return writer.take();
}

function encodeValue(writer, type, value, label) {
  encodeTypeDescriptor(writer, type, label);
  encodeValuePayload(writer, type, value, label);
}

export function roundTripInterfaceTypeDescriptor(type, label = "interface type") {
  const writer = new BinaryWriter();
  encodeTypeDescriptor(writer, type, label);
  const reader = new BinaryReader(writer.take());
  const decoded = decodeTypeDescriptor(reader);
  reader.requireEnd();
  return decoded;
}

export function sameInterfaceWireType(expected, actual) {
  return sameWireType(expected, actual);
}

function encodeTypeDescriptor(writer, type, label) {
  const tag = requireWireTag(type, label);
  writer.u8(tag);
  switch (tag) {
    case 16:
    case 17:
    case 18:
      encodeTypeDescriptor(writer, requireTypeField(type, "element", label), `${label}.element`);
      return;
    case 19:
      encodeTypeDescriptor(writer, requireTypeField(type, "fst", label), `${label}.fst`);
      encodeTypeDescriptor(writer, requireTypeField(type, "snd", label), `${label}.snd`);
      return;
    case 20: {
      const fields = requireStructureFields(type, label);
      writer.u32(requireStructureCount(type, "objectFieldCount", label));
      writer.u32(requireStructureCount(type, "usizeFieldCount", label));
      writer.u32(requireStructureCount(type, "scalarByteSize", label));
      writer.u32(requireStructureTrivialFieldIndex(type, label));
      writer.u32(fields.length);
      fields.forEach((field) => {
        encodeStructureFieldLayout(writer, field.layout, `${label}.${field.name}`);
        encodeTypeDescriptor(writer, field.type, `${label}.${field.name}`);
      });
      return;
    }
    case 21: {
      const constructors = requireTaggedUnionConstructors(type, label);
      writer.u32(constructors.length);
      constructors.forEach((ctor) => {
        writer.u32(requireStructureCount(ctor, "objectFieldCount", `${label}.${ctor.jsName}`));
        writer.u32(requireStructureCount(ctor, "usizeFieldCount", `${label}.${ctor.jsName}`));
        writer.u32(requireStructureCount(ctor, "scalarByteSize", `${label}.${ctor.jsName}`));
        encodeStructureFieldLayout(writer, ctor.layout, `${label}.${ctor.jsName}`);
        encodeTypeDescriptor(writer, ctor.type, `${label}.${ctor.jsName}`);
      });
      return;
    }
    case 24: {
      const args = requireFunctionArgs(type, label);
      writer.u8(type.effect === "io" ? 1 : 0);
      writer.u32(args.length);
      args.forEach((arg, index) => encodeTypeDescriptor(writer, arg.type, `${label}.args[${index}]`));
      encodeTypeDescriptor(writer, requireFunctionResult(type, label), `${label}.result`);
      return;
    }
    default:
      return;
  }
}

function decodeTypeDescriptor(reader) {
  const tag = reader.u8();
  switch (tag) {
    case 16:
      return { wireTag: tag, element: decodeTypeDescriptor(reader) };
    case 17:
      return { wireTag: tag, element: decodeTypeDescriptor(reader) };
    case 18:
      return { wireTag: tag, element: decodeTypeDescriptor(reader) };
    case 19:
      return { wireTag: tag, fst: decodeTypeDescriptor(reader), snd: decodeTypeDescriptor(reader) };
    case 20: {
      const objectFieldCount = reader.u32();
      const usizeFieldCount = reader.u32();
      const scalarByteSize = reader.u32();
      const trivialFieldIndex = decodeStructureTrivialFieldIndex(reader.u32());
      const len = reader.u32();
      return {
        wireTag: tag,
        objectFieldCount,
        usizeFieldCount,
        scalarByteSize,
        ...(trivialFieldIndex === null ? {} : { trivialFieldIndex }),
        fields: Array.from({ length: len }, () => ({
          layout: decodeStructureFieldLayout(reader),
          type: decodeTypeDescriptor(reader),
        })),
      };
    }
    case 21: {
      const len = reader.u32();
      return {
        wireTag: tag,
        constructors: Array.from({ length: len }, () => ({
          objectFieldCount: reader.u32(),
          usizeFieldCount: reader.u32(),
          scalarByteSize: reader.u32(),
          layout: decodeStructureFieldLayout(reader),
          type: decodeTypeDescriptor(reader),
        })),
      };
    }
    case 24: {
      const effect = reader.u8() === 0 ? "pure" : "io";
      const len = reader.u32();
      return {
        wireTag: tag,
        effect,
        args: Array.from({ length: len }, (_, index) => ({
          name: `arg${index + 1}`,
          type: decodeTypeDescriptor(reader),
        })),
        result: decodeTypeDescriptor(reader),
      };
    }
    default:
      return { wireTag: tag };
  }
}

function encodeValuePayload(writer, type, value, label) {
  const tag = requireWireTag(type, label);
  switch (tag) {
    case 22:
      if (value !== undefined && value !== null) throw new Error(`${label} must be undefined or null`);
      return;
    case 23:
      writer.u32(normalizeResourceHandle(value, label));
      return;
    case 24:
      throw new Error(`${label} cannot be a JavaScript function in v1`);
    case 0:
      writer.string(normalizeDecimal(value, label, { signed: false }));
      return;
    case 1:
      writer.string(normalizeDecimal(value, label, { signed: true }));
      return;
    case 2:
      if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
      writer.u8(value ? 1 : 0);
      return;
    case 3:
      if (typeof value !== "string") throw new Error(`${label} must be a string`);
      writer.string(value);
      return;
    case 4:
      writer.u8(normalizeInteger(value, label, 0, 0xff));
      return;
    case 5:
      writer.u32(normalizeInteger(value, label, 0, 0xffff));
      return;
    case 6:
      writer.u32(normalizeUint32(value, label));
      return;
    case 7:
    case 8:
      writer.string(normalizeDecimal(value, label, { signed: false }));
      return;
    case 9:
      writer.bytesValue(asByteArrayBytes(value));
      return;
    case 10:
      writer.f64(normalizeFloat(value, label));
      return;
    case 11:
      writer.f32(normalizeFloat(value, label));
      return;
    case 14:
      writer.u32(normalizeEnum(value, type, label));
      return;
    case 15:
      encodeExpr(writer, value, label);
      return;
    case 16: {
      const values = normalizeArray(value, label);
      writer.u32(values.length);
      const elementType = requireTypeField(type, "element", label);
      values.forEach((item, itemIndex) => encodeValuePayload(writer, elementType, item, `${label}[${itemIndex}]`));
      return;
    }
    case 17: {
      const values = normalizeArray(value, label);
      writer.u32(values.length);
      const elementType = requireTypeField(type, "element", label);
      values.forEach((item, itemIndex) => encodeValuePayload(writer, elementType, item, `${label}[${itemIndex}]`));
      return;
    }
    case 18: {
      const option = normalizeOption(value, label);
      writer.u8(option.some ? 1 : 0);
      if (option.some) {
        encodeValuePayload(writer, requireTypeField(type, "element", label), option.value, `${label}.value`);
      }
      return;
    }
    case 19: {
      const pair = normalizePair(value, label);
      encodeValuePayload(writer, requireTypeField(type, "fst", label), pair.fst, `${label}.fst`);
      encodeValuePayload(writer, requireTypeField(type, "snd", label), pair.snd, `${label}.snd`);
      return;
    }
    case 20: {
      const fields = requireStructureFields(type, label);
      const record = normalizeStructure(value, fields, label);
      fields.forEach((field) =>
        encodeValuePayload(writer, field.type, record[field.name], `${label}.${field.name}`));
      return;
    }
    case 21: {
      const { index, ctor, payload } = normalizeTaggedUnion(value, type, label);
      writer.u32(index);
      encodeValuePayload(writer, ctor.type, payload, `${label}.${ctor.jsName}`);
      return;
    }
    default:
      throw new Error(`${label} has unsupported wire tag ${tag}`);
  }
}

function decodeCallResult(type, bytes, runtime = null) {
  const reader = new BinaryReader(bytes);
  const actualType = decodeTypeDescriptor(reader);
  if (!sameWireType(type, actualType)) {
    throw new Error(`result wire type mismatch: expected ${type.type ?? requireWireTag(type, "result")}, got tag ${actualType.wireTag}`);
  }
  const value = decodeValuePayload(reader, type, runtime);
  reader.requireEnd();
  return value;
}

function decodeHostCallRequest(bytes, entry, runtime = null) {
  const reader = new BinaryReader(bytes);
  const argc = reader.u32();
  if (argc !== entry.args.length) {
    throw new Error(`Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argc}`);
  }
  const args = entry.args.map((arg, index) => {
    const actualType = decodeTypeDescriptor(reader);
    if (!sameWireType(arg.type, actualType)) {
      throw new Error(`Vir host import ${entry.target} argument ${arg.name ?? index} type mismatch`);
    }
    return decodeValuePayload(reader, arg.type, runtime);
  });
  const actualResult = decodeTypeDescriptor(reader);
  if (!sameWireType(entry.result, actualResult)) {
    throw new Error(`Vir host import ${entry.target} result type mismatch`);
  }
  reader.requireEnd();
  return { args, resultType: entry.result };
}

function encodeHostCallResult(type, value, entry) {
  const writer = new BinaryWriter();
  encodeTypeDescriptor(writer, type, `${entry.target} result`);
  encodeValuePayload(writer, type, value, `${entry.target} result`);
  return writer.take();
}

function decodeValuePayload(reader, type, runtime = null) {
  const expectedTag = requireWireTag(type, "result");
  let value;
  switch (expectedTag) {
    case 22:
      value = undefined;
      break;
    case 23:
      value = { handle: reader.u32() };
      break;
    case 24:
      if (runtime === null) {
        throw new Error("function value decoded without an attached VirRuntime");
      }
      value = createVirCallback(runtime, reader.u32(), type);
      break;
    case 0:
    case 1:
    case 7:
    case 8:
      value = reader.string();
      break;
    case 2:
      value = reader.u8() !== 0;
      break;
    case 3:
      value = reader.string();
      break;
    case 4:
      value = reader.u8();
      break;
    case 5:
    case 6:
      value = reader.u32();
      break;
    case 9:
      value = reader.bytesValue();
      break;
    case 10:
      value = reader.f64();
      break;
    case 11:
      value = reader.f32();
      break;
    case 14:
      value = enumValue(type, reader.u32());
      break;
    case 15:
      value = decodeExpr(reader);
      break;
    case 16: {
      const len = reader.u32();
      const elementType = requireTypeField(type, "element", "result");
      value = Array.from({ length: len }, () => decodeValuePayload(reader, elementType, runtime));
      break;
    }
    case 17: {
      const len = reader.u32();
      const elementType = requireTypeField(type, "element", "result");
      value = Array.from({ length: len }, () => decodeValuePayload(reader, elementType, runtime));
      break;
    }
    case 18:
      value = reader.u8() === 0 ? null : decodeValuePayload(reader, requireTypeField(type, "element", "result"), runtime);
      break;
    case 19:
      value = {
        fst: decodeValuePayload(reader, requireTypeField(type, "fst", "result"), runtime),
        snd: decodeValuePayload(reader, requireTypeField(type, "snd", "result"), runtime),
      };
      break;
    case 20: {
      value = {};
      for (const field of requireStructureFields(type, "result")) {
        value[field.name] = decodeValuePayload(reader, field.type, runtime);
      }
      value = flattenStructureSubobjects(type, value);
      break;
    }
    case 21: {
      const index = reader.u32();
      const ctor = taggedUnionConstructorAt(type, index, "result");
      value = {
        kind: ctor.jsName,
        value: decodeValuePayload(reader, ctor.type, runtime),
      };
      break;
    }
    default:
      throw new Error(`unsupported result wire tag ${expectedTag}`);
  }
  return value;
}

function requireWireTag(type, label) {
  if (!Number.isInteger(type?.wireTag)) {
    throw new Error(`${label} is missing a manifest wireTag`);
  }
  return type.wireTag;
}

function requireTypeField(type, field, label) {
  const child = type?.[field];
  if (!child || !Number.isInteger(child.wireTag)) {
    throw new Error(`${label} is missing manifest type field ${field}`);
  }
  return child;
}

function requireStructureCount(type, field, label) {
  const value = type?.[field];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} has invalid manifest structure ${field}`);
  }
  return value;
}

function requireStructureTrivialFieldIndex(type, label) {
  const value = type?.trivialFieldIndex;
  const fields = requireStructureFields(type, label);
  return normalizeStructureTrivialFieldIndex(value, fields.length, label);
}

function normalizeStructureTrivialFieldIndex(value, fieldCount, label) {
  if (value === undefined || value === null) {
    return 0xffffffff;
  }
  if (!Number.isInteger(value) || value < 0 || value >= fieldCount) {
    throw new Error(`${label} has invalid manifest structure trivialFieldIndex`);
  }
  return value;
}

function decodeStructureTrivialFieldIndex(value) {
  return value === 0xffffffff ? null : value;
}

function encodeStructureFieldLayout(writer, layout, label) {
  const checked = requireStructureFieldLayout(layout, label);
  writer.u8(checked.tag);
  writer.u32(checked.index ?? 0);
  writer.u32(checked.size ?? 0);
  writer.u32(checked.offset ?? 0);
}

function decodeStructureFieldLayout(reader) {
  const tag = reader.u8();
  const index = reader.u32();
  const size = reader.u32();
  const offset = reader.u32();
  switch (tag) {
    case 0:
      return { kind: "object", index };
    case 1:
      return { kind: "usize", index };
    case 2:
      return { kind: "scalar", size, offset };
    default:
      throw new Error(`unsupported result structure field layout tag ${tag}`);
  }
}

function requireStructureFieldLayout(layout, label) {
  if (layout?.kind === "object" && Number.isInteger(layout.index) && layout.index >= 0) {
    return { tag: 0, index: layout.index };
  }
  if (layout?.kind === "usize" && Number.isInteger(layout.index) && layout.index >= 0) {
    return { tag: 1, index: layout.index };
  }
  if (layout?.kind === "scalar" &&
      Number.isInteger(layout.size) && layout.size > 0 &&
      Number.isInteger(layout.offset) && layout.offset >= 0) {
    return { tag: 2, size: layout.size, offset: layout.offset };
  }
  throw new Error(`${label} has an invalid manifest structure field layout`);
}

function requireStructureFields(type, label) {
  if (!Array.isArray(type?.fields)) {
    throw new Error(`${label} is missing manifest structure fields`);
  }
  for (const field of type.fields) {
    if (typeof field?.name !== "string" || !field.type || !Number.isInteger(field.type.wireTag)) {
      throw new Error(`${label} has an invalid manifest structure field`);
    }
    requireStructureFieldLayout(field.layout, `${label}.${field.name}`);
  }
  return type.fields;
}

function sameWireType(expected, actual) {
  if (requireWireTag(expected, "expected result") !== actual?.wireTag) return false;
  switch (expected.wireTag) {
    case 16:
    case 17:
    case 18:
      return sameWireType(requireTypeField(expected, "element", "expected result"), actual.element);
    case 19:
      return sameWireType(requireTypeField(expected, "fst", "expected result"), actual.fst) &&
        sameWireType(requireTypeField(expected, "snd", "expected result"), actual.snd);
    case 20: {
      const fields = requireStructureFields(expected, "expected result");
      if (!Array.isArray(actual?.fields) || fields.length !== actual.fields.length) return false;
      if (requireStructureCount(expected, "objectFieldCount", "expected result") !== actual?.objectFieldCount ||
          requireStructureCount(expected, "usizeFieldCount", "expected result") !== actual?.usizeFieldCount ||
          requireStructureCount(expected, "scalarByteSize", "expected result") !== actual?.scalarByteSize ||
          requireStructureTrivialFieldIndex(expected, "expected result") !==
            normalizeStructureTrivialFieldIndex(actual?.trivialFieldIndex, actual.fields.length, "actual result")) {
        return false;
      }
      return fields.every((field, index) =>
        sameStructureFieldLayout(field.layout, actual.fields[index]?.layout) &&
        sameWireType(field.type, actual.fields[index]?.type));
    }
    case 21: {
      const constructors = requireTaggedUnionConstructors(expected, "expected result");
      if (!Array.isArray(actual?.constructors) || constructors.length !== actual.constructors.length) return false;
      return constructors.every((ctor, index) => {
        const actualCtor = actual.constructors[index];
        return requireStructureCount(ctor, "objectFieldCount", "expected result") === actualCtor?.objectFieldCount &&
          requireStructureCount(ctor, "usizeFieldCount", "expected result") === actualCtor?.usizeFieldCount &&
          requireStructureCount(ctor, "scalarByteSize", "expected result") === actualCtor?.scalarByteSize &&
          sameStructureFieldLayout(ctor.layout, actualCtor?.layout) &&
          sameWireType(ctor.type, actualCtor?.type);
      });
    }
    case 24: {
      const args = requireFunctionArgs(expected, "expected result");
      if (expected.effect !== actual?.effect || !Array.isArray(actual?.args) || args.length !== actual.args.length) {
        return false;
      }
      return args.every((arg, index) => sameWireType(arg.type, actual.args[index]?.type)) &&
        sameWireType(requireFunctionResult(expected, "expected result"), actual.result);
    }
    default:
      return true;
  }
}

function sameStructureFieldLayout(expected, actual) {
  const lhs = requireStructureFieldLayout(expected, "expected result field");
  const rhs = requireStructureFieldLayout(actual, "actual result field");
  return lhs.tag === rhs.tag &&
    (lhs.index ?? 0) === (rhs.index ?? 0) &&
    (lhs.size ?? 0) === (rhs.size ?? 0) &&
    (lhs.offset ?? 0) === (rhs.offset ?? 0);
}

function normalizeDecimal(value, label, { signed }) {
  if (typeof value === "bigint") {
    if (!signed && value < 0n) throw new Error(`${label} must be non-negative`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer or decimal string`);
    if (!signed && value < 0) throw new Error(`${label} must be non-negative`);
    return String(value);
  }
  if (typeof value === "string") {
    const pattern = signed ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(value.trim())) throw new Error(`${label} must be a decimal string`);
    return value.trim();
  }
  throw new Error(`${label} must be an integer, BigInt, or decimal string`);
}

function normalizeFloat(value, label) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`${label} must be a number`);
    }
    if (/^[+-]?nan$/i.test(trimmed)) {
      return Number.NaN;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error(`${label} must be a number`);
    }
    return parsed;
  }
  throw new Error(`${label} must be a number`);
}

function normalizeInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

function normalizeResourceHandle(value, label) {
  const handle = typeof value === "number" ? value : value?.handle;
  if (!Number.isInteger(handle) || handle <= 0 || handle > 0xffffffff) {
    throw new Error(`${label} must be a live resource handle`);
  }
  return handle;
}

function normalizeArray(value, label) {
  if (value == null || typeof value[Symbol.iterator] !== "function") {
    throw new Error(`${label} must be iterable`);
  }
  return Array.from(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeOption(value, label) {
  if (value == null) return { some: false, value: null };
  if (typeof value === "object") {
    if (value.kind === "none") return { some: false, value: null };
    if (value.kind === "some") return { some: true, value: value.value };
    if (hasOwn(value, "some")) return { some: true, value: value.some };
  }
  return { some: true, value };
}

function normalizePair(value, label) {
  if (Array.isArray(value)) {
    if (value.length !== 2) throw new Error(`${label} pair array must have exactly two elements`);
    return { fst: value[0], snd: value[1] };
  }
  if (value !== null && typeof value === "object") {
    if (hasOwn(value, "fst") && hasOwn(value, "snd")) {
      return { fst: value.fst, snd: value.snd };
    }
    if (hasOwn(value, "first") && hasOwn(value, "second")) {
      return { fst: value.first, snd: value.second };
    }
  }
  throw new Error(`${label} must be a pair { fst, snd } or a two-element array`);
}

function normalizeStructure(value, fields, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const normalized = {};
  for (const field of fields) {
    if (hasOwn(value, field.name)) {
      if (field.subobject === true && flattenedSubobjectFieldsPresent(value, field.type)) {
        throw new Error(`${label} mixes ${field.name} with flattened inherited fields`);
      }
      normalized[field.name] = value[field.name];
    } else if (field.subobject === true) {
      normalized[field.name] = normalizeStructure(
        value,
        requireStructureFields(field.type, `${label}.${field.name}`),
        `${label}.${field.name}`,
      );
    } else {
      throw new Error(`${label} is missing field ${field.name}`);
    }
  }
  return normalized;
}

function flattenStructureSubobjects(type, value) {
  const fields = requireStructureFields(type, "result");
  const flattened = {};
  for (const field of fields) {
    if (field.subobject === true) {
      const subobject = value[field.name];
      if (subobject === null || typeof subobject !== "object" || Array.isArray(subobject)) {
        throw new Error(`result.${field.name} subobject must decode to an object`);
      }
      Object.assign(flattened, subobject);
    } else {
      flattened[field.name] = value[field.name];
    }
  }
  return flattened;
}

function flattenedSubobjectFieldsPresent(value, type) {
  for (const field of requireStructureFields(type, "subobject")) {
    if (field.subobject === true) {
      if (flattenedSubobjectFieldsPresent(value, field.type)) return true;
    } else if (hasOwn(value, field.name)) {
      return true;
    }
  }
  return false;
}

function requireTaggedUnionConstructors(type, label) {
  if (!Array.isArray(type?.constructors) || type.constructors.length === 0) {
    throw new Error(`${label} is missing manifest tagged-union constructors`);
  }
  for (const ctor of type.constructors) {
    if (typeof ctor?.name !== "string" ||
        typeof ctor?.jsName !== "string" ||
        !ctor.type ||
        !Number.isInteger(ctor.type.wireTag)) {
      throw new Error(`${label} has an invalid manifest tagged-union constructor`);
    }
    requireStructureCount(ctor, "objectFieldCount", `${label}.${ctor.jsName}`);
    requireStructureCount(ctor, "usizeFieldCount", `${label}.${ctor.jsName}`);
    requireStructureCount(ctor, "scalarByteSize", `${label}.${ctor.jsName}`);
    requireStructureFieldLayout(ctor.layout, `${label}.${ctor.jsName}`);
  }
  return type.constructors;
}

function requireFunctionArgs(type, label) {
  if (type?.effect !== "pure" && type?.effect !== "io") {
    throw new Error(`${label} has invalid manifest function effect`);
  }
  if (!Array.isArray(type?.args)) {
    throw new Error(`${label} is missing manifest function args`);
  }
  for (const arg of type.args) {
    if (typeof arg?.name !== "string" || !arg.type || !Number.isInteger(arg.type.wireTag)) {
      throw new Error(`${label} has an invalid manifest function argument`);
    }
  }
  return type.args;
}

function requireFunctionResult(type, label) {
  const result = type?.result;
  if (!result || !Number.isInteger(result.wireTag)) {
    throw new Error(`${label} is missing manifest function result`);
  }
  return result;
}

function taggedUnionConstructorAt(type, index, label) {
  const constructors = requireTaggedUnionConstructors(type, label);
  if (!Number.isInteger(index) || index < 0 || index >= constructors.length) {
    throw new Error(`${label} tagged-union constructor index is out of range`);
  }
  return constructors[index];
}

function findTaggedUnionConstructor(type, text) {
  const constructors = requireTaggedUnionConstructors(type, "tagged union");
  const index = constructors.findIndex((ctor) => ctor.name === text || ctor.jsName === text);
  return index < 0 ? null : { index, ctor: constructors[index] };
}

function normalizeTaggedUnion(value, type, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a tagged-union object`);
  }
  if (hasOwn(value, "tag")) {
    const ctor = taggedUnionConstructorAt(type, value.tag, label);
    if (!hasOwn(value, "value")) {
      throw new Error(`${label}.${ctor.jsName} is missing value`);
    }
    return { index: value.tag, ctor, payload: value.value };
  }
  const text =
    typeof value.kind === "string" ? value.kind :
    typeof value.name === "string" ? value.name :
    typeof value.jsName === "string" ? value.jsName :
    hasOwn(value, "constructor") && typeof value.constructor === "string" ? value.constructor :
    null;
  if (text !== null) {
    const match = findTaggedUnionConstructor(type, text);
    if (match === null) {
      throw new Error(`${label} has unknown tagged-union constructor ${text}`);
    }
    if (!hasOwn(value, "value")) {
      throw new Error(`${label}.${match.ctor.jsName} is missing value`);
    }
    return { ...match, payload: value.value };
  }
  for (const [index, ctor] of requireTaggedUnionConstructors(type, label).entries()) {
    if (hasOwn(value, ctor.jsName)) return { index, ctor, payload: value[ctor.jsName] };
    if (hasOwn(value, ctor.name)) return { index, ctor, payload: value[ctor.name] };
  }
  throw new Error(`${label} must specify a tagged-union constructor`);
}

function normalizeEnum(value, type, label) {
  const constructors = type?.constructors ?? [];
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value < constructors.length) return value;
    throw new Error(`${label} enum index is out of range`);
  }
  const text =
    typeof value === "string" ? value :
    typeof value === "object" && value !== null ? value.name ?? value.jsName ?? value.constructor : null;
  if (typeof text !== "string") {
    throw new Error(`${label} must be an enum constructor name or index`);
  }
  const index = constructors.findIndex((ctor) => ctor.name === text || ctor.jsName === text);
  if (index < 0) {
    throw new Error(`${label} has unknown enum constructor ${text}`);
  }
  return index;
}

function enumValue(type, index) {
  const ctor = type?.constructors?.[index];
  if (ctor === undefined) {
    throw new Error(`result enum index ${index} is out of range`);
  }
  return ctor.jsName ?? ctor.name ?? String(index);
}

function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
}

function encodeLevel(writer, value, label) {
  const level = typeof value === "string" ? { kind: value } : value ?? { kind: "zero" };
  switch (level.kind) {
    case "zero":
      writer.u8(0);
      return;
    case "succ":
      writer.u8(1);
      encodeLevel(writer, level.of ?? level.level, `${label}.of`);
      return;
    case "max":
      writer.u8(2);
      encodeLevel(writer, level.left ?? level.lhs, `${label}.left`);
      encodeLevel(writer, level.right ?? level.rhs, `${label}.right`);
      return;
    case "imax":
      writer.u8(3);
      encodeLevel(writer, level.left ?? level.lhs, `${label}.left`);
      encodeLevel(writer, level.right ?? level.rhs, `${label}.right`);
      return;
    case "param":
      writer.u8(4);
      writer.string(requireString(level.name, `${label}.name`));
      return;
    case "mvar":
      writer.u8(5);
      writer.string(requireString(level.name, `${label}.name`));
      return;
    default:
      throw new Error(`${label} has unsupported Lean.Level kind ${level.kind}`);
  }
}

function decodeLevel(reader) {
  const kind = reader.u8();
  switch (kind) {
    case 0:
      return { kind: "zero" };
    case 1:
      return { kind: "succ", of: decodeLevel(reader) };
    case 2:
      return { kind: "max", left: decodeLevel(reader), right: decodeLevel(reader) };
    case 3:
      return { kind: "imax", left: decodeLevel(reader), right: decodeLevel(reader) };
    case 4:
      return { kind: "param", name: reader.string() };
    case 5:
      return { kind: "mvar", name: reader.string() };
    default:
      throw new Error(`unsupported Lean.Level result kind ${kind}`);
  }
}

function encodeLevels(writer, levels, label) {
  const values = levels == null ? [] : normalizeArray(levels, label);
  writer.u32(values.length);
  values.forEach((level, index) => encodeLevel(writer, level, `${label}[${index}]`));
}

function decodeLevels(reader) {
  const len = reader.u32();
  return Array.from({ length: len }, () => decodeLevel(reader));
}

function encodeLiteral(writer, value, label) {
  const literal = typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? { kind: typeof value === "string" ? "string" : "nat", value }
    : value;
  switch (literal?.kind) {
    case "nat":
      writer.u8(0);
      writer.string(normalizeDecimal(literal.value, `${label}.value`, { signed: false }));
      return;
    case "string":
      writer.u8(1);
      writer.string(requireString(literal.value, `${label}.value`));
      return;
    default:
      throw new Error(`${label} has unsupported Lean.Literal kind ${literal?.kind}`);
  }
}

function decodeLiteral(reader) {
  const kind = reader.u8();
  switch (kind) {
    case 0:
      return { kind: "nat", value: reader.string() };
    case 1:
      return { kind: "string", value: reader.string() };
    default:
      throw new Error(`unsupported Lean.Literal result kind ${kind}`);
  }
}

function encodeExpr(writer, value, label) {
  if (typeof value === "string") {
    value = { kind: "const", name: value, levels: [] };
  }
  switch (value?.kind) {
    case "bvar":
      writer.u8(0);
      writer.string(normalizeDecimal(value.index ?? value.deBruijnIndex, `${label}.index`, { signed: false }));
      return;
    case "fvar":
      writer.u8(1);
      writer.string(requireString(value.name, `${label}.name`));
      return;
    case "mvar":
      writer.u8(2);
      writer.string(requireString(value.name, `${label}.name`));
      return;
    case "sort":
      writer.u8(3);
      encodeLevel(writer, value.level ?? value.u, `${label}.level`);
      return;
    case "const":
      writer.u8(4);
      writer.string(requireString(value.name, `${label}.name`));
      encodeLevels(writer, value.levels ?? [], `${label}.levels`);
      return;
    case "app":
      writer.u8(5);
      encodeExpr(writer, value.fn, `${label}.fn`);
      encodeExpr(writer, value.arg, `${label}.arg`);
      return;
    case "lam":
    case "lambda":
      writer.u8(6);
      writer.string(requireString(value.name ?? value.binderName, `${label}.name`));
      encodeExpr(writer, value.type ?? value.binderType, `${label}.type`);
      encodeExpr(writer, value.body, `${label}.body`);
      writer.u8(normalizeBinderInfo(value.binderInfo ?? "default", `${label}.binderInfo`));
      return;
    case "forall":
    case "forallE":
      writer.u8(7);
      writer.string(requireString(value.name ?? value.binderName, `${label}.name`));
      encodeExpr(writer, value.type ?? value.binderType, `${label}.type`);
      encodeExpr(writer, value.body, `${label}.body`);
      writer.u8(normalizeBinderInfo(value.binderInfo ?? "default", `${label}.binderInfo`));
      return;
    case "let":
    case "letE":
      writer.u8(8);
      writer.string(requireString(value.name ?? value.declName, `${label}.name`));
      encodeExpr(writer, value.type, `${label}.type`);
      encodeExpr(writer, value.value, `${label}.value`);
      encodeExpr(writer, value.body, `${label}.body`);
      writer.u8(value.nondep ? 1 : 0);
      return;
    case "lit":
      writer.u8(9);
      encodeLiteral(writer, value.literal ?? value.value, `${label}.literal`);
      return;
    case "mdata":
      writer.u8(10);
      encodeExpr(writer, value.expr, `${label}.expr`);
      return;
    case "proj":
      writer.u8(11);
      writer.string(requireString(value.typeName, `${label}.typeName`));
      writer.string(normalizeDecimal(value.index ?? value.idx, `${label}.index`, { signed: false }));
      encodeExpr(writer, value.struct ?? value.expr, `${label}.struct`);
      return;
    default:
      throw new Error(`${label} has unsupported Lean.Expr kind ${value?.kind}`);
  }
}

function decodeExpr(reader) {
  const kind = reader.u8();
  switch (kind) {
    case 0:
      return { kind: "bvar", index: reader.string() };
    case 1:
      return { kind: "fvar", name: reader.string() };
    case 2:
      return { kind: "mvar", name: reader.string() };
    case 3:
      return { kind: "sort", level: decodeLevel(reader) };
    case 4:
      return { kind: "const", name: reader.string(), levels: decodeLevels(reader) };
    case 5:
      return { kind: "app", fn: decodeExpr(reader), arg: decodeExpr(reader) };
    case 6:
      return { kind: "lam", name: reader.string(), type: decodeExpr(reader), body: decodeExpr(reader), binderInfo: decodeBinderInfo(reader.u8()) };
    case 7:
      return { kind: "forall", name: reader.string(), type: decodeExpr(reader), body: decodeExpr(reader), binderInfo: decodeBinderInfo(reader.u8()) };
    case 8:
      return { kind: "let", name: reader.string(), type: decodeExpr(reader), value: decodeExpr(reader), body: decodeExpr(reader), nondep: reader.u8() !== 0 };
    case 9:
      return { kind: "lit", literal: decodeLiteral(reader) };
    case 10:
      return { kind: "mdata", expr: decodeExpr(reader) };
    case 11:
      return { kind: "proj", typeName: reader.string(), index: reader.string(), struct: decodeExpr(reader) };
    default:
      throw new Error(`unsupported Lean.Expr result kind ${kind}`);
  }
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

function asByteArrayBytes(values) {
  if (values instanceof Uint8Array || values instanceof ArrayBuffer || ArrayBuffer.isView(values)) {
    return asBytes(values, "byte array values");
  }
  if (values == null || typeof values[Symbol.iterator] !== "function") {
    throw new Error("byte array values must be iterable or an ArrayBuffer view");
  }
  return Uint8Array.from(values, (value) => normalizeByte(value));
}

function normalizeByte(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error("byte array values must be integers in 0..255");
  }
  return value;
}
