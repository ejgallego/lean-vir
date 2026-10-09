/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { countLiveCallbacks } from "../support/lean-ownership.js";

import assert from "node:assert/strict";
import test from "node:test";
import { registerHostCallRollback } from "../../web/src/host-boundary.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { HOST_IMPORT_BOUNDARY } from "../../web/src/runtime/interface-manifest.js";
import {
  arrayBoundary,
  booleanBoundary,
  boundary,
  enumBoundary,
  functionBoundary,
  nativeDescriptor,
  resourceBoundary,
  unitBoundary,
} from "../support/interface-fixtures.mjs";

const resource = resourceBoundary();
const unit = unitBoundary();
const callback = functionBoundary([], unit, "runtime");
const nat = boundary(nativeDescriptor("nat"), { tag: "bigint" });
const int = boundary(nativeDescriptor("int"), { tag: "bigint" });
const string = boundary(nativeDescriptor("string"), { tag: "string" });
const unsigned = (width) => boundary(
  nativeDescriptor("unsigned", { width }),
  { tag: width === 64 ? "bigint" : "number" },
);
const floating = (width) => boundary(
  nativeDescriptor("float", { width }),
  { tag: "number" },
);
const array = (element) => arrayBoundary(element.native, element.value);

// Count registry traversals without instrumentation in production code.
class CountedRoots extends Set {
  scans = 0;
  visits = 0;
  *[Symbol.iterator]() {
    this.scans++;
    for (const root of super[Symbol.iterator]()) {
      this.visits++;
      yield root;
    }
  }
  resetCounts() { this.scans = 0; this.visits = 0; }
}

// Use the real lifter and callback bridge; mock only the Wasm object primitives.
function harness(t, { lower = () => 1 } = {}) {
  const objects = new Map();
  const released = [];
  const decremented = [];
  let nextObject = 0;
  const runtime = Object.create(VirRuntime.prototype);
  const state = new VirHostState({ defaultHostBindings: {} });
  const exports = {
    memory: new WebAssembly.Memory({ initial: 1 }),
    vir_obj_resource_is_valid: obj => objects.has(obj) ? 1 : 0,
    vir_obj_resource_externref: obj => objects.get(obj),
    vir_obj_inc: () => {},
    vir_obj_array_size: obj => objects.get(obj).length,
    vir_obj_array_get: (obj, index) => objects.get(obj)[index],
    vir_obj_dec: obj => decremented.push(obj),
    vir_obj_scalar: ordinal => ordinal + 1,
  };
  Object.assign(runtime, {
    exports, hostState: state,
    releaseLeanObjectHandleCell(cell) {
      if (cell.live) released.push(cell.object);
      return VirRuntime.prototype.releaseLeanObjectHandleCell.call(this, cell);
    },
    callClosure: cell => cell.object,
    makeObjectValue: lower, makeJsObjectValue: lower,
  });
  state.attach(exports);
  state.attachRuntime(runtime);
  state.leanObjectHandleCells = new CountedRoots();
  const existing = Array.from({ length: 56 }, () => runtime.liftObjectFunction(callback, ++nextObject, "existing callback"));
  runtime.hostState.leanObjectHandleCells.resetCounts();
  t.after(() => state.dispose());
  return {
    runtime, objects, released, decremented, existing,
    call(types, args, binding, boundary = HOST_IMPORT_BOUNDARY.HOST_IMPORT) {
      const slot = state.hostImports.length;
      state.hostImports.push({ target: `test.${slot}`, boundary,
        args: types.map((type, i) => ({ name: `arg${i}`, type })), result: unit });
      state.defaultBindings[`test.${slot}`] = binding;
      args.forEach((obj, i) => new DataView(exports.memory.buffer).setUint32(4 + i * 4, obj, true));
      return state.callObjectsImpl(slot, 4, args.length);
    },
  };
}

test("three existing resources do not traverse any of 56 callback roots", t => {
  const h = harness(t);
  const object = {};
  h.objects.set(1, object).set(2, "field").set(3, h.existing[0]);
  h.call([resource, resource, resource], [1, 2, 3], (receiver, key, value) => { receiver[key] = value; });
  assert.equal(object.field, h.existing[0], "a resource may already contain a callback without creating one");
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.visits, 0);
  assert.equal(countLiveCallbacks(h.runtime.hostState), 56);
  assert.deepEqual(h.released, []);
  const failure = new Error("host failure");
  assert.throws(() => h.call([resource], [3], () => { throw failure; }), e => e === failure);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.deepEqual(h.released, []);
  assert.equal(h.existing[0](), 1, "host failure must not release borrowed callback resources");
});

