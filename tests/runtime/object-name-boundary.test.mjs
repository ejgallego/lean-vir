/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import assert from "node:assert/strict";
import test from "node:test";

import { VirRuntime } from "../../web/src/runtime/core.js";

function mockRuntime(nameResult = "Nat.succ") {
  const runtime = Object.create(VirRuntime.prototype);
  runtime.exports = {
    vir_obj_expr_fvar: () => 1,
    vir_obj_inc: () => {},
    vir_obj_dec: () => {},
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
    ["A", -1n],
    ["A", 1.5],
    ["A", null],
    ["A\uD800"],
    { name: "A" },
  ]) {
    assert.throws(
      () => runtime.makeObjectExpr({ kind: "fvar", name }, "expr"),
      /Name|identifier|numeric|escaped|components|Unicode|integer/,
      `expected unsupported name ${JSON.stringify(name, (_key, value) =>
        typeof value === "bigint" ? `${value}n` : value)} to be rejected`,
    );
  }
});

test("Expr Name lowering sends component arrays as canonical name keys", () => {
  const runtime = mockRuntime();
  const sent = [];
  runtime.withWasmString = (text, _label, callback) => {
    sent.push(text);
    return callback(1, text.length);
  };
  for (const name of [["_uniq", 12n], ["_private", "M", 0, "x"], ["A", "B.C"], []]) {
    assert.equal(runtime.makeObjectExpr({ kind: "fvar", name }, "expr"), 1);
  }
  assert.deepEqual(sent, [
    "s5f756e6971/n12/",
    "s5f70726976617465/s4d/n0/s78/",
    "s41/s422e43/",
    "",
  ]);
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

  // Names without a dotted spelling are read through their structural key.
  const keyed = mockRuntime("s4e756d6572616c/n1/s7061727420776974682073706163652e/");
  keyed.exports.vir_obj_name_string = () => 0;
  keyed.exports.vir_obj_name_key = () => 1;
  assert.deepEqual(keyed.readObjectName(1), ["Numeral", 1n, "part with space."]);

  const unreadable = mockRuntime();
  unreadable.exports.vir_obj_name_string = () => 0;
  assert.throws(() => unreadable.readObjectName(1), /could not be read/);
});

test("structural Name components preserve leading U+FEFF on round-trip", () => {
  for (const [key, name] of [
    ["sefbbbf78/", ["\uFEFFx"]],
    ["sefbbbf/", ["\uFEFF"]],
    ["s41/sefbbbf78/sefbbbf/", ["A", "\uFEFFx", "\uFEFF"]],
  ]) {
    const runtime = mockRuntime(key);
    runtime.exports.vir_obj_name_string = () => 0;
    runtime.exports.vir_obj_name_key = () => 1;
    const lifted = runtime.readObjectName(1);
    assert.deepEqual(lifted, name);
    let loweredKey;
    runtime.withWasmString = (text, _label, callback) => {
      loweredKey = text;
      return callback(1, text.length);
    };
    runtime.makeObjectExpr({ kind: "fvar", name: lifted }, "expr");
    assert.equal(loweredKey, key);
  }
});
