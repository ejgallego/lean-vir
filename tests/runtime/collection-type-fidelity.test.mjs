/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";

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
