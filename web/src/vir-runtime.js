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

    if (!this.exports.memory) {
      throw new Error("WASM memory export is missing");
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
      this.packageInfo = { count, byteLength: packageBytes.byteLength };
      return this.packageInfo;
    } finally {
      this.freeBytes(ptr);
    }
  }

  evalConstNat(name) {
    if (typeof this.exports.vir_eval_const_nat_string === "function") {
      return this.evalNamedString("vir_eval_const_nat_string", name);
    }
    this.requireFunction("vir_eval_const_nat");
    return String(this.evalNamedUint32("vir_eval_const_nat", name));
  }

  evalNatToNat(name, value) {
    return this.evalNamedString("vir_eval_nat_to_nat_string", name, normalizeUint32(value, "value"));
  }

  evalNatArrayToNat(name, values) {
    this.requireFunction("vir_eval_nat_array_to_nat_string");
    this.requireFunction("vir_eval_const_nat_string_size");

    const nameBytes = textEncoder.encode(name);
    const normalizedValues = normalizeUint32Array(values);
    const namePtr = this.allocBytes(nameBytes);
    const valuesPtr = this.exports.vir_alloc_bytes(normalizedValues.length * 4);

    try {
      const view = new DataView(this.exports.memory.buffer, valuesPtr, normalizedValues.length * 4);
      normalizedValues.forEach((value, index) => view.setUint32(index * 4, value, true));
      const resultPtr = this.exports.vir_eval_nat_array_to_nat_string(
        namePtr,
        nameBytes.byteLength,
        valuesPtr,
        normalizedValues.length,
      );
      const resultLen = this.exports.vir_eval_const_nat_string_size();
      return this.readWasmString(resultPtr, resultLen);
    } finally {
      this.freeBytes(valuesPtr);
      this.freeBytes(namePtr);
    }
  }

  evalStringToNat(name, value) {
    return this.evalBytesArgumentToNat("vir_eval_string_to_nat_string", name, textEncoder.encode(value));
  }

  evalByteArrayToNat(name, values) {
    return this.evalBytesArgumentToNat("vir_eval_byte_array_to_nat_string", name, asByteArrayBytes(values));
  }

  evalBytesArgumentToNat(exportName, name, bytes) {
    this.requireFunction(exportName);
    this.requireFunction("vir_eval_const_nat_string_size");

    const nameBytes = textEncoder.encode(name);
    const argumentBytes = asBytes(bytes, "argument bytes");
    const namePtr = this.allocBytes(nameBytes);
    const argumentPtr = this.allocBytes(argumentBytes);

    try {
      const resultPtr = this.exports[exportName](
        namePtr,
        nameBytes.byteLength,
        argumentPtr,
        argumentBytes.byteLength,
      );
      const resultLen = this.exports.vir_eval_const_nat_string_size();
      return this.readWasmString(resultPtr, resultLen);
    } finally {
      this.freeBytes(argumentPtr);
      this.freeBytes(namePtr);
    }
  }

  evalNamedString(exportName, name, ...args) {
    this.requireFunction(exportName);
    this.requireFunction("vir_eval_const_nat_string_size");

    const nameBytes = textEncoder.encode(name);
    const ptr = this.allocBytes(nameBytes);
    try {
      const resultPtr = this.exports[exportName](ptr, nameBytes.byteLength, ...args);
      const resultLen = this.exports.vir_eval_const_nat_string_size();
      return this.readWasmString(resultPtr, resultLen);
    } finally {
      this.freeBytes(ptr);
    }
  }

  evalNamedUint32(exportName, name, ...args) {
    this.requireFunction(exportName);

    const nameBytes = textEncoder.encode(name);
    const ptr = this.allocBytes(nameBytes);
    try {
      return this.exports[exportName](ptr, nameBytes.byteLength, ...args);
    } finally {
      this.freeBytes(ptr);
    }
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

function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
}

function normalizeUint32Array(values) {
  if (values == null || typeof values[Symbol.iterator] !== "function") {
    throw new Error("values must be iterable");
  }
  return Array.from(values, (value, index) => normalizeUint32(value, `values[${index}]`));
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
