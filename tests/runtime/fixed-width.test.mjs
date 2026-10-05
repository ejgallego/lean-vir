/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { normalizeDecimal, normalizeBoundedUnsignedDecimal } from "../../web/src/runtime/vir-value-normalizers.js";

test("direct fixed-width boxing reports null constructor results as lowering failures", () => {
  const runtime = Object.create(VirRuntime.prototype);
  let calls = 0;
  Object.assign(runtime, {
    targetPointerBytes: () => 4,
    exports: {
      vir_obj_uint64_scalar(value) { assert.equal(value, 0n); calls++; return 0; },
      vir_obj_usize_scalar(value) { assert.equal(value, 0); calls++; return 0; },
    },
  });
  for (const [interfaceTag, name] of [[INTERFACE_TAG.UINT64, "UInt64"], [INTERFACE_TAG.USIZE, "USize"]]) {
    assert.throws(() => runtime.makeObjectValue({ interfaceTag }, 0, "zero"),
      new RegExp(`could not be lowered to a Lean ${name} object`));
  }
  assert.equal(calls, 2);
});

test("direct USize transport rejects wider targets before calling the ABI", () => {
  const runtime = Object.create(VirRuntime.prototype);
  Object.assign(runtime, {
    targetPointerBytes: () => 8,
    exports: {
      vir_obj_usize_scalar() { assert.fail("must not truncate a wider input"); },
      vir_obj_usize_value() { assert.fail("must not truncate a wider result"); },
      vir_obj_ctor_scalar_data() { assert.fail("must not inspect a wider USize field"); },
    },
  });
  const type = { interfaceTag: INTERFACE_TAG.USIZE };
  assert.throws(() => runtime.makeObjectValue(type, 1n << 32n, "wide"), /requires a wasm32 runtime/);
  assert.throws(() => runtime.liftObjectValue(type, 1, "wide"), /requires a wasm32 runtime/);
  assert.throws(() => runtime.readObjectUSizeField(
    { objectFieldCount: 0, usizeFieldCount: 1 }, 1, 0, "wide"), /requires a wasm32 runtime/);
});

test("decimal clients retain their existing text normalization", () => {
  assert.equal(normalizeDecimal(" -00041 ", "Int", { signed: true }), "-00041");
  assert.equal(normalizeDecimal(-0, "Nat", { signed: false }), "0");
  assert.equal(normalizeBoundedUnsignedDecimal(" 00041 ", "index", 100n, "index"), "00041");
});
