/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";
import { ObjectValueRuntime } from "../../web/src/runtime/object-values.js";

test("literal construction defines own data properties; ordinary assignment and push stay native", () => {
  const b = createJsCollectionHostBindings();
  const prototype = {};
  let calls = 0;
  Object.defineProperty(prototype, "field", { set() { calls++; }, configurable: true });
  const object = Object.create(prototype);
  b["js.object.set"](object, "field", "assigned");
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(object, "field"), false);
  b["js.construction.field"](object, "field", "first");
  b["js.construction.field"](object, "field", "last");
  assert.equal(calls, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(object, "field"), {
    value: "last", writable: true, enumerable: true, configurable: true,
  });
  const arrayPrototype = Object.create(Array.prototype);
  Object.defineProperty(arrayPrototype, "0", { set() { calls++; }, configurable: true });
  const assigned = Object.setPrototypeOf([], arrayPrototype);
  b["js.array.push"](assigned, "assigned");
  assert.equal(calls, 2);
  assert.equal(Object.hasOwn(assigned, "0"), false);
  const array = Object.setPrototypeOf([], arrayPrototype);
  array.push = () => { throw new Error("literal must not call push"); };
  b["js.construction.element"](array, "first");
  b["js.construction.element"](array, "second");
  assert.equal(calls, 2);
  assert.equal(array.length, 2);
  assert.equal(array[0], "first");
  assert.equal(array[1], "second");
  assert.throws(() => b["js.construction.field"](Object.freeze({}), "field", "x"), TypeError);
  assert.throws(() => b["js.construction.element"](Object.freeze([]), "x"), TypeError);
});

test("one-call JSX constructors publish exact dense arrays and fresh own-data props", () => {
  const bindings = createJsCollectionHostBindings();
  const array = [undefined, null, {}];
  assert.equal(bindings["js.construction.arrayFromValues"](array), array,
    "the structural lift already created the native array");
  const value = {};
  const first = bindings["js.construction.objectFromFields"]([
    { fst: "__proto__", snd: value },
    { fst: "name", snd: undefined },
    { fst: "name", snd: value },
  ]);
  const second = bindings["js.construction.objectFromFields"]([]);
  assert.notEqual(first, second);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.getPrototypeOf(second), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(first, "__proto__"), {
    value, writable: true, enumerable: true, configurable: true,
  });
  assert.deepEqual(Object.getOwnPropertyDescriptor(first, "name"), {
    value, writable: true, enumerable: true, configurable: true,
  });
  assert.deepEqual(Object.keys(first), ["__proto__", "name"]);
  const presentUndefined = bindings["js.construction.objectFromFields"]([
    { fst: "name", snd: undefined },
  ]);
  assert.equal(Object.hasOwn(presentUndefined, "name"), true);
  assert.equal(Object.hasOwn(second, "name"), false);
});

test("batched JSX props do not consult a mutable array iterator", () => {
  const construct = createJsCollectionHostBindings()["js.construction.objectFromFields"];
  const iterate = Array.prototype[Symbol.iterator];
  let props;
  try {
    Array.prototype[Symbol.iterator] = function* () {
      if (this[0]?.fst === "title") return;
      yield* iterate.call(this);
    };
    props = construct([{ fst: "title", snd: "expected" }]);
  } finally {
    Array.prototype[Symbol.iterator] = iterate;
  }
  assert.equal(props.title, "expected",
    "compiler-owned fields must be visited by index, as object literals do not use array iteration");
});

