/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { compileNativeValueCodec } from "../../web/src/runtime/native-value-codecs.js";
import { ConstructorScratch } from "../../web/src/runtime/constructor-scratch.js";
import { validateBoundaryInterface } from "../../web/src/runtime/value-interfaces.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { PrimitiveObjectRuntime } from "../../web/src/runtime/primitive-values.js";
import {
  arrayBoundary, booleanBoundary, enumBoundary, functionBoundary,
  identityConstructor, immediateConstructor, nativeField, objectBoundary,
  objectConstructor, primitiveBoundary, resourceBoundary, unitBoundary,
} from "../support/interface-fixtures.mjs";

const jsonSafe = { representation: "json-safe-v1" };
const nat = primitiveBoundary("nat", "bigint");
const int = primitiveBoundary("int", "bigint");
const u64 = primitiveBoundary("unsigned", "bigint", { width: 64 });
const string = primitiveBoundary("string", "string");
function option(child) {
  return objectBoundary("Option", [immediateConstructor("Option.none"), objectConstructor("Option.some", {
    objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
  }, [nativeField("val", child.native, { tag: "object", index: 0 })])], {
    tag: "variant", cases: [{ kind: "none", payload: "none" },
      { kind: "some", payload: "value", value: child.value }],
  });
}
function record(entries, storage) {
  return objectBoundary("Row", [objectConstructor("Row.mk", storage ?? {
    objectFieldCount: entries.length, usizeFieldCount: 0, scalarByteSize: 0,
  }, entries.map(([name, pair, location], index) => nativeField(name, pair.native,
    location ?? { tag: "object", index })))], {
    tag: "record", fields: entries.map(([key, pair], index) => ({ key, path: [index], value: pair.value })),
  });
}

// Production binder, primitive conversion, scratch and ownership traversal.
// Native allocation/access/reference counting are modeled, not real Lean/Wasm.
function harness() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const heap = new Map(), buffers = new Set();
  let id = 1024, ptr = 64, failConstructor = false;
  function allocate(value) { const obj = id; id += 2; heap.set(obj, { refs: 1, ...value }); return obj; }
  function inc(obj) { if (!(obj & 1)) heap.get(obj).refs++; }
  function dec(obj) {
    if (obj & 1) return;
    const node = heap.get(obj); assert.ok(node, `live object ${obj}`);
    if (--node.refs === 0) { heap.delete(obj); for (const child of node.fields ?? []) dec(child); }
  }
  function reserve(size) {
    const result = ptr; ptr += Math.max(8, size);
    if (ptr > memory.buffer.byteLength) memory.grow(Math.ceil((ptr - memory.buffer.byteLength) / 65536));
    return result;
  }
  function ctor(tag, objectsPtr, count, usizePtr = 0, usizeCount = 0, scalarPtr = 0, scalarSize = 0) {
    if (failConstructor) return 0;
    const fields = Array.from({ length: count }, (_, i) => new DataView(memory.buffer).getUint32(objectsPtr + i * 4, true));
    const packed = new Uint8Array(usizeCount * 4 + scalarSize);
    packed.set(new Uint8Array(memory.buffer, usizePtr, usizeCount * 4));
    packed.set(new Uint8Array(memory.buffer, scalarPtr, scalarSize), usizeCount * 4);
    const data = reserve(packed.length);
    new Uint8Array(memory.buffer, data, packed.length).set(packed);
    return allocate({ tag, fields, data });
  }
  const runtime = {
    exports: {
      memory, vir_obj_scalar: n => n * 2 + 1, vir_obj_is_scalar: obj => obj & 1,
      vir_obj_scalar_value: obj => obj >>> 1, vir_obj_dec: dec,
      vir_obj_tag: obj => obj & 1 ? obj >>> 1 : heap.get(obj).tag,
      vir_obj_ctor: ctor, vir_obj_ctor_layout: ctor,
      vir_obj_ctor_scalar_data: (obj, usizeCount) => heap.get(obj).data + usizeCount * 4,
      vir_obj_uint64_value: obj => heap.get(obj).value,
      vir_obj_uint64_scalar: value => allocate({ value }),
      vir_obj_uint32_value: obj => heap.get(obj).value,
      vir_obj_usize_value: obj => heap.get(obj).value,
      vir_obj_array_size: obj => heap.get(obj).fields.length,
      vir_obj_array_get(obj, index) { const child = heap.get(obj).fields[index]; inc(child); return child; },
    },
    targetPointerBytes: () => 4, requireWasm32USize() {},
    makeObjectScalar: n => n * 2 + 1,
    makeObjectDecimal: (_symbol, value) => allocate({ value }),
    readObjectDecimal: obj => heap.get(obj).value,
    readObjectNat: obj => obj & 1 ? BigInt(obj >>> 1) : BigInt(heap.get(obj).value),
    makeObjectString: value => allocate({ value }), readObjectString: obj => heap.get(obj).value,
    makeObjectByteArray(value) { assert.ok(value instanceof Uint8Array); return allocate({ value }); },
    readObjectByteArray: obj => heap.get(obj).value,
    makeObjectUint64(value, label) { return PrimitiveObjectRuntime.prototype.makeObjectUint64.call(runtime, value, label); },
    makeObjectUint32: value => allocate({ value }), makeObjectUSize: value => allocate({ value: Number(value) }),
    readBoundedObjectScalar(obj, _label, max) { const value = obj >>> 1; assert.ok(value <= max); return value; },
    ownedObjectField(obj, index) { const child = heap.get(obj).fields[index]; inc(child); return child; },
    releaseOwnedObjects(objects) { for (const obj of objects) if (obj) dec(obj); objects.length = 0; },
    allocByteLength(size) { const result = reserve(size); buffers.add(result); return result; },
    freeBytes: pointer => { assert.ok(buffers.delete(pointer)); },
    makeObjectArrayFromOwnedElements(objects) { const obj = allocate({ fields: [...objects] }); objects.length = 0; return obj; },
    liftObjectConstructorList(obj, _label, lift, { nilTag, consTag, headIndex, tailIndex }) {
      const values = []; let cursor = obj;
      while (runtime.exports.vir_obj_tag(cursor) !== nilTag) {
        assert.equal(runtime.exports.vir_obj_tag(cursor), consTag);
        const node = heap.get(cursor); values.push(lift(node.fields[headIndex], values.length)); cursor = node.fields[tailIndex];
      }
      return values;
    },
  };
  function lower(codec, value) {
    const scratch = new ConstructorScratch(runtime);
    try { return codec.lower(value, "argument", scratch); } finally { scratch.dispose(); }
  }
  return { runtime, heap, buffers, lower, dec, set failConstructor(value) { failConstructor = value; },
    bind: pair => compileNativeValueCodec(runtime, validateBoundaryInterface(pair), jsonSafe),
    observe: obj => heap.get(obj),
  };
}
function roundtrip(pair, value) {
  const h = harness(), codec = h.bind(pair), parsed = JSON.parse(JSON.stringify(value));
  const obj = h.lower(codec, parsed);
  try { assert.deepEqual(codec.lift(obj, "result"), value); }
  finally { h.dec(obj); }
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
}

