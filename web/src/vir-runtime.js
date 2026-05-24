/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function fetchBytes(path, init = { cache: "no-store" }) {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function createVirImports(module, overrides = {}) {
  const imports = {};

  for (const spec of WebAssembly.Module.imports(module)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
          throw new Error(`WASI proc_exit(${args[0]})`);
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
  } = {}) {
    this.wasmBytes = wasmBytes;
    this.wasmModule = wasmModule;
    this.wasmUrl = wasmUrl;
    this.fetchBytes = loadBytes;
    this.imports = imports;
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
    const imports =
      typeof this.imports === "function"
        ? this.imports(module)
        : this.imports ?? createVirImports(module);
    const instance = await WebAssembly.instantiate(module, imports);
    instance.exports.__wasm_call_ctors?.();
    return new VirRuntime(instance.exports, { module });
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

export class VirRuntime {
  constructor(exports, { module = null, packageInfo = null } = {}) {
    this.exports = exports;
    this.module = module;
    this.packageInfo = packageInfo;
    this.interfaceManifest = null;
    this.exportsByName = Object.create(null);

    if (!this.exports.memory) {
      throw new Error("WASM memory export is missing");
    }
    if (typeof this.exports.vir_package_interface_manifest_size === "function" &&
        this.exports.vir_package_interface_manifest_size() !== 0) {
      this.interfaceManifest = this.readPackageManifest();
      this.rebuildManifestExports();
    }
  }

  targetPointerBytes() {
    return this.exports.vir_upstream_target_pointer_bytes?.() ?? null;
  }

  lastPackageError() {
    const len = this.exports.vir_last_package_error_size?.() ?? 0;
    return len === 0 ? "" : this.readWasmString(this.exports.vir_last_package_error(), len);
  }

  loadIrPackageBytes(bytes) {
    this.requireFunction("vir_alloc_bytes");
    this.requireFunction("vir_load_ir_package");

    const packageBytes = asBytes(bytes, "IR package bytes");
    const ptr = this.allocBytes(packageBytes);
    try {
      const count = this.exports.vir_load_ir_package(ptr, packageBytes.byteLength);
      if (count === 0) {
        const detail = this.lastPackageError();
        throw new Error(`IR package load failed${detail ? `: ${detail}` : ""}`);
      }
      this.interfaceManifest = this.readPackageManifest();
      this.rebuildManifestExports();
      this.packageInfo = {
        count,
        byteLength: packageBytes.byteLength,
        interfaceExports: this.interfaceManifest.exports.length,
      };
      return this.packageInfo;
    } finally {
      this.freeBytes(ptr);
    }
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
    if (manifest?.version !== 1 || !Array.isArray(manifest.exports)) {
      throw new Error("embedded interface manifest must be { version: 1, exports: [...] }");
    }
    return manifest;
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
      return decodeCallResult(entry.result, this.readWasmBytes(resultPtr, resultLen));
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

  bytesValue(bytes) {
    const view = asBytes(bytes, "bytes");
    this.u32(view.byteLength);
    for (const byte of view) {
      this.u8(byte);
    }
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

  bytesValue() {
    const len = this.u32();
    if (len > this.bytes.byteLength - this.offset) {
      throw new Error("result byte length exceeds payload");
    }
    const out = this.bytes.slice(this.offset, this.offset + len);
    this.offset += len;
    return out;
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

function encodeCallPayload(entry, args) {
  const writer = new BinaryWriter();
  writer.u32(args.length);
  entry.args.forEach((arg, index) => {
    encodeValue(writer, arg.type, args[index], `${entry.entry} argument ${arg.name}`);
  });
  return writer.take();
}

function encodeValue(writer, type, value, label) {
  const tag = requireWireTag(type, label);
  writer.u8(tag);
  switch (tag) {
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
    case 12: {
      const values = normalizeArray(value, label);
      writer.u32(values.length);
      values.forEach((item, itemIndex) => {
        writer.string(normalizeDecimal(item, `${label}[${itemIndex}]`, { signed: false }));
      });
      return;
    }
    case 11: {
      const values = normalizeArray(value, label);
      writer.u32(values.length);
      values.forEach((item, itemIndex) => writer.u32(normalizeUint32(item, `${label}[${itemIndex}]`)));
      return;
    }
    case 13: {
      const values = normalizeArray(value, label);
      writer.u32(values.length);
      values.forEach((item, itemIndex) => {
        if (typeof item !== "string") throw new Error(`${label}[${itemIndex}] must be a string`);
        writer.string(item);
      });
      return;
    }
    default:
      throw new Error(`${label} has unsupported wire tag ${tag}`);
  }
}

function decodeCallResult(type, bytes) {
  const expectedTag = requireWireTag(type, "result");
  const reader = new BinaryReader(bytes);
  const actualTag = reader.u8();
  if (actualTag !== expectedTag) {
    throw new Error(`result wire tag mismatch: expected ${expectedTag}, got ${actualTag}`);
  }
  let value;
  switch (expectedTag) {
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
    case 12: {
      const len = reader.u32();
      value = Array.from({ length: len }, () => reader.string());
      break;
    }
    case 11: {
      const len = reader.u32();
      value = Array.from({ length: len }, () => reader.u32());
      break;
    }
    case 13: {
      const len = reader.u32();
      value = Array.from({ length: len }, () => reader.string());
      break;
    }
    default:
      throw new Error(`unsupported result wire tag ${expectedTag}`);
  }
  reader.requireEnd();
  return value;
}

function requireWireTag(type, label) {
  if (!Number.isInteger(type?.wireTag)) {
    throw new Error(`${label} is missing a manifest wireTag`);
  }
  return type.wireTag;
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

function normalizeInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

function normalizeArray(value, label) {
  if (value == null || typeof value[Symbol.iterator] !== "function") {
    throw new Error(`${label} must be iterable`);
  }
  return Array.from(value);
}

function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
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
