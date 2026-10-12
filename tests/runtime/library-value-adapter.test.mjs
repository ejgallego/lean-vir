/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { compileLibraryValueAdapter, compileLibraryConstructor } from "../../web/src/runtime/native-value-codecs.js";
import { validateBoundaryInterface } from "../../web/src/runtime/value-interfaces.js";
import { ConstructorScratch } from "../../web/src/runtime/constructor-scratch.js";
import {
  arrayBoundary, nativeDescriptor, nativeField, objectBoundary,
  objectConstructor, primitiveBoundary,
} from "../support/interface-fixtures.mjs";

const string = primitiveBoundary("string", "string");
const opaque = validateBoundaryInterface({ native: nativeDescriptor("leanObject"), value: { tag: "leanReference" } });
const wire = validateBoundaryInterface(arrayBoundary(string.native, string.value));
const storage = { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 };
const outcome = validateBoundaryInterface(objectBoundary("Except", [
  objectConstructor("Except.error", storage, [nativeField("a", string.native, { tag: "object", index: 0 })]),
  objectConstructor("Except.ok", storage, [nativeField("a", opaque.native, { tag: "object", index: 0 })]),
], { tag: "variant", cases: [
  { kind: "error", payload: "value", value: string.value },
  { kind: "ok", payload: "value", value: opaque.value },
] }));

// Production codecs, call-slot caching, consuming invocation, result cleanup
// and scratch. Native helper bodies/heap/reference counting are modeled.
// This tests the adapter call seam, not NameMap semantics or real Wasm.
function harness() {
  const heap = new Map(), buffers = new Set();
  const memory = new WebAssembly.Memory({ initial: 1 });
  let nextObj = 1024, nextBuffer = 64, resolved = 0, calls = 0, compiled = 0;
  let mode = "ok", failAllocation = false, failLift = false;
  const allocate = value => {
    const obj = nextObj; nextObj += 2;
    heap.set(obj, { refs: 1, ...value }); return obj;
  };
  const inc = obj => { assert.ok(heap.has(obj)); heap.get(obj).refs++; };
  const dec = obj => {
    const node = heap.get(obj); assert.ok(node, `live reference ${obj}`);
    if (--node.refs === 0) {
      heap.delete(obj);
      for (const child of node.fields ?? []) dec(child);
    }
  };
  const pointers = (ptr, count) => Array.from({ length: count }, (_, i) =>
    new DataView(memory.buffer).getUint32(ptr + 4 * i, true));
  const runtime = new VirRuntime({
    memory, vir_obj_inc: inc, vir_obj_dec: dec,
    vir_obj_tag: obj => heap.get(obj).tag,
    vir_obj_field(obj, index) {
      const field = heap.get(obj).fields[index];
      if (field === undefined) return 0;
      inc(field); return field;
    },
    vir_obj_array: (ptr, count) => allocate({ fields: pointers(ptr, count) }),
    vir_obj_array_size: obj => heap.get(obj).fields.length,
    vir_obj_array_get(obj, index) { const child = heap.get(obj).fields[index]; inc(child); return child; },
    vir_alloc_bytes(size) {
      if (failAllocation) return 0;
      const ptr = nextBuffer; nextBuffer += Math.max(8, size);
      if (nextBuffer > memory.buffer.byteLength) memory.grow(1);
      buffers.add(ptr); return ptr;
    },
    vir_free_bytes: ptr => { assert.ok(buffers.delete(ptr)); },
    vir_resolve_call_export(index) { resolved++; return mode === "resolve" ? 0 : index + 1; },
    vir_call_resolved_objects(slot, ptr, count) {
      assert.equal(count, slot === 3 ? 2 : 1); calls++;
      if (slot === 3) {
        const fields = pointers(ptr, count);
        if (mode === "null") { fields.forEach(dec); return 0; }
        // Helper takes logical order and produces a different physical order.
        return allocate({ tag: 0, fields: fields.reverse(), computed: true });
      }
      const [input] = pointers(ptr, count);
      if (mode === "null") { dec(input); return 0; }
      if (slot === 1) {
        if (mode === "error") {
          dec(input); return allocate({ tag: 0, fields: [allocate({ value: "invalid key" })] });
        }
        if (mode === "missing") { dec(input); return allocate({ tag: 1, fields: [] }); }
        return allocate({ tag: mode === "tag" ? 2 : 1,
          fields: [allocate({ fields: [input] })] });
      }
      const entries = heap.get(input).fields[0];
      inc(entries); dec(input); return entries;
    },
  });
  runtime.makeObjectString = value => allocate({ value });
  runtime.readObjectString = obj => {
    if (failLift) throw new Error("wire lift failed");
    return heap.get(obj).value;
  };
  const decode = { entry: "Map.decode", args: [{ name: "entries", type: wire }], result: outcome, effect: "pure" };
  const encode = { entry: "Map.encode", args: [{ name: "value", type: opaque }], result: wire, effect: "pure" };
  runtime.interfaceManifest = { exports: [decode, encode] };
  const bind = runtime.nativeValueCodec;
  runtime.nativeValueCodec = function (pair, options = {}) {
    const cache = options.representation === "json-safe-v1" ? this.jsonSafeValueCodecs : this.nativeValueCodecs;
    if (!cache?.has(pair)) compiled++;
    return bind.call(this, pair, options);
  };
  return { runtime, decode, encode, heap, buffers, dec,
    bind: (options = {}) => compileLibraryValueAdapter(runtime, { decode, encode }, options),
    lower(codec, value) {
      const scratch = new ConstructorScratch(runtime);
      try { return codec.lower(value, "properties", scratch); }
      finally { scratch.dispose(); }
    },
    set mode(value) { mode = value; }, set failAllocation(value) { failAllocation = value; },
    set failLift(value) { failLift = value; },
    get resolved() { return resolved; }, get calls() { return calls; }, get compiled() { return compiled; },
  };
}