test("JSON-safe scalar and byte leaves preserve precision through ordinary JSON", () => {
  for (const pair of [nat, int, u64]) roundtrip(pair, "9007199254740993");
  roundtrip(int, "-9007199254740993"); roundtrip(nat, "0");
  roundtrip(u64, "18446744073709551615");
  roundtrip(string, "α😀 authors"); roundtrip(booleanBoundary(), true);
  roundtrip(enumBoundary("Choice", ["constructor", "other"]), "constructor");
  roundtrip(unitBoundary(), null);
  roundtrip(primitiveBoundary("byteArray", "bytes"), [0, 128, 255]);
});

test("JSON-safe Options preserve none, some none and some Unit with independent tags", () => {
  const h = harness(), codec = h.bind(option(option(nat)));
  for (const value of [{ kind: "none" }, { kind: "some", value: { kind: "none" } },
    { kind: "some", value: { kind: "some", value: "9007199254740993" } }]) {
    const obj = h.lower(codec, JSON.parse(JSON.stringify(value)));
    assert.equal(h.runtime.exports.vir_obj_tag(obj), value.kind === "none" ? 0 : 1);
    if (value.kind === "some") {
      const child = h.observe(obj).fields[0];
      assert.equal(h.runtime.exports.vir_obj_tag(child), value.value.kind === "none" ? 0 : 1);
      if (value.value.kind === "some") assert.equal(h.observe(h.observe(child).fields[0]).value, "9007199254740993");
    }
    assert.deepEqual(codec.lift(obj, "result"), value); h.dec(obj);
  }
  roundtrip(option(unitBoundary()), { kind: "some", value: null });
  assert.throws(() => h.lower(codec, null), /must be an object/);
  assert.equal(h.heap.size, 0);
});

