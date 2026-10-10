/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { compileNativeValueCodec } from "../../web/src/runtime/native-value-codecs.js";
import { validateBoundaryInterface } from "../../web/src/runtime/value-interfaces.js";
const compileNativeValueInterface = (runtime, native, value) => compileNativeValueCodec(runtime, { native, value });

const nat = { type: { tag: "nat" } }, bigint = { tag: "bigint" };
const objectType = (declaration, constructors) => ({
  type: { tag: "leanObject" }, metadata: { declaration, constructors },
});
const object = (name, fields) => ({ name, representation: "object",
  storage: { objectFieldCount: fields.length, usizeFieldCount: 0, scalarByteSize: 0 }, fields });
const field = (name, type, index) => ({ name, type, location: { tag: "object", index } });
const pair = objectType("Pair", [object("Pair.mk", [
  field("first", nat, 1), field("second", nat, 0),
])]);
const record = { tag: "record", fields: [
  { key: "__proto__", path: [1], value: bigint }, { key: "x", path: [0], value: bigint },
] };

// This unit substitute models only acquired/consumed references. The benchmark
// separately exercises real Lean/Wasm allocation, packing, calls and disposal.
function heap() {
  const objects = new Map(); let next = 1;
  const add = value => { const ptr = next++; objects.set(ptr, { refs: 1, ...value }); return ptr; };
  function dec(ptr) {
    const pending = [ptr];
    while (pending.length) {
      const current = pending.pop(); if (current <= 0) continue;
      const object = objects.get(current); assert.ok(object, "release must own a live reference");
      if (--object.refs === 0) { objects.delete(current); pending.push(...(object.fields ?? [])); }
    }
  }
  const runtime = {
    exports: { vir_obj_dec: dec, vir_obj_tag: ptr => ptr < 0 ? -ptr - 1 : objects.get(ptr).tag,
      vir_obj_is_scalar: ptr => ptr < 0 ? 1 : 0, vir_obj_scalar_value: ptr => -ptr - 1 },
    targetPointerBytes: () => 4,
    makeObjectScalar: value => -value - 1,
    readObjectScalar: ptr => -ptr - 1,
    makeObjectDecimal: (_name, decimal) => add({ value: BigInt(decimal) }),
    readObjectNat: ptr => ptr < 0 ? BigInt(-ptr - 1) : objects.get(ptr).value,
    ownedObjectField(ptr, index) {
      const child = objects.get(ptr).fields[index];
      if (child > 0) objects.get(child).refs++;
      return child;
    },
    releaseOwnedObjects(fields) { fields.forEach(dec); fields.length = 0; },
    liftObjectConstructorList(obj, label, liftElement, { nilTag, consTag, headIndex, tailIndex }) {
      const values = []; let cursor = obj, ownsCursor = false;
      try {
        while (cursor > 0) {
          assert.equal(objects.get(cursor).tag, consTag);
          const head = this.ownedObjectField(cursor, headIndex);
          try { values.push(liftElement(head, values.length)); } finally { dec(head); }
          const tail = this.ownedObjectField(cursor, tailIndex);
          if (ownsCursor) dec(cursor);
          cursor = tail; ownsCursor = true;
        }
        assert.equal(this.readObjectScalar(cursor, label), nilTag);
        return values;
      } finally { if (ownsCursor) dec(cursor); }
    },
  };
  const scratch = { createObjects(tag, fields) {
    const result = add({ tag, fields: [...fields] }); fields.length = 0; return result;
  } };
  return { runtime, scratch, objects, dec };
}

test("fused record binding respects logical fields and independent physical slots", () => {
  const h = heap(), specification = structuredClone(record);
  const codec = compileNativeValueInterface(h.runtime, pair, specification);
  specification.fields[0].key = "changed"; specification.fields[1].path[0] = 1;
  const value = JSON.parse('{"__proto__":43,"x":42}'); value.__proto__ = 43n; value.x = 42n;
  const obj = codec.lower(value, "input", h.scratch);
  assert.equal(h.runtime.readObjectNat(h.objects.get(obj).fields[0]), 43n);
  assert.equal(h.runtime.readObjectNat(h.objects.get(obj).fields[1]), 42n);
  const result = codec.lift(obj, "output");
  assert.deepEqual(result, value); assert.equal(Object.getPrototypeOf(result), Object.prototype);
  h.dec(obj); assert.equal(h.objects.size, 0);
});

test("partial lowering releases earlier fields when a later value fails", () => {
  const h = heap(), codec = compileNativeValueInterface(h.runtime, pair, record);
  const value = Object.fromEntries([["__proto__", 43n], ["x", -1n]]);
  assert.throws(() => codec.lower(value, "input", h.scratch), /non-negative/);
  assert.equal(h.objects.size, 0);
});

test("output templates avoid inherited setters and produce writable own fields", () => {
  const h = heap(), codec = compileNativeValueInterface(h.runtime, pair, record);
  const value = Object.fromEntries([["__proto__", 43n], ["x", 42n]]);
  const obj = codec.lower(value, "input", h.scratch);
  let writes = 0;
  Object.defineProperty(Object.prototype, "x", { configurable: true, set() { writes++; } });
  try {
    const result = codec.lift(obj, "output");
    assert.deepEqual(result, value); assert.equal(writes, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, "x"), {
      value: 42n, enumerable: true, configurable: true, writable: true,
    });
  } finally { delete Object.prototype.x; h.dec(obj); }
  assert.equal(h.objects.size, 0);
});

