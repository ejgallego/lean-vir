/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { createVirImports, VirRuntime } from "../web/src/vir-runtime.js";

const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const irPackage = await readFile(new URL("../web/public/vir-demo.irpkg", import.meta.url));
const fixtureManifest = JSON.parse(await readFile(new URL("../fixtures/manifest.json", import.meta.url), "utf8"));
const mod = new WebAssembly.Module(wasm);
const imports = createVirImports(mod);

const { exports } = await WebAssembly.instantiate(mod, imports);
exports.__wasm_call_ctors?.();

if (typeof exports.vir_alloc_bytes !== "function") {
  throw new Error("vir_alloc_bytes export is missing");
}
if (typeof exports.vir_load_ir_package !== "function") {
  throw new Error("vir_load_ir_package export is missing");
}
if (!exports.memory) {
  throw new Error("memory export is missing");
}
if (typeof exports.vir_last_package_error !== "function") {
  throw new Error("vir_last_package_error export is missing");
}
if (typeof exports.vir_last_package_error_size !== "function") {
  throw new Error("vir_last_package_error_size export is missing");
}
if (typeof exports.vir_call !== "function") {
  throw new Error("vir_call export is missing");
}
if (typeof exports.vir_call_result_size !== "function") {
  throw new Error("vir_call_result_size export is missing");
}
if (typeof exports.vir_call_error !== "function") {
  throw new Error("vir_call_error export is missing");
}
if (typeof exports.vir_call_error_size !== "function") {
  throw new Error("vir_call_error_size export is missing");
}
if (typeof exports.vir_package_interface_manifest !== "function") {
  throw new Error("vir_package_interface_manifest export is missing");
}
if (typeof exports.vir_package_interface_manifest_size !== "function") {
  throw new Error("vir_package_interface_manifest_size export is missing");
}
if (exports.vir_upstream_target_pointer_bytes() !== 4) {
  throw new Error("upstream wasm target layout guard failed");
}

function readWasmString(ptr, len) {
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

function lastPackageError() {
  const len = exports.vir_last_package_error_size();
  if (len === 0) return "";
  return readWasmString(exports.vir_last_package_error(), len);
}

const badPackage = Uint8Array.from([
  3, 0, 0, 0, 98, 97, 100,
  1, 0, 0, 0,
  0, 0, 0, 0,
]);
const badPackagePtr = exports.vir_alloc_bytes(badPackage.byteLength);
try {
  new Uint8Array(exports.memory.buffer, badPackagePtr, badPackage.byteLength).set(badPackage);
  const loadedDecls = exports.vir_load_ir_package(badPackagePtr, badPackage.byteLength);
  if (loadedDecls !== 0) {
    throw new Error("invalid IR package unexpectedly loaded");
  }
  const error = lastPackageError();
  if (!error.includes("invalid IR package magic")) {
    throw new Error(`invalid package diagnostic did not mention magic: ${error}`);
  }
} finally {
  exports.vir_free_bytes?.(badPackagePtr);
}

const packagePtr = exports.vir_alloc_bytes(irPackage.byteLength);
try {
  new Uint8Array(exports.memory.buffer, packagePtr, irPackage.byteLength).set(irPackage);
  const loadedDecls = exports.vir_load_ir_package(packagePtr, irPackage.byteLength);
  if (loadedDecls === 0) {
    throw new Error("IR package load failed");
  }
} finally {
  exports.vir_free_bytes?.(packagePtr);
}

const runtime = new VirRuntime(exports);

const fibCases = [
  [0, 0],
  [1, 1],
  [8, 21],
  [10, 55],
  [12, 144],
  [17, 1597],
];

for (const [input, expected] of fibCases) {
  const actual = runtime.call("fib", input);
  if (actual !== String(expected)) {
    throw new Error(`upstream fib ${input}: expected ${expected}, got ${actual}`);
  }
}

let repeatedFib = 0;
for (let i = 0; i < 80; i++) {
  repeatedFib += Number(runtime.call("fib", 17));
}
if (repeatedFib !== 127760) {
  throw new Error(`upstream repeated fib: expected 127760, got ${repeatedFib}`);
}

const stepCases = [
  ["happy", "ignore", "hungry"],
  ["hungry", "feed", "happy"],
  ["happy", "play", "sleepy"],
  ["sleepy", "nap", "asleep"],
  ["asleep", "wake", "happy"],
  ["hungry", "ignore", "angry"],
  ["angry", "ignore", "dead"],
];

for (const [current, act, expected] of stepCases) {
  const actual = runtime.call("Tamagotchi.step", current, act);
  if (actual !== expected) {
    throw new Error(`upstream Tamagotchi.step ${current} ${act}: expected ${expected}, got ${actual}`);
  }
}

let current = "happy";
const trace = [current];
for (const act of ["ignore", "feed", "play", "nap", "wake", "ignore", "ignore"]) {
  current = runtime.call("Tamagotchi.step", current, act);
  trace.push(current);
}

const expectedTrace = ["happy", "hungry", "happy", "sleepy", "asleep", "happy", "hungry", "angry"];
if (trace.join(",") !== expectedTrace.join(",")) {
  throw new Error(`upstream Tamagotchi trace: expected ${expectedTrace}, got ${trace}`);
}

const sortChecksum = runtime.call("SortDemo.demo");
if (sortChecksum !== "192") {
  throw new Error(`upstream SortDemo.demo: expected 192, got ${sortChecksum}`);
}

const genericFib = runtime.call("fib", 12);
if (genericFib !== "144") {
  throw new Error(`generic fib input: expected 144, got ${genericFib}`);
}

const editableChecksum = runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]);
if (editableChecksum !== "30") {
  throw new Error(`upstream SortDemo.demoFromArray: expected 30, got ${editableChecksum}`);
}

