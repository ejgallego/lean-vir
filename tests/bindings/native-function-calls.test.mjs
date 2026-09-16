/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";

const bindings = createJsCollectionHostBindings();

test("native function calls use their exact arity and plain-call receiver", () => {
  const calls = [];
  const nullary = function () {
    calls.push(["nullary", arguments.length, this]);
    return "nullary result";
  };
  const binary = function (first, second) {
    calls.push(["binary", arguments.length, first, second, this]);
    return { first, second };
  };
  const ternary = function (first, second, third) {
    calls.push(["ternary", arguments.length, first, second, third, this]);
    return [first, second, third];
  };

  assert.equal(bindings["js.function.call0"](nullary), "nullary result");
  const binaryResult = bindings["js.function.call2"](binary, "first", undefined);
  assert.deepEqual(binaryResult, { first: "first", second: undefined });
  const ternaryResult = bindings["js.function.call3"](ternary, 1, 2, 3);
  assert.deepEqual(ternaryResult, [1, 2, 3]);
  assert.deepEqual(calls, [
    ["nullary", 0, undefined],
    ["binary", 2, "first", undefined, undefined],
    ["ternary", 3, 1, 2, 3, undefined],
  ]);
});

test("native function calls preserve values, promises, undefined, and errors", async () => {
  const value = { exact: true };
  const promise = Promise.resolve(value);
  const error = new Error("exact error");
  assert.equal(bindings["js.function.call0"](() => value), value);
  assert.equal(bindings["js.function.call0"](() => promise), promise);
  assert.equal(await bindings["js.function.call0"](() => promise), value);
  assert.equal(bindings["js.function.call2"](() => undefined, value, promise), undefined);
  assert.throws(() => bindings["js.function.call3"](() => { throw error; }, 1, 2, 3), caught => caught === error);
});

test("void native function calls discard their return while preserving exact invocation", () => {
  const calls = [];
  const value = { ignored: true };
  const nullary = function () { calls.push([arguments.length, this]); return value; };
  const binary = function (first, second) { calls.push([arguments.length, first, second, this]); return value; };
  const ternary = function (first, second, third) { calls.push([arguments.length, first, second, third, this]); return value; };

  assert.equal(bindings["js.function.call0Void"](nullary), undefined);
  assert.equal(bindings["js.function.call2Void"](binary, "first", undefined), undefined);
  assert.equal(bindings["js.function.call3Void"](ternary, 1, 2, 3), undefined);
  assert.deepEqual(calls, [
    [0, undefined],
    [2, "first", undefined, undefined],
    [3, 1, 2, 3, undefined],
  ]);
  assert.throws(() => bindings["js.function.call2Void"](() => { throw value; }, 1, 2), caught => caught === value);
});
