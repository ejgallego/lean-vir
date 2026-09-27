/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createVirImports } from "../../web/src/vir-runtime.js";

// One imported () -> i32 function, re-exported as call. This exercises actual
// WebAssembly linking without requiring generated VIR artifacts.
function importModule(namespace, name, kind = "function") {
  const string = (text) => [text.length, ...new TextEncoder().encode(text)];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  return new WebAssembly.Module(Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 1, 0x7f]),
    ...section(2, [1, ...string(namespace), ...string(name),
      ...(kind === "memory" ? [2, 0, 1] : [0, 0])]),
    ...section(7, [1, ...string("call"), kind === "memory" ? 2 : 0, 0]),
  ]));
}

test("unrecognized imports fail before an instance is created", () => {
  for (const [namespace, name] of [
    ["extension", "new_operation"],
    ["env", "new_operation"],
    ["wasi_snapshot_preview1", "path_open"],
    ["__proto__", "constructor"],
    ["env", "toString"],
  ]) {
    assert.throws(
      () => createVirImports(importModule(namespace, name)),
      (error) => error.message.includes(`${namespace}.${name}`) &&
        error.message.includes("explicit imports override"),
    );
  }
});

test("explicit overrides satisfy custom functions and memories", () => {
  const module = importModule("extension", "new_operation");
  const imports = createVirImports(module, { extension: { new_operation: () => 42 } });
  assert.equal(new WebAssembly.Instance(module, imports).exports.call(), 42);
  const memoryModule = importModule("extension", "heap", "memory");
  assert.throws(() => createVirImports(memoryModule), /extension.heap \(memory\)/);
  const memory = new WebAssembly.Memory({ initial: 1 });
  assert.equal(new WebAssembly.Instance(memoryModule,
    createVirImports(memoryModule, { extension: { heap: memory } })).exports.call, memory);
});

test("WASI defaults report unavailable services rather than false success", () => {
  for (const [name, expected] of [
    ["args_get", 52], ["args_sizes_get", 52],
    ["environ_get", 52], ["environ_sizes_get", 52],
    ["clock_time_get", 52], ["poll_oneoff", 52],
    ["fd_close", 8], ["fd_fdstat_get", 8], ["fd_prestat_get", 8],
    ["fd_prestat_dir_name", 8], ["fd_read", 8], ["fd_seek", 8], ["fd_write", 8],
    ["sched_yield", 0],
  ]) {
    const module = importModule("wasi_snapshot_preview1", name);
    assert.equal(new WebAssembly.Instance(module, createVirImports(module)).exports.call(), expected, name);
  }
  const module = importModule("wasi_snapshot_preview1", "proc_exit");
  assert.throws(() => createVirImports(module).wasi_snapshot_preview1.proc_exit(7), /WASI proc_exit\(7\)/);
});

test("WASI overrides take precedence over unavailable defaults", () => {
  const module = importModule("wasi_snapshot_preview1", "fd_write");
  const imports = createVirImports(module, { wasi_snapshot_preview1: { fd_write: () => 19 } });
  assert.equal(new WebAssembly.Instance(module, imports).exports.call(), 19);
});

test("hostless linking remains available but VIR hooks require host state", () => {
  for (const name of ["vir_js_call_objects", "vir_resource_root", "vir_resource_get", "vir_resource_release"]) {
    const module = importModule("env", name);
    const instance = new WebAssembly.Instance(module, createVirImports(module));
    assert.throws(() => instance.exports.call(), /without an attached host state/);
  }
});

test("attached host hooks retain object-call error recording", () => {
  const error = new Error("host failure");
  let recorded;
  const module = importModule("env", "vir_js_call_objects");
  const imports = createVirImports(module, {}, {
    callObjects() { throw error; },
    recordCallError(value) { recorded = value; },
  });
  assert.equal(new WebAssembly.Instance(module, imports).exports.call(), 0);
  assert.equal(recorded, error);
});