for (const representation of ["native", "json-safe-v1"]) {
  test(`library adapter retains decoded values and borrows encoded values: ${representation}`, () => {
    const h = harness(), codec = h.bind({ representation });
    const obj = h.lower(codec, ["a.b", "a", "b", "", "λ🦀"]);
    assert.equal(h.heap.get(obj).refs, 1, "payload survives Except release");
    for (let i = 0; i < 100; i++) {
      assert.deepEqual(codec.lift(obj, "properties"), ["a.b", "a", "b", "", "λ🦀"]);
      assert.equal(h.heap.get(obj).refs, 1, "encoder consumes its own retained ref");
    }
    assert.equal(h.compiled, 1, "shared wire pair binds once");
    assert.equal(h.resolved, 2, "one resolved slot per helper");
    h.dec(obj);
    assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
  });
}

test("adapter errors and malformed native outcomes release inputs and recover", () => {
  const h = harness(), codec = h.bind();
  for (const [mode, expected] of [["error", /invalid key/], ["tag", /invalid Except/],
    ["missing", /field 0 is unavailable/], ["null", /object call failed/]]) {
    h.mode = mode;
    assert.throws(() => h.lower(codec, ["entry"]), expected);
    assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
  }
  h.mode = "ok";
  const obj = h.lower(codec, []); assert.deepEqual(codec.lift(obj, "empty"), []);
  h.dec(obj); assert.equal(h.heap.size, 0);
  const unresolved = harness(), fresh = unresolved.bind();
  unresolved.mode = "resolve";
  assert.throws(() => unresolved.lower(fresh, ["entry"]), /call entry not found/);
  assert.equal(unresolved.heap.size, 0); assert.equal(unresolved.buffers.size, 0);
});

test("argv allocation and output lifting failures preserve the caller's map", () => {
  const h = harness(), codec = h.bind();
  h.failAllocation = true;
  assert.throws(() => h.lower(codec, ["first", "second"]), /allocation failed/);
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
  h.failAllocation = false;
  const obj = h.lower(codec, ["value"]);
  for (const [setting, expected] of [["failAllocation", /allocation failed/], ["failLift", /wire lift failed/]]) {
    h[setting] = true;
    assert.throws(() => codec.lift(obj, "properties"), expected);
    assert.equal(h.heap.get(obj).refs, 1);
    assert.equal(h.buffers.size, 0);
    h[setting] = false;
  }
  assert.deepEqual(codec.lift(obj, "properties"), ["value"]);
  h.dec(obj); assert.equal(h.heap.size, 0);
});