test("failed lifting releases the acquired child and preserves the caller's root", () => {
  const h = heap(), codec = compileNativeValueInterface(h.runtime, pair, record);
  const obj = codec.lower(Object.fromEntries([["__proto__", 9007199254740994n], ["x", 9007199254740993n]]), "input", h.scratch);
  h.runtime.readObjectNat = ptr => { if (h.objects.get(ptr).value === 9007199254740993n) throw new Error("child lift failed"); return h.objects.get(ptr).value; };
  assert.throws(() => codec.lift(obj, "output"), /child lift failed/);
  assert.ok([...h.objects.values()].every(object => object.refs === 1));
  h.dec(obj); assert.equal(h.objects.size, 0);
});

test("one native Option preserves all distinctions under different views", () => {
  const unit = objectType("Unit", [
    { name: "Unit.unit", representation: "immediate", fields: [] },
  ]);
  const option = child => objectType("Option", [
    { name: "Option.none", representation: "immediate", fields: [] },
    object("Option.some", [field("val", child, 0)]),
  ]);
  const view = (inner, no, yes) => ({ tag: "variant", cases: [
    { kind: no, payload: "none" }, { kind: yes, payload: "value", value: inner },
  ] });
  const h = heap(), native = option(option(unit));
  const standard = compileNativeValueInterface(h.runtime, native, view(view({ tag: "unit" }, "none", "some"), "none", "some"));
  const alternate = compileNativeValueInterface(h.runtime, native, view(view({ tag: "unit" }, "empty", "full"), "absent", "present"));
  for (const value of [{ kind: "none" }, { kind: "some", value: { kind: "none" } },
    { kind: "some", value: { kind: "some", value: undefined } }]) {
    const obj = standard.lower(value, "input", h.scratch);
    assert.deepEqual(standard.lift(obj, "output"), value);
    const result = alternate.lift(obj, "output");
    const other = alternate.lower(result, "input", h.scratch);
    assert.deepEqual(standard.lift(other, "output"), value);
    h.dec(other); h.dec(obj); assert.equal(h.objects.size, 0);
  }
  assert.throws(() => standard.lower({ kind: "some" }, "input", h.scratch), /missing value/);
});

test("safe integer is an explicit view with range checks in both directions", () => {
  const h = heap(), codec = compileNativeValueInterface(h.runtime, nat, { tag: "safeInteger" });
  assert.throws(() => codec.lower(Number.MAX_SAFE_INTEGER + 1, "input"), /safe integer/);
  const big = compileNativeValueInterface(h.runtime, nat, bigint);
  const obj = big.lower(9007199254740993n, "input");
  assert.throws(() => codec.lift(obj, "output"), /safe integer range/);
  h.dec(obj); assert.equal(h.objects.size, 0);
});

test("an identity constructor uses its own ordinal when its payload has another tag", () => {
  const h = heap(), native = objectType("Wrapper", [
    { name: "Wrapper.mk", representation: "identity", fields: [
      { name: "value", type: nat },
    ] },
  ]);
  const view = { tag: "variant", cases: [
    { kind: "wrapped", payload: "value", value: bigint },
  ] };
  validateBoundaryInterface({ native, value: view });
  const codec = compileNativeValueInterface(h.runtime, native, view);
  for (const value of [42n, 9007199254740993n]) {
    const input = { kind: "wrapped", value };
    const obj = codec.lower(input, "input", h.scratch);
    assert.deepEqual(codec.lift(obj, "output"), input);
    h.dec(obj); assert.equal(h.objects.size, 0);
  }
});

test("chain traversal uses chosen ordinals and physical slots without declaration-name dispatch", () => {
  const h = heap(), native = objectType("UnrelatedChain", [
    object("UnrelatedChain.link", [field("rest", { ref: 0 }, 1), field("item", nat, 0)]),
    { name: "UnrelatedChain.stop", representation: "immediate", fields: [] },
  ]);
  const view = { tag: "sequence", element: bigint, chain: { nil: 1, cons: 0, head: 1, tail: 0 } };
  const codec = compileNativeValueInterface(h.runtime, native, view);
  const obj = codec.lower([42n, 43n], "input", h.scratch);
  assert.deepEqual(codec.lift(obj, "output"), [42n, 43n]);
  h.dec(obj); assert.equal(h.objects.size, 0);
  // Right-to-left lowering has already allocated the final valid tail.
  assert.throws(() => codec.lower([-1n, 43n], "input", h.scratch), /non-negative/);
  assert.equal(h.objects.size, 0);
});

test("immediate constructor plans reject unknown ordinals and heap objects", () => {
  const h = heap(), native = objectType("Mode", [
    { name: "Mode.off", representation: "immediate", fields: [] },
    { name: "Mode.on", representation: "immediate", fields: [] },
  ]);
  const codec = compileNativeValueInterface(h.runtime, native, { tag: "enum", cases: ["disabled", "enabled"] });
  for (const value of ["disabled", "enabled"])
    assert.equal(codec.lift(codec.lower(value, "input"), "output"), value);
  assert.throws(() => codec.lower("on", "input"), /unknown enum/);
  assert.throws(() => codec.lift(h.runtime.makeObjectScalar(2), "output"), /out of range/);
  const object = h.runtime.makeObjectDecimal("vir_obj_nat", "42");
  assert.throws(() => codec.lift(object, "output"), /out of range/);
  h.dec(object); assert.equal(h.objects.size, 0);
});
