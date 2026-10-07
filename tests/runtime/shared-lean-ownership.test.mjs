/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { INTERFACE_TAG as T } from "../../web/src/runtime/interface-tags.js";

const type = { args: [], result: { interfaceTag: T.UNIT }, effect: "pure" };

function harness() {
  const increments = [], decrements = [];
  const state = new VirHostState();
  const runtime = new VirRuntime({
    memory: new WebAssembly.Memory({ initial: 1 }),
    vir_obj_inc: ptr => increments.push(ptr),
    vir_obj_dec: ptr => decrements.push(ptr),
  }, { hostState: state });
  runtime.callClosure = cell => runtime.requireLiveLeanObjectCell(cell, "callback").object;
  return { runtime, state, increments, decrements };
}

test("JSL and callable targets share tracking and retirement but keep their admission", () => {
  const { runtime, state, increments, decrements } = harness();
  const jsl = runtime.makeLeanObjectHandleResource(100, "JSL");
  const callback = runtime.liftObjectFunction(type, 200, "callback");
  assert.deepEqual(increments, [100, 200]);
  assert.equal(state.leanObjectHandleCells.size, 2);
  assert.equal(runtime.liveCallbackCount(), 1);
  assert.throws(() => runtime.leanObjectHandleCell(callback, "JSL"), /live Lean object handle/);
  assert.throws(() => runtime.leanCallbackCell(jsl, "callback"), /live Lean callback/);
  runtime.dispose(); runtime.dispose();
  assert.deepEqual(decrements, [100, 200]);
  assert.equal(state.leanObjectHandleCells.size, 0);
  assert.equal(state.liveCallbackCount, 0);
  assert.throws(() => callback(), /disposed runtime/);
});

test("independent wrappers release independently before simulated pointer reuse", () => {
  const { runtime, state, increments, decrements } = harness();
  const first = runtime.liftObjectFunction(type, 100, "callback");
  const second = runtime.liftObjectFunction(type, 100, "callback");
  const old = runtime.leanCallbackCell(first, "first");
  assert.equal(runtime.releaseLeanObjectHandleCell(old), true);
  assert.throws(() => first(), /disposed runtime/);
  assert.equal(second(), 100);
  const other = harness();
  assert.throws(() => other.runtime.requireLiveLeanObjectCell(old, "foreign"), /live Lean object handle/);
  assert.throws(() => other.runtime.requireLiveLeanObjectCell(runtime.leanCallbackCell(second, "second"), "foreign"), /live Lean object handle/);
  runtime.releaseLeanObjectHandleCell(runtime.leanCallbackCell(second, "second"));
  assert.throws(() => second(), /disposed runtime/);
  assert.equal(state.liveCallbackCount, 0);
  // The mock explicitly simulates a new allocation at the now-released address.
  const reused = runtime.liftObjectFunction(type, 100, "reused callback");
  assert.equal(runtime.releaseLeanObjectHandleCell(old), false);
  assert.equal(reused(), 100);
  assert.equal(state.liveCallbackCount, 1);
  assert.deepEqual(increments, [100, 100, 100]);
  assert.deepEqual(decrements, [100, 100]);
  runtime.dispose(); other.runtime.dispose();
  assert.deepEqual(decrements, [100, 100, 100]);
});

test("unpublished callback creation rolls back the shared owner", () => {
  const { runtime, state, increments, decrements } = harness();
  const error = new Error("target registration failed");
  runtime.attachLeanObjectHandle = () => { throw error; };
  assert.throws(() => runtime.liftObjectFunction(type, 100, "callback"), e => e === error);
  assert.deepEqual(increments, [100]);
  assert.deepEqual(decrements, [100]);
  assert.equal(state.leanObjectHandleCells.size, 0);
  assert.equal(state.liveCallbackCount, 0);
  runtime.dispose();
});

test("native release and untracking errors are both retained without repeating cleanup", () => {
  const { runtime, state } = harness();
  const callback = runtime.liftObjectFunction(type, 100, "callback");
  const cell = runtime.leanCallbackCell(callback, "callback");
  const native = new Error("native release"), tracking = new Error("untracking");
  const untrack = cell.onRelease;
  cell.onRelease = () => { untrack(); throw tracking; };
  runtime.exports = { ...runtime.exports, vir_obj_dec: () => { throw native; } };
  assert.throws(() => runtime.releaseLeanObjectHandleCell(cell), error =>
    error instanceof AggregateError && error.errors[0] === native && error.errors[1] === tracking);
  assert.equal(cell.live, false);
  assert.equal(state.leanObjectHandleCells.size, 0);
  assert.equal(state.liveCallbackCount, 0);
  assert.equal(runtime.releaseLeanObjectHandleCell(cell), false);
  runtime.dispose();
});

test("argument conversion cannot enter a callback whose owner retired during preparation", () => {
  const { runtime, decrements } = harness();
  delete runtime.callClosure;
  const callType = { ...type, args: [{ name: "value", type: { interfaceTag: T.UNIT } }] };
  const callback = runtime.liftObjectFunction(callType, 100, "callback");
  const cell = runtime.leanCallbackCell(callback, "callback");
  let entered = 0;
  runtime.exports.vir_closure_apply_objects = () => { entered++; return 0; };
  runtime.makeObjectValue = () => { runtime.releaseLeanObjectHandleCell(cell); return 200; };
  assert.throws(() => callback(undefined), /live Lean object handle/);
  assert.equal(entered, 0);
  assert.deepEqual(decrements, [100, 200], "untransferred arguments are still released");
  runtime.dispose();
});
