/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { renderLeanBindings } from "../../scripts/bindings/typescript-to-lean.mjs";

const config = await loadBindingConfig(new URL("../../Vir/Js.bindings.json", import.meta.url).pathname);
const generation = {
  ...config.generation,
  protocolOperations: config.generation.protocolOperations.filter((operation) =>
    ["js.object.get", "js.string.fromAny"].includes(operation.target)),
};
const render = (policy = generation) => renderLeanBindings(config, policy, new Map());
const operation = (policy, target) => policy.protocolOperations.find((entry) => entry.target === target);

test("a receiver type parameter cannot capture the fixed String key type", () => {
  const policy = structuredClone(generation);
  const op = operation(policy, "js.object.get");
  op.typeParameters = ["String"];
  op.arguments[0].type = { lean: "Lean.Vir.Js String", representation: "js-resource", resourceInner: "String" };
  assert.throws(() => render(policy), /type parameter String shadows a fixed Lean type/u);
});

test("dynamic property reads generate only an erased result; String narrowing is closed", async () => {
  const text = render();
  const getter = /opaque get\s+\{object : Type\}\s+\(object : @& Lean\.Vir\.Js object\)\s+\(name : @& Lean\.Vir\.Js String\) :\s+RuntimeM \(Lean\.Vir\.Js\.Any\)/u;
  const stringCheck = /opaque fromAny\s+\(value : @& Lean\.Vir\.Js\.Any\) :\s+RuntimeM \(Lean\.Vir\.Js String\)/u;
  assert.match(text, getter);
  assert.match(text, stringCheck);
  const shipped = await readFile(new URL("../../Vir/Js/Generated.lean", import.meta.url), "utf8");
  assert.match(shipped, getter);
  assert.match(shipped, stringCheck);
});

for (const [label, mutate] of [
  ["unconstrained result parameter", (op) => {
    op.typeParameters.push("α");
    op.result.type = { lean: "Lean.Vir.Js α", representation: "js-resource", resourceInner: "α" };
  }],
  ["concrete but unjustified JSL result", (op) => {
    op.result.type = { lean: "Lean.Vir.JSL Nat", representation: "js-resource", resourceInner: "Lean.Vir.LeanRef.Handle Nat" };
  }],
  ["caller-chosen String result", (op) => { op.result.type.lean = "Lean.Vir.Js String"; }],
  ["retagged result descriptor", (op) => { op.result.type.resourceInner = "String"; }],
]) {
  test(`dynamic property contract rejects ${label}`, () => {
    const policy = structuredClone(generation);
    mutate(operation(policy, "js.object.get"));
    assert.throws(() => render(policy), /dynamic property result relationship violated/u);
  });
}

test("the String predicate cannot be declared as a generic safe narrowing", () => {
  for (const mutate of [
    (op) => { op.typeParameters = ["α"]; },
    (op) => { op.result.type.lean = "Lean.Vir.JSL String"; },
    (op) => { op.result.type.resourceInner = "Lean.Vir.LeanRef.Handle String"; },
  ]) {
    const policy = structuredClone(generation);
    mutate(operation(policy, "js.string.fromAny"));
    assert.throws(() => render(policy), /closed String narrowing relationship violated/u);
  }
});
