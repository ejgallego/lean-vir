/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { assert, readFile } from "./shared.mjs";

const runtime = await createVirRuntimeFactory({
  wasmBytes: await readFile(process.argv[2] ?? new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
}).createRuntime();
try {
  for (const name of ["A..B", "A.", ".B", "A.1", `A.${"9".repeat(200)}`, "A.«B.C»", "A B", "A\0B", "1A", "雪", "e\u0301"]) {
    const value = runtime.withWasmString(name, "raw Name", (ptr, len) => runtime.exports.vir_obj_level_param(ptr, len));
    if (value !== 0) runtime.exports.vir_obj_dec(value);
    assert.equal(value, 0, `raw constructor must reject ${JSON.stringify(name)}`);
    assert.throws(() => runtime.makeObjectLevel({ kind: "param", name }, "level"));
  }
  const ptr = runtime.allocBytes(Uint8Array.of(0xff));
  try { assert.equal(runtime.exports.vir_obj_level_param(ptr, 1), 0, "invalid UTF-8"); }
  finally { runtime.freeBytes(ptr); }
  for (const name of ["", "[anonymous]", "Nat.succ", "café", "αβ₁", "℀"]) {
    const value = runtime.withWasmString(name, "raw Name", (ptr, len) => runtime.exports.vir_obj_level_param(ptr, len));
    assert.notEqual(value, 0);
    try {
      assert.deepEqual(runtime.liftObjectLevel(value, "level"), { kind: "param", name: name || "[anonymous]" });
    } finally { runtime.exports.vir_obj_dec(value); }
    const lowered = runtime.makeObjectLevel({ kind: "param", name }, "level");
    try {
      assert.deepEqual(runtime.liftObjectLevel(lowered, "level"), { kind: "param", name: name || "[anonymous]" });
    } finally { runtime.exports.vir_obj_dec(lowered); }
  }
} finally { runtime.dispose(); }
console.log("raw Expr/Level name boundary smoke ok");