test("recursive records and arrays directly reuse enclosing constructor bindings", () => {
  const recursive = { native: { ref: 0 }, value: { tag: "recursive" } };
  const tree = record([["label", nat], ["children", arrayBoundary(recursive.native, recursive.value)]]);
  roundtrip(tree, { label: "1", children: [{ label: "9007199254740993", children: [] }] });
  roundtrip(arrayBoundary(unitBoundary().native, unitBoundary().value), [null, null]);
  const list = objectBoundary("List", [immediateConstructor("List.nil"), objectConstructor("List.cons", {
    objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0,
  }, [nativeField("head", nat.native, { tag: "object", index: 0 }), nativeField("tail", { ref: 0 }, { tag: "object", index: 1 })])], {
    tag: "sequence", element: nat.value, chain: { nil: 0, cons: 1, head: 0, tail: 1 },
  });
  roundtrip(list, ["1", "9007199254740993"]);
});

test("packed UInt64 and Unit use the JSON-safe scalar contract", () => {
  const pair = record([["number", u64, { tag: "scalar", offset: 0, size: 8 }],
    ["unit", unitBoundary(), { tag: "scalar", offset: 8, size: 1 }],
    ["size", primitiveBoundary("unsigned", "number", { width: "usize" }), { tag: "usize", index: 0 }]],
  { objectFieldCount: 0, usizeFieldCount: 1, scalarByteSize: 9 });
  roundtrip(pair, { number: "18446744073709551615", unit: null, size: 42 });
  const h = harness(), codec = h.bind(pair);
  for (const invalid of [{ number: 42n, unit: null, size: 42 }, { number: "42", unit: undefined, size: 42 },
    { number: "42", unit: null, size: "42" }]) assert.throws(() => h.lower(codec, invalid));
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
  const boxed = objectBoundary("Wrapper", [identityConstructor("Wrapper.mk", { name: "value", type: u64.native })], {
    tag: "record", fields: [{ key: "value", path: [0], value: u64.value }],
  });
  roundtrip(boxed, { value: "9007199254740993" });
  roundtrip(record([["wrapped", boxed, { tag: "scalar", offset: 0, size: 8 }]],
    { objectFieldCount: 0, usizeFieldCount: 0, scalarByteSize: 8 }), { wrapped: { value: "9007199254740993" } });
});

test("strict JSON leaves reject coercions and clean up already constructed fields", () => {
  const h = harness(), codec = h.bind(record([["allocated", string], ["count", nat]]));
  for (const count of [1, 1n, "-1", "01", "-0", "+1", " 1", "1 ", "1\n", "1\r\n", "1e3", "1.0", ""]) {
    assert.throws(() => h.lower(codec, { allocated: "owned", count }), /canonical unsigned decimal/);
    assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
  }
  const bounded = h.bind(u64);
  assert.throws(() => h.lower(bounded, "18446744073709551616"), /out of range/);
  const bytes = h.bind(primitiveBoundary("byteArray", "bytes"));
  for (const value of [[256], [-1], [1.5], ["1"], [,], new Uint8Array([1])]) assert.throws(() => h.lower(bytes, value));
  h.failConstructor = true;
  assert.throws(() => h.lower(codec, { allocated: "owned", count: "1" }), /could not be lowered/);
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
  h.failConstructor = false;
  const obj = h.lower(codec, { allocated: "recovered", count: "2" }); h.dec(obj);
  assert.equal(h.heap.size, 0);
});

test("unsupported domains fail binding even before empty collection values are seen", () => {
  const h = harness();
  for (const pair of [resourceBoundary(), functionBoundary([nat], nat),
    primitiveBoundary("float", "number", { width: 64 }),
    { native: { type: { tag: "leanObject" } }, value: { tag: "leanReference" } }]) {
    assert.throws(() => h.bind(arrayBoundary(pair.native, pair.value)), /interface\[\].*unsupported by json-safe-v1/);
  }
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
});

test("native and JSON-safe plans cache separately within each runtime", () => {
  const pair = validateBoundaryInterface(unitBoundary());
  const a = new VirRuntime({ memory: new WebAssembly.Memory({ initial: 1 }), vir_obj_scalar: n => n * 2 + 1 });
  const b = new VirRuntime({ memory: new WebAssembly.Memory({ initial: 1 }), vir_obj_scalar: n => n * 2 + 1 });
  const normal = a.nativeValueCodec(pair), json = a.nativeValueCodec(pair, jsonSafe);
  assert.equal(a.nativeValueCodec(pair), normal);
  assert.equal(a.nativeValueCodec(pair, jsonSafe), json);
  assert.notEqual(json, normal); assert.notEqual(b.nativeValueCodec(pair, jsonSafe), json);
  assert.equal(normal.lift(1, "result"), undefined); assert.equal(json.lift(1, "result"), null);
  assert.equal(normal.lower(undefined, "argument"), 1);
  assert.throws(() => json.lower(undefined, "argument"), /null/);
  assert.throws(() => a.nativeValueCodec(pair, { representation: "unknown" }), /unsupported value representation/);
});

