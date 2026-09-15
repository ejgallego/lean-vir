/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { registerHostCallRollback } from "../../web/src/host-boundary.js";
import { createVirCallback, releaseCallbackRoots } from "../../web/src/runtime/callbacks.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { HOST_IMPORT_BOUNDARY } from "../../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG as T } from "../../web/src/runtime/interface-tags.js";

const resource = { interfaceTag: T.RESOURCE };
const unit = { interfaceTag: T.UNIT };
const callback = { interfaceTag: T.FUNCTION, args: [], result: unit, effect: "runtime" };
const array = element => ({ interfaceTag: T.ARRAY, element });

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
  let nextRoot = 0;
  const runtime = Object.create(VirRuntime.prototype);
  const state = new VirHostState({ defaultHostBindings: {} });
  const exports = {
    memory: new WebAssembly.Memory({ initial: 1 }),
    vir_obj_resource_is_valid: obj => objects.has(obj) ? 1 : 0,
    vir_obj_resource_externref: obj => objects.get(obj),
    vir_obj_closure_root: () => ++nextRoot,
    vir_obj_array_size: obj => objects.get(obj).length,
    vir_obj_array_get: (obj, index) => objects.get(obj)[index],
    vir_obj_dec: obj => decremented.push(obj),
  };
  Object.assign(runtime, {
    exports, liveCallbacks: new CountedRoots(),
    releaseClosure: root => released.push(root),
    callClosure: root => root,
    makeObjectValue: lower, makeJsObjectValue: lower,
  });
  state.attach(exports);
  state.attachRuntime(runtime);
  const existing = Array.from({ length: 56 }, () => createVirCallback(runtime, ++nextRoot, callback));
  runtime.liveCallbacks.resetCounts();
  t.after(() => releaseCallbackRoots(runtime.liveCallbacks));
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
  assert.equal(h.runtime.liveCallbacks.scans, 0);
  assert.equal(h.runtime.liveCallbacks.visits, 0);
  assert.equal(h.runtime.liveCallbacks.size, 56);
  assert.deepEqual(h.released, []);
  const failure = new Error("leaf host failure");
  assert.throws(() => h.call([resource], [3], () => { throw failure; }), e => e === failure);
  assert.equal(h.runtime.liveCallbacks.scans, 0);
  assert.deepEqual(h.released, []);
  assert.equal(h.existing[0](), 1, "host failure must not release borrowed callback resources");
});

test("callback-free scalar/string/unit descriptors skip tracking on conversion calls", t => {
  const h = harness(t);
  Object.assign(h.runtime, {
    readObjectScalar: () => 1,
    readObjectDecimal: () => "1",
    readObjectString: () => "value",
  });
  Object.assign(h.runtime.exports, {
    vir_obj_uint32_value: () => 1,
    vir_obj_float_value: () => 1,
    vir_obj_float32_value: () => 1,
  });
  for (const interfaceTag of [T.UNIT, T.BOOL, T.NAT, T.INT, T.STRING,
    T.UINT8, T.UINT16, T.UINT32, T.UINT64, T.USIZE, T.FLOAT, T.FLOAT32]) {
    h.call([{ interfaceTag }], [1], () => {}, HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  }
  h.call([{ interfaceTag: T.SIMPLE_ENUM, constructors: [{ name: "zero" }, { name: "one" }] }], [1],
    value => assert.equal(value, "one"), HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  assert.equal(h.runtime.liveCallbacks.scans, 0);
  assert.deepEqual(h.released, []);
});

test("functions and nested composites still track, and successful calls retain callbacks", t => {
  const h = harness(t);
  h.objects.set(1, [2]).set(2, [3]);
  let received;
  h.call([callback, array(array(callback))], [4, 1], (...args) => { received = args; },
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  assert.equal(h.runtime.liveCallbacks.scans, 4);
  assert.equal(h.runtime.liveCallbacks.size, 58);
  assert.equal(received[0](), 57);
  assert.equal(received[1][0][0](), 58);
  assert.deepEqual(h.decremented, [3, 2]);
  assert.deepEqual(h.released, []);
});

test("even callback-free composites keep the conservative tracked path", t => {
  const h = harness(t);
  h.objects.set(1, [2]);
  h.call([array(unit)], [1], values => assert.deepEqual(values, [undefined]),
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION);
  assert.equal(h.runtime.liveCallbacks.scans, 2);
  assert.deepEqual(h.released, []);
});

test("partial composite lifting captures callbacks even when a later element is missing", t => {
  const h = harness(t);
  h.objects.set(1, [2, 0]);
  assert.throws(() => h.call([callback, array(callback)], [3, 1], () => assert.fail("host entered"),
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION), /\[1\] is unavailable/);
  assert.equal(h.runtime.liveCallbacks.scans, 4);
  assert.deepEqual(h.released, [57, 58]);
  assert.equal(h.runtime.liveCallbacks.size, 56);
  assert.deepEqual(h.decremented, [2]);
});

test("later leaf lifting failure releases earlier callbacks without a leaf scan", t => {
  const h = harness(t);
  assert.throws(() => h.call([callback, resource], [1, 404], () => assert.fail("host entered")),
    /did not lift to a live host resource/);
  assert.equal(h.runtime.liveCallbacks.scans, 2);
  assert.deepEqual(h.released, [57]);
  assert.equal(h.runtime.liveCallbacks.size, 56);
});

for (const stage of ["host", "result"]) {
  test(`${stage} error rolls back and releases earlier callbacks after leaf arguments`, t => {
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
    assert.equal(h.runtime.liveCallbacks.scans, 2);
    assert.deepEqual(h.released, [57]);
    assert.throws(() => retained(), /disposed runtime/);
    assert.equal(h.existing[0](), 1);
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
  assert.equal(h.runtime.liveCallbacks.scans, 4);
  assert.deepEqual(h.released, [57]);
  assert.equal(innerCallback(), 58);
  assert.equal(h.runtime.liveCallbacks.size, 57);
});

test("unknown descriptors keep tracked failure cleanup", t => {
  const h = harness(t);
  assert.throws(() => h.call([callback, { interfaceTag: 999 }], [1, 2], () => assert.fail("host entered"),
    HOST_IMPORT_BOUNDARY.EXPLICIT_CONVERSION), /unsupported object ABI result type/);
  assert.equal(h.runtime.liveCallbacks.scans, 4);
  assert.deepEqual(h.released, [57]);
});
