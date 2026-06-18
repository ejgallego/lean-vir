/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirImports, VirRuntime } from "../../web/src/vir-runtime.js";

const requiredFunctionExports = [
  "vir_alloc_bytes",
  "vir_load_ir_package",
  "vir_last_package_error",
  "vir_last_package_error_size",
  "vir_resolve_call",
  "vir_call",
  "vir_call_resolved",
  "vir_call_resolved_objects",
  "vir_call_resolved_unit_unit",
  "vir_call_resolved_bool_bool",
  "vir_call_resolved_u32_u32",
  "vir_call_resolved_string_string",
  "vir_call_direct_u32_result",
  "vir_call_result_size",
  "vir_call_error",
  "vir_call_error_size",
  "vir_package_interface_manifest",
  "vir_package_interface_manifest_size",
  "vir_package_decl_count",
  "vir_upstream_target_pointer_bytes",
  "vir_obj_bool",
  "vir_obj_get_bool",
  "vir_obj_uint32",
  "vir_obj_get_uint32",
  "vir_obj_string",
  "vir_obj_string_data",
  "vir_obj_string_size",
  "vir_obj_byte_array",
  "vir_obj_byte_array_data",
  "vir_obj_byte_array_size",
  "vir_obj_inc",
  "vir_obj_dec",
];

const invalidMagicPackage = Uint8Array.from([
  3, 0, 0, 0, 98, 97, 100,
  1, 0, 0, 0,
  0, 0, 0, 0,
]);

export async function instantiateVirModule(wasmModule) {
  const imports = createVirImports(wasmModule);
  const { exports } = await WebAssembly.instantiate(wasmModule, imports);
  exports.__wasm_call_ctors?.();
  return exports;
}

export async function smokeWasmPackageBoundary(context) {
  const exports = await instantiateVirModule(context.wasmModule);
  assertRequiredExports(exports);
  assertInvalidPackageDiagnostic(exports);
  loadIrPackage(exports, context.defaultPackageBytes);
  return {
    exports,
    runtime: new VirRuntime(exports),
  };
}

export function loadIrPackage(exports, packageBytes) {
  const packagePtr = exports.vir_alloc_bytes(packageBytes.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, packagePtr, packageBytes.byteLength).set(packageBytes);
    const loadedDecls = exports.vir_load_ir_package(packagePtr, packageBytes.byteLength);
    if (loadedDecls === 0) {
      throw new Error("IR package load failed");
    }
    if (exports.vir_package_decl_count() !== loadedDecls) {
      throw new Error("loaded declaration count does not match package provider state");
    }
    return loadedDecls;
  } finally {
    exports.vir_free_bytes?.(packagePtr);
  }
}

function assertRequiredExports(exports) {
  for (const name of requiredFunctionExports) {
    if (typeof exports[name] !== "function") {
      throw new Error(`${name} export is missing`);
    }
  }
  if (!exports.memory) {
    throw new Error("memory export is missing");
  }
  if (exports.vir_package_decl_count() !== 0) {
    throw new Error("package declaration provider should be empty before an .irpkg is loaded");
  }
  if (exports.vir_upstream_target_pointer_bytes() !== 4) {
    throw new Error("upstream wasm target layout guard failed");
  }
}

function assertInvalidPackageDiagnostic(exports) {
  const badPackagePtr = exports.vir_alloc_bytes(invalidMagicPackage.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, badPackagePtr, invalidMagicPackage.byteLength).set(invalidMagicPackage);
    const loadedDecls = exports.vir_load_ir_package(badPackagePtr, invalidMagicPackage.byteLength);
    if (loadedDecls !== 0) {
      throw new Error("invalid IR package unexpectedly loaded");
    }
    const error = lastPackageError(exports);
    if (!error.includes("invalid IR package magic")) {
      throw new Error(`invalid package diagnostic did not mention magic: ${error}`);
    }
  } finally {
    exports.vir_free_bytes?.(badPackagePtr);
  }
}

function readWasmString(exports, ptr, len) {
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

function lastPackageError(exports) {
  const len = exports.vir_last_package_error_size();
  if (len === 0) return "";
  return readWasmString(exports, exports.vir_last_package_error(), len);
}