test("helper plans reject foreign entries, effects, incompatible domains and disposed runtimes", () => {
  const first = harness(), second = harness();
  assert.throws(() => compileLibraryValueAdapter(first.runtime,
    { decode: second.decode, encode: first.encode }), /does not belong/);
  first.decode.effect = "io";
  assert.throws(() => first.bind(), /pure wire/);
  first.decode.effect = "pure";
  first.encode.result = string;
  assert.throws(() => first.bind(), /domains disagree/);
  first.encode.result = wire;
  const codec = first.bind();
  first.runtime.dispose();
  assert.throws(() => first.lower(codec, []), /disposed/);
  assert.throws(() => compileLibraryValueAdapter(first.runtime,
    { decode: first.decode, encode: first.encode }), /disposed/);
  assert.equal(first.heap.size, 0);
});

const computed = validateBoundaryInterface(objectBoundary("Computed", [objectConstructor("Computed.mk", {
  objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 8,
}, [nativeField("left", string.native, { tag: "object", index: 1 }),
  nativeField("right", string.native, { tag: "object", index: 0 })])], {
  tag: "record", fields: [{ key: "left", path: [0], value: string.value },
    { key: "right", path: [1], value: string.value }],
}));
computed.native.metadata.constructors[0].operation = "s436f6d7075746564/s6d6b/";

function constructed(h) {
  const entry = { entry: "Computed.mk", nameKey: computed.native.metadata.constructors[0].operation,
    args: [{ type: opaque }, { type: opaque }], result: opaque, effect: "pure" };
  h.runtime.interfaceManifest.constructorOperations = [entry];
  return h.runtime.nativeValueCodec(computed);
}

test("constructor operations consume logical fields and preserve computed runtime construction", () => {
  const h = harness(), codec = constructed(h), value = { left: "first", right: "second" };
  for (let i = 0; i < 20; i++) {
    const obj = h.lower(codec, value);
    assert.equal(h.heap.get(obj).computed, true);
    assert.equal(h.heap.get(obj).refs, 1);
    assert.deepEqual(codec.lift(obj, "result"), value);
    h.dec(obj);
  }
  assert.equal(h.resolved, 1); assert.equal(h.compiled, 1);
  assert.equal(h.heap.size, 0); assert.equal(h.buffers.size, 0);
});

test("constructor operation failures respect the native transfer point", () => {
  for (const mode of ["resolve", "null", "allocation", "later-field"]) {
    const h = harness(), codec = constructed(h);
    h.mode = mode; h.failAllocation = mode === "allocation";
    const makeString = h.runtime.makeObjectString;
    h.runtime.makeObjectString = value => {
      if (mode === "later-field" && value === "second") throw new Error("later field rejected");
      return makeString(value);
    };
    assert.throws(() => h.lower(codec, { left: "first", right: "second" }));
    assert.equal(h.heap.size, 0, mode); assert.equal(h.buffers.size, 0, mode);
    h.mode = "ok"; h.failAllocation = false; h.runtime.makeObjectString = makeString;
    const obj = h.lower(codec, { left: "recovered", right: "value" });
    h.dec(obj); assert.equal(h.heap.size, 0);
  }
});

test("constructor operations require this runtime's pure opaque helper and correct arity", () => {
  const h = harness();
  assert.throws(() => compileLibraryConstructor(h.runtime, harness().encode), /does not belong/);
  h.encode.effect = "io";
  assert.throws(() => compileLibraryConstructor(h.runtime, h.encode), /pure opaque/);
  constructed(h);
  const operation = h.runtime.nativeConstructorOperations.get(computed.native.metadata.constructors[0]);
  assert.throws(() => operation([], "constructor"), /argument count/);
  assert.equal(h.calls, 0);
});

test("required construction never falls back to raw allocation", () => {
  const h = harness();
  assert.throws(() => h.runtime.nativeValueCodec(computed), /requires its constructor operation/);
  assert.equal(h.calls, 0); assert.equal(h.heap.size, 0);
});
