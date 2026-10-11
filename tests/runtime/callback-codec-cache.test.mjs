/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { validateBoundaryInterface } from "../../web/src/runtime/value-interfaces.js";
import {
  functionBoundary, immediateConstructor, nativeField, objectBoundary,
  objectConstructor, primitiveBoundary,
} from "../support/interface-fixtures.mjs";

const nat = primitiveBoundary("nat", "bigint");
const row = objectBoundary("Row", [objectConstructor("Row.mk", {
  objectFieldCount: 32, usizeFieldCount: 0, scalarByteSize: 0,
}, Array.from({ length: 32 }, (_, index) => nativeField(`field${index}`, nat.native, { tag: "object", index })))], {
  tag: "record", fields: Array.from({ length: 32 }, (_, index) => ({
    key: `field${index}`, path: [index], value: nat.value,
  })),
});
const list = objectBoundary("List", [immediateConstructor("List.nil"), objectConstructor("List.cons", {
  objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0,
}, [nativeField("head", row.native, { tag: "object", index: 0 }),
  nativeField("tail", { ref: 0 }, { tag: "object", index: 1 })])], {
  tag: "sequence", chain: { nil: 0, cons: 1, head: 0, tail: 1 }, element: row.value,
});
const type = validateBoundaryInterface(functionBoundary([list], list));

// Exercise real lifting, closure invocation, codec compilation and ownership.
// Only the native ABI is modeled; the empty list avoids allocating Row data.
function harness() {
  const hostState = new VirHostState();
  const decrements = [], increments = [];
  let calls = 0, compiled = 0;
  const memory = new WebAssembly.Memory({ initial: 1 });
  const runtime = new VirRuntime({
    memory,
    vir_obj_scalar: ordinal => ordinal * 2 + 1,
    vir_obj_is_scalar: obj => obj & 1,
    vir_obj_scalar_value: obj => obj >>> 1,
    vir_obj_inc: obj => increments.push(obj),
    vir_obj_dec: obj => decrements.push(obj),
    vir_alloc_bytes: () => 64,
    vir_free_bytes() {},
    vir_closure_apply_objects(_closure, _effect, argv, argc) {
      assert.equal(argc, 1);
      assert.equal(new DataView(memory.buffer).getUint32(argv, true), 1);
      calls++;
      return 1;
    },
  }, { hostState });
  const bind = runtime.nativeValueCodec;
  runtime.nativeValueCodec = function (pair) {
    if (!this.nativeValueCodecs?.has(pair)) compiled++;
    return bind.call(this, pair);
  };
  return { runtime, hostState, increments, decrements,
    get calls() { return calls; }, get compiled() { return compiled; } };
}

test("returned structural callbacks bind once per callable type in each runtime", () => {
  const first = harness(), second = harness();
  const callback = first.runtime.liftObjectValue(type, 1024, "callback");
  const sibling = first.runtime.liftObjectValue(type, 2048, "callback");
  try {
    assert.equal(first.compiled, 1, "the callable codec is shared at initial lifting");
    assert.deepEqual(callback([]), []);
    assert.equal(first.compiled, 3, "bind the callable plus one argument and one result codec");
    for (let i = 0; i < 100; i++) assert.deepEqual(callback([]), []);
    for (let i = 0; i < 100; i++) assert.deepEqual(sibling([]), []);
    assert.equal(first.compiled, 3, "no descriptor work for repeated or sibling callback calls");
    assert.equal(first.calls, 201);
    assert.equal(first.hostState.leanObjectHandleCells.size, 2);
    const other = second.runtime.liftObjectValue(type, 1024, "other runtime callback");
    assert.deepEqual(other([]), []);
    assert.equal(second.compiled, 3, "shared descriptor inputs do not share runtime-bound codecs");
    assert.equal(first.compiled, 3);
  } finally { first.runtime.dispose(); second.runtime.dispose(); }
  assert.deepEqual(first.increments, [1024, 2048]);
  assert.deepEqual(first.decrements.filter(obj => obj !== 1), [1024, 2048]);
  assert.equal(first.hostState.leanObjectHandleCells.size, 0);
  assert.throws(() => callback([]), /disposed runtime/);
});