function checkedWrapper(pair, check) {
  return objectBoundary("Checked", [identityConstructor("Checked.mk", { name: "val", type: pair.native })], {
    tag: "record", fields: [{ key: "val", path: [0], value: pair.value, check }],
  });
}

test("Unicode scalar validation applies before coercion and through packed wrappers", () => {
  const char = checkedWrapper(primitiveBoundary("unsigned", "number", { width: 32 }), { tag: "unicodeScalar" });
  const packed = record([["char", char, { tag: "scalar", offset: 0, size: 4 }]],
    { objectFieldCount: 0, usizeFieldCount: 0, scalarByteSize: 4 });
  for (const val of [0, 0xd7ff, 0xe000, 0xfdd0, 0xffff, 0x1f600, 0x10ffff]) {
    roundtrip(char, { val }); roundtrip(packed, { char: { val } });
  }
  const h = harness(), boxedCodec = h.bind(char), packedCodec = h.bind(packed);
  for (const val of [-1, 1.5, 0xd800, 0xdfff, 0x110000, 2 ** 32, 2 ** 32 + 65, "65"]) {
    assert.throws(() => h.lower(boxedCodec, { val }), /Unicode scalar/);
    assert.throws(() => h.lower(packedCodec, { char: { val } }), /Unicode scalar/);
  }
  const invalidResult = h.runtime.makeObjectUint32(0xd800);
  try { assert.throws(() => boxedCodec.lift(invalidResult, "result"), /Unicode scalar/); }
  finally { h.dec(invalidResult); }
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
});

test("Fin bounds are explicit, exact and never modulo or clamped", () => {
  const fin = checkedWrapper(nat, { tag: "natLt", bound: "100" });
  for (const val of ["0", "99"]) roundtrip(fin, { val });
  const h = harness(), codec = h.bind(fin);
  for (const val of ["100", "101", "9007199254740993", "-1"]) assert.throws(() => h.lower(codec, { val }));
  const empty = h.bind(checkedWrapper(nat, { tag: "natLt", bound: "0" }));
  assert.throws(() => h.lower(empty, { val: "0" }), /Fin 0/);
  const large = checkedWrapper(nat, { tag: "natLt", bound: "9007199254740994" });
  roundtrip(large, { val: "9007199254740993" });
  assert.throws(() => h.lower(h.bind(large), { val: "9007199254740994" }), /Fin 9007199254740994/);
  const partial = h.bind(record([["allocated", string], ["bounded", fin]]));
  assert.throws(() => h.lower(partial, { allocated: "owned before failure", bounded: { val: "100" } }), /Fin 100/);
  const invalidResult = h.runtime.makeObjectDecimal("nat", "100");
  try { assert.throws(() => codec.lift(invalidResult, "result"), /Fin 100/); }
  finally { h.dec(invalidResult); }
  assert.equal(h.heap.size, 0);
});

test("field-check admission rejects incompatible storage domains and inexact bounds", () => {
  assert.throws(() => validateBoundaryInterface(checkedWrapper(nat, { tag: "unicodeScalar" })), /requires a UInt32 field/);
  assert.throws(() => validateBoundaryInterface(checkedWrapper(u64, { tag: "natLt", bound: "100" })), /requires a Nat field/);
  for (const bound of [100, "01", "-1", "100\n", "1e2"])
    assert.throws(() => validateBoundaryInterface(checkedWrapper(nat, { tag: "natLt", bound })), /canonical natural bound/);
});

test("primitive composition rejects an unavailable representation instead of ignoring it", () => {
  const runtime = Object.create(PrimitiveObjectRuntime.prototype);
  const pair = validateBoundaryInterface(unitBoundary());
  assert.throws(() => runtime.nativeValueCodec(pair, jsonSafe), /requires optional object conversion/);
  assert.throws(() => runtime.makeObjectValue(pair, null, "argument", jsonSafe), /requires optional object conversion/);
  assert.throws(() => runtime.liftObjectValue(pair, 1, "result", jsonSafe), /requires optional object conversion/);
});