test("structural array lifting creates dense own elements and releases borrowed fields on failure", () => {
  const released = [];
  const pointers = new Map([[1, [11, 12, 13]]]);
  const runtime = Object.create(ObjectValueRuntime.prototype);
  runtime.exports = {
    vir_obj_array_size: pointer => pointers.get(pointer).length,
    vir_obj_array_get: (pointer, index) => pointers.get(pointer)[index],
    vir_obj_dec: pointer => Object.defineProperty(released, released.length, {
      __proto__: null, value: pointer, writable: true, enumerable: true, configurable: true,
    }),
  };
  const type = { element: { interfaceTag: 1 } };
  const originalLift = runtime.liftObjectValue;
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let setterCalls = 0;
  try {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true, set() { setterCalls++; },
    });
    runtime.liftObjectValue = (_type, pointer) => pointer;
    const values = runtime.liftObjectArrayValue(type, 1, "test");
    assert.deepEqual(values, [11, 12, 13]);
    assert.equal(setterCalls, 0);
    assert.equal(values.length, 3);
    for (let index = 0; index < 3; index++) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(values, String(index)), {
        value: 11 + index, writable: true, enumerable: true, configurable: true,
      });
    }
    assert.deepEqual(released, [11, 12, 13]);
    const sentinel = new Error("structural lift failed");
    runtime.liftObjectValue = (_type, pointer) => {
      if (pointer === 12) throw sentinel;
      return pointer;
    };
    assert.throws(() => runtime.liftObjectArrayValue(type, 1, "test"),
      error => error === sentinel);
    assert.deepEqual(released, [11, 12, 13, 11, 12],
      "the failing field is released once; later fields are not read");
    const defineProperty = Object.defineProperty;
    const definitionFailure = new Error("structural array definition failed");
    runtime.liftObjectValue = (_type, pointer) => pointer;
    try {
      Object.defineProperty = (target, name, descriptor) => {
        if (target !== released && Array.isArray(target) && name === 1 && descriptor.value === 12)
          throw definitionFailure;
        return defineProperty(target, name, descriptor);
      };
      assert.throws(() => runtime.liftObjectArrayValue(type, 1, "test"),
        error => error === definitionFailure);
    } finally {
      Object.defineProperty = defineProperty;
    }
    assert.deepEqual(released, [11, 12, 13, 11, 12, 11, 12],
      "the failed definition releases its borrowed element once; later elements are not read");
    assert.equal(setterCalls, 0);
  } finally {
    runtime.liftObjectValue = originalLift;
    if (previous) Object.defineProperty(Array.prototype, "0", previous);
    else delete Array.prototype["0"];
  }
});

test("typed collection providers preserve native values, identity and index absence", () => {
  const bindings = createJsCollectionHostBindings();
  const array = bindings["js.array.empty"]();
  const item = {};
  assert.equal(bindings["js.array.push"](array, item), 1);
  assert.equal(bindings["js.array.item"](array, 0), item);
  assert.equal(bindings["js.array.item"](array, 1), undefined);
  const sparse = new Array(1);
  assert.equal(bindings["js.array.item"](sparse, 0), undefined);
  const callback = () => {};
  const tuple = [item, callback];
  assert.equal(bindings["js.tuple2.first"](tuple), item);
  assert.equal(bindings["js.tuple2.second"](tuple), callback);
  assert.deepEqual(tuple, [item, callback]);
  const ternary = (value, index, source) => [value, index, source];
  assert.equal(bindings["js.value.function.ternary"](ternary), ternary);
});

test("Array.map provider delegates directly to the native callback and result semantics", () => {
  const map = createJsCollectionHostBindings()["js.array.map"];
  class Mapped extends Array {}
  class Source extends Array {
    static get [Symbol.species]() { return Mapped; }
  }
  const source = new Source(2);
  source[1] = "present";
  const calls = [];
  const mapped = map(source, (value, index, callbackSource) => {
    calls.push([value, index, callbackSource]);
    callbackSource.push("added after initial length");
    return `${index}:${value}`;
  });
  assert.ok(mapped instanceof Mapped, "native ArraySpeciesCreate chooses the result");
  assert.equal(mapped.length, 2);
  assert.equal(0 in mapped, false, "native holes remain holes");
  assert.equal(mapped[1], "1:present");
  assert.deepEqual(calls, [["present", 1, source]], "native map supplies index and source and snapshots length");

  const error = new Error("native callback identity");
  assert.throws(() => map(["value"], () => { throw error; }), (caught) => caught === error);
  const callback = () => {};
  const result = [];
  const receiver = { map(fn) {
    assert.equal(this, receiver);
    assert.equal(fn, callback);
    assert.equal(arguments.length, 1);
    return result;
  } };
  assert.equal(map(receiver, callback), result, "no wrapper changes receiver, callback or result identity");
});