const genericEditableChecksum = runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]);
if (genericEditableChecksum !== "30") {
  throw new Error(`generic SortDemo.demoFromArray: expected 30, got ${genericEditableChecksum}`);
}

const genericStringScore = runtime.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z");
if (genericStringScore !== "1381") {
  throw new Error(`generic String input: expected 1381, got ${genericStringScore}`);
}

const genericByteArrayScore = runtime.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]);
if (genericByteArrayScore !== "136") {
  throw new Error(`generic ByteArray input: expected 136, got ${genericByteArrayScore}`);
}

let repeatedSortChecksum = 0;
for (let i = 0; i < 5; i++) {
  repeatedSortChecksum += Number(runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]));
}
if (repeatedSortChecksum !== 150) {
  throw new Error(`upstream repeated SortDemo.demoFromArray: expected 150, got ${repeatedSortChecksum}`);
}

for (const fixture of fixtureManifest.fixtures ?? []) {
  if (fixture.result?.type !== "Nat") {
    throw new Error(`${fixture.id}: unsupported smoke result type ${fixture.result?.type}`);
  }
  let value;
  try {
    const { exports: fixtureExports } = await WebAssembly.instantiate(mod, imports);
    fixtureExports.__wasm_call_ctors?.();
    const fixturePackagePtr = fixtureExports.vir_alloc_bytes(irPackage.byteLength);
    try {
      new Uint8Array(fixtureExports.memory.buffer, fixturePackagePtr, irPackage.byteLength).set(irPackage);
      const loadedDecls = fixtureExports.vir_load_ir_package(fixturePackagePtr, irPackage.byteLength);
      if (loadedDecls === 0) {
        throw new Error("IR package load failed");
      }
    } finally {
      fixtureExports.vir_free_bytes?.(fixturePackagePtr);
    }

    value = new VirRuntime(fixtureExports).call(fixture.entry);
  } catch (error) {
    throw new Error(`${fixture.id}: fixture evaluation failed`, { cause: error });
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fixture.id}: expected Nat result, got ${value}`);
  }
}

console.log(
  `upstream smoke ok: fib 17 = 1597, Tamagotchi ends angry, editable SortDemo works, ${fixtureManifest.fixtures.length} fixtures run`,
);