test("explicit scalar conversions do not traverse callback roots", t => {
  const h = harness(t);
  Object.assign(h.runtime, {
    readObjectScalar: () => 1,
    readObjectDecimal: () => "1",
    readObjectString: () => "value",
  });
  Object.assign(h.runtime.exports, {
    vir_obj_uint32_value: () => 1,
    vir_obj_uint64_value: () => 1n,
    vir_obj_usize_value: () => 1,
    vir_upstream_target_pointer_bytes: () => 4,
    vir_obj_float_value: () => 1,
    vir_obj_float32_value: () => 1,
  });
  for (const type of [unit, booleanBoundary(), nat, int, string,
    unsigned(8), unsigned(16), unsigned(32), unsigned(64), unsigned("usize"),
    floating(64), floating(32)]) {
    h.call([type], [1], () => {}, HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  }
  h.call([enumBoundary("Example.Enum", ["zero", "one"])], [2],
    value => assert.equal(value, "one"), HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.deepEqual(h.released, []);
});

test("functions and nested composites retain callbacks without a registry census", t => {
  const h = harness(t);
  h.objects.set(1, [2]).set(2, [3]);
  let received;
  h.call([callback, array(array(callback))], [4, 1], (...args) => { received = args; },
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.equal(countLiveCallbacks(h.runtime.hostState), 58);
  assert.equal(received[0](), 4);
  assert.equal(received[1][0][0](), 3);
  assert.deepEqual(h.decremented, [3, 2]);
  assert.deepEqual(h.released, []);
});

test("callback-free composites need no registry census either", t => {
  const h = harness(t);
  h.objects.set(1, [1]);
  h.call([array(unit)], [1], values => assert.deepEqual(values, [undefined]),
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.deepEqual(h.released, []);
});

test("partial composite failure releases temporary objects without a callback census", t => {
  const h = harness(t);
  h.objects.set(1, [2, 0]);
  assert.throws(() => h.call([callback, array(callback)], [3, 1], () => assert.fail("host entered"),
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION), /\[1\] is unavailable/);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.deepEqual(h.released, []);
  assert.equal(countLiveCallbacks(h.runtime.hostState), 58, "foreign roots await GC or explicit disposal");
  assert.deepEqual(h.decremented, [2]);
});

test("later lifting failure leaves callback reclamation to reachability", t => {
  const h = harness(t);
  assert.throws(() => h.call([callback, resource], [1, 404], () => assert.fail("host entered")),
    /did not lift to a live host resource/);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.deepEqual(h.released, []);
  assert.equal(countLiveCallbacks(h.runtime.hostState), 57);
});

for (const stage of ["host", "result"]) {
  test(`${stage} error rolls back effects without invalidating escaped callbacks`, t => {
    const error = new Error(stage);
    const h = harness(t, { lower: () => { if (stage === "result") throw error; return 1; } });
    h.objects.set(1, {});
    let retained;
    const events = [];
    assert.throws(() => h.call([callback, resource], [2, 1], fn => {
      retained = fn;
      assert.equal(registerHostCallRollback(() => events.push("rollback")), true);
      if (stage === "host") throw error;
    }), e => e === error);
    assert.deepEqual(events, ["rollback"]);
    assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
    assert.deepEqual(h.released, []);
    assert.equal(retained(), 2);
    assert.equal(h.existing[0](), 1);
    h.runtime.hostState.releaseLeanObjectHandleCells();
    assert.throws(() => retained(), /disposed runtime/);
    assert.equal(countLiveCallbacks(h.runtime.hostState), 0);
    assert.equal(h.released.length, 57, "each independent owner releases once, including shared function pointers");
  });
}

test("reentrant successful calls retain their own callbacks when the outer host fails", t => {
  const h = harness(t);
  h.objects.set(1, {});
  const events = [];
  let innerCallback;
  const failure = new Error("outer");
  assert.throws(() => h.call([callback, resource], [2, 1], () => {
    registerHostCallRollback(() => events.push("outer"));
    h.call([resource, callback], [1, 3], (_value, fn) => {
      innerCallback = fn;
      registerHostCallRollback(() => events.push("inner"));
    });
    throw failure;
  }), error => error === failure);
  assert.deepEqual(events, ["outer"]);
  assert.equal(h.runtime.hostState.leanObjectHandleCells.scans, 0);
  assert.deepEqual(h.released, []);
  assert.equal(innerCallback(), 3);
  assert.equal(countLiveCallbacks(h.runtime.hostState), 58);
});

for (const fail of [false, true]) {
  test(`callback result conversion ${fail ? "failure" : "success"} releases Lean temporaries, not functions`, t => {
    const h = harness(t);
    h.objects.set(1, fail ? [2, 0] : [2]);
    h.runtime.exports.vir_closure_apply_objects = () => 1;
    const invoke = () => VirRuntime.prototype.callClosure.call(h.runtime,
      { runtime: h.runtime, object: 60, live: true,
      callType: functionBoundary([], array(callback)) }, [],
    );
    if (fail) {
      assert.throws(invoke, /\[1\] is unavailable/);
    } else {
      assert.equal(invoke()[0](), 2);
    }
    assert.deepEqual(h.decremented, [2, 1], "element and outer result each released once");
    assert.deepEqual(h.released, [], "foreign closure follows reachability, not result success");
    assert.equal(countLiveCallbacks(h.runtime.hostState), 57);
  });
}
