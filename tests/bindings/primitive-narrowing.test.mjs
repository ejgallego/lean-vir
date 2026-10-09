/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { renderLeanBindings } from "../../scripts/bindings/typescript-to-lean.mjs";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";

const bindings = createJsValueHostBindings();
const config = await loadBindingConfig(new URL("../../Vir/Js.bindings.json", import.meta.url).pathname);
const targets = [
  "js.string.isString", "js.number.isNumber", "js.boolean.isBoolean",
  "js.string.fromAny", "js.number.fromAny", "js.boolean.fromAny",
];
const generation = {
  ...config.generation,
  protocolOperations: config.generation.protocolOperations.filter((operation) => targets.includes(operation.target)),
};
const render = (policy = generation) => renderLeanBindings(config, policy, new Map());
const operation = (policy, target) => policy.protocolOperations.find((entry) => entry.target === target);

test("primitive narrowing predicates accept only primitive exact kinds", () => {
  for (const value of ["", "\ud800", "text"]) assert.equal(bindings["js.string.isString"](value), true);
  for (const value of [-0, NaN, Infinity, -Infinity, 0]) assert.equal(bindings["js.number.isNumber"](value), true);
  assert.equal(bindings["js.boolean.isBoolean"](false), true);
  assert.equal(bindings["js.boolean.isBoolean"](true), true);

  for (const value of [new String("text"), new Number(1), new Boolean(false), null, undefined, {}, []]) {
    assert.equal(bindings["js.string.isString"](value), false);
    assert.equal(bindings["js.number.isNumber"](value), false);
    assert.equal(bindings["js.boolean.isBoolean"](value), false);
  }
});

test("primitive narrowings return exact values and reject without coercion or proxy traps", () => {
  const strings = ["", "\ud800"];
  for (const value of strings) assert.equal(bindings["js.string.fromAny"](value), value);
  for (const value of [-0, NaN, Infinity, -Infinity]) {
    const result = bindings["js.number.fromAny"](value);
    assert.ok(Object.is(result, value));
  }
  assert.equal(bindings["js.boolean.fromAny"](false), false);

  let conversions = 0;
  const object = {
    valueOf() { conversions++; return 1; },
    toString() { conversions++; return "text"; },
    [Symbol.toPrimitive]() { conversions++; return true; },
  };
  const proxy = new Proxy(object, { get() { throw new Error("proxy trap must not run"); } });
  for (const value of [new String("text"), new Number(1), new Boolean(false), null, undefined, object, proxy]) {
    for (const target of ["js.string.fromAny", "js.number.fromAny", "js.boolean.fromAny"])
      assert.throws(() => bindings[target](value), TypeError);
  }
  assert.equal(conversions, 0, "failed narrowing must not call valueOf, toString or Symbol.toPrimitive");
});

test("primitive narrowing metadata is fixed and cannot be generic or retagged", () => {
  for (const target of targets) {
    const candidate = operation(generation, target);
    assert.deepEqual(candidate.typeParameters ?? [], []);
    assert.equal(candidate.arguments[0].type.lean, "Lean.Vir.Js.Any");
  }
  assert.equal(operation(generation, "js.string.fromAny").result.type.lean, "Lean.Vir.Js String");
  assert.equal(operation(generation, "js.number.fromAny").result.type.lean, "Lean.Vir.Js Float");
  assert.equal(operation(generation, "js.boolean.fromAny").result.type.lean, "Lean.Vir.Js Bool");

  for (const target of targets) {
    const generic = structuredClone(generation);
    operation(generic, target).typeParameters = ["α"];
    assert.throws(() => render(generic), /fixed primitive only, never an arbitrary phantom/u);

    const retagged = structuredClone(generation);
    operation(retagged, target).result.type.resourceInner = "Unrelated";
    assert.throws(() => render(retagged), /result resourceInner must be/u);
  }
});
