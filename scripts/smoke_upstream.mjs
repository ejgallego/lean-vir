/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const irPackage = await readFile(new URL("../web/public/vir-demo.irpkg", import.meta.url));
const fixtureManifest = JSON.parse(await readFile(new URL("../fixtures/manifest.json", import.meta.url), "utf8"));
const mod = new WebAssembly.Module(wasm);
const imports = {};

for (const spec of WebAssembly.Module.imports(mod)) {
  if (!imports[spec.module]) {
    imports[spec.module] = {};
  }
  if (spec.kind === "function") {
    imports[spec.module][spec.name] = (...args) => {
      if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
        throw new Error(`WASI proc_exit(${args[0]})`);
      }
      return 0;
    };
  }
}

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
if (typeof exports.vir_upstream_fib !== "function") {
  throw new Error("vir_upstream_fib export is missing");
}
if (typeof exports.vir_upstream_fib_repeated !== "function") {
  throw new Error("vir_upstream_fib_repeated export is missing");
}
if (typeof exports.vir_upstream_tamagotchi_step !== "function") {
  throw new Error("vir_upstream_tamagotchi_step export is missing");
}
if (typeof exports.vir_upstream_tamagotchi_run_demo !== "function") {
  throw new Error("vir_upstream_tamagotchi_run_demo export is missing");
}
if (typeof exports.vir_eval_const_nat !== "function") {
  throw new Error("vir_eval_const_nat export is missing");
}
if (typeof exports.vir_eval_const_nat_string !== "function") {
  throw new Error("vir_eval_const_nat_string export is missing");
}
if (typeof exports.vir_eval_const_nat_string_size !== "function") {
  throw new Error("vir_eval_const_nat_string_size export is missing");
}
if (typeof exports.vir_sort_checksum !== "function") {
  throw new Error("vir_sort_checksum export is missing");
}
if (typeof exports.vir_sort_checksum_repeated !== "function") {
  throw new Error("vir_sort_checksum_repeated export is missing");
}
if (typeof exports.vir_last_package_error !== "function") {
  throw new Error("vir_last_package_error export is missing");
}
if (typeof exports.vir_last_package_error_size !== "function") {
  throw new Error("vir_last_package_error_size export is missing");
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

const fibCases = [
  [0, 0],
  [1, 1],
  [8, 21],
  [10, 55],
  [12, 144],
  [17, 1597],
];

for (const [input, expected] of fibCases) {
  const actual = exports.vir_upstream_fib(input);
  if (actual !== expected) {
    throw new Error(`upstream fib ${input}: expected ${expected}, got ${actual}`);
  }
}

const repeatedFib = exports.vir_upstream_fib_repeated(80, 17);
if (repeatedFib !== 127760) {
  throw new Error(`upstream repeated fib: expected 127760, got ${repeatedFib}`);
}

const mood = {
  happy: 0,
  hungry: 1,
  sleepy: 2,
  angry: 3,
  asleep: 4,
  dead: 5,
};

const action = {
  feed: 0,
  play: 1,
  nap: 2,
  wake: 3,
  ignore: 4,
};

const stepCases = [
  [mood.happy, action.ignore, mood.hungry],
  [mood.hungry, action.feed, mood.happy],
  [mood.happy, action.play, mood.sleepy],
  [mood.sleepy, action.nap, mood.asleep],
  [mood.asleep, action.wake, mood.happy],
  [mood.hungry, action.ignore, mood.angry],
  [mood.angry, action.ignore, mood.dead],
];

for (const [current, act, expected] of stepCases) {
  const actual = exports.vir_upstream_tamagotchi_step(current, act);
  if (actual !== expected) {
    throw new Error(`upstream Tamagotchi.step ${current} ${act}: expected ${expected}, got ${actual}`);
  }
}

let current = mood.happy;
const trace = [current];
for (const act of [action.ignore, action.feed, action.play, action.nap, action.wake, action.ignore, action.ignore]) {
  current = exports.vir_upstream_tamagotchi_step(current, act);
  trace.push(current);
}

const expectedTrace = [mood.happy, mood.hungry, mood.happy, mood.sleepy, mood.asleep, mood.happy, mood.hungry, mood.angry];
if (trace.join(",") !== expectedTrace.join(",")) {
  throw new Error(`upstream Tamagotchi trace: expected ${expectedTrace}, got ${trace}`);
}

const runDemo = exports.vir_upstream_tamagotchi_run_demo();
if (runDemo !== mood.angry) {
  throw new Error(`upstream Tamagotchi.run demoScript: expected ${mood.angry}, got ${runDemo}`);
}

function evalConstNat(name) {
  const bytes = new TextEncoder().encode(name);
  const ptr = exports.vir_alloc_bytes(bytes.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, bytes.byteLength).set(bytes);
    const resultPtr = exports.vir_eval_const_nat_string(ptr, bytes.byteLength);
    const resultLen = exports.vir_eval_const_nat_string_size();
    return readWasmString(resultPtr, resultLen);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

const sortChecksum = evalConstNat("SortDemo.demo");
if (sortChecksum !== "192") {
  throw new Error(`upstream SortDemo.demo: expected 192, got ${sortChecksum}`);
}

function sortChecksumFor(values) {
  const ptr = exports.vir_alloc_bytes(values.length * 4);
  try {
    const view = new DataView(exports.memory.buffer, ptr, values.length * 4);
    values.forEach((value, index) => view.setUint32(index * 4, value, true));
    return exports.vir_sort_checksum(ptr, values.length);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

const editableChecksum = sortChecksumFor([4, 1, 3, 2]);
if (editableChecksum !== 30) {
  throw new Error(`upstream SortDemo.demoFromArray: expected 30, got ${editableChecksum}`);
}

function repeatedSortChecksumFor(values, iterations) {
  const ptr = exports.vir_alloc_bytes(values.length * 4);
  try {
    const view = new DataView(exports.memory.buffer, ptr, values.length * 4);
    values.forEach((value, index) => view.setUint32(index * 4, value, true));
    return exports.vir_sort_checksum_repeated(ptr, values.length, iterations);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

const repeatedSortChecksum = repeatedSortChecksumFor([4, 1, 3, 2], 5);
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

    const bytes = new TextEncoder().encode(fixture.entry);
    const ptr = fixtureExports.vir_alloc_bytes(bytes.byteLength);
    try {
      new Uint8Array(fixtureExports.memory.buffer, ptr, bytes.byteLength).set(bytes);
      const resultPtr = fixtureExports.vir_eval_const_nat_string(ptr, bytes.byteLength);
      const resultLen = fixtureExports.vir_eval_const_nat_string_size();
      value = new TextDecoder().decode(new Uint8Array(fixtureExports.memory.buffer, resultPtr, resultLen));
    } finally {
      fixtureExports.vir_free_bytes?.(ptr);
    }
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
