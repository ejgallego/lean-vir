/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import assert from "node:assert/strict";
import test from "node:test";

import { ObjectValueRuntime } from "../../web/src/runtime/object-values.js";

function mockRuntime(nameResult = "Nat.succ") {
  const runtime = Object.create(ObjectValueRuntime.prototype);
  runtime.exports = {
    vir_obj_expr_fvar: () => 1,
    vir_obj_name_string: () => 1,
    vir_obj_name_string_size: () => nameResult.length,
  };
  runtime.allocBytes = () => 1;
  runtime.freeBytes = () => {};
  runtime.readWasmString = () => nameResult;
  return runtime;
}

test("Expr Name lowering checks structural spelling before the Wasm grammar check", () => {
  const runtime = mockRuntime();
  for (const name of ["Nat.succ", "café", "αβ₁", "℀", "", "[anonymous]"]) {
    assert.equal(
      runtime.makeObjectExpr({ kind: "fvar", name }, "expr"),
      1,
      `expected supported name ${JSON.stringify(name)}`,
    );
  }

  for (const name of [
    "A.1",
    `A.${"9".repeat(200)}`,
    "A..B",
    "A.«B.C»",
    "A\uD800",
  ]) {
    assert.throws(
      () => runtime.makeObjectExpr({ kind: "fvar", name }, "expr"),
      /Name|identifier|numeric|escaped|components|Unicode/,
      `expected unsupported name ${JSON.stringify(name)} to be rejected`,
    );
  }
});

test("lifted Expr Names reject representations that would normalize", () => {
  for (const name of ["A.1", `A.${"9".repeat(200)}`, "A..B", "A.«B.C»"]) {
    const runtime = mockRuntime(name);
    assert.throws(
      () => runtime.readObjectName(1),
      /Name|identifier|numeric|escaped|components/,
      `expected lifted name ${JSON.stringify(name)} to be rejected`,
    );
  }

  for (const name of ["Nat.succ", "αβ₁", "[anonymous]"]) {
    const runtime = mockRuntime(name);
    assert.equal(runtime.readObjectName(1), name);
  }

  const rejectedRawName = mockRuntime();
  rejectedRawName.exports.vir_obj_name_string = () => 0;
  assert.throws(
    () => rejectedRawName.readObjectName(1),
    /unsupported numeric, escaped, empty, or non-identifier components/,
  );
});
