/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { generateDescriptorFile } from "../../scripts/bindings/typescript-descriptors.mjs";
import { renderLeanBindings } from "../../scripts/bindings/typescript-to-lean.mjs";

const config = await loadBindingConfig(new URL("../../Vir/Js.bindings.json", import.meta.url).pathname);
const generation = {
  ...config.generation,
  protocolOperations: config.generation.protocolOperations.filter((operation) =>
    ["array", "tuple2"].includes(operation.group)),
};
// Authority comes from the installed, pinned TypeScript declarations, not a
// second handwritten list of what this binding configuration ought to mean.
const descriptor = await generateDescriptorFile({
  files: [new URL("../../node_modules/typescript/lib/lib.es5.d.ts", import.meta.url).pathname],
  anchors: null, anchorsData: { version: 1, anchors: [] },
  symbols: new Set(["Array"]), symbolFiles: [], sourceUrl: null,
  dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
});
const render = (policy = generation, upstream = descriptor) =>
  renderLeanBindings(config, policy, new Map([["array", upstream]]));
const operation = (policy, target) => policy.protocolOperations.find((entry) => entry.target === target);

test("pinned Array<T> produces correlated Lean array signatures", async () => {
  const text = render();
  assert.match(text, /opaque push\s+\{α : Type\}\s+\(array : @& Lean\.Vir\.Js\.Array α\)\s+\(value : @& Lean\.Vir\.Js α\)/u);
  assert.match(text, /opaque getJs\s+\{α : Type\}\s+\(array : @& Lean\.Vir\.Js\.Array α\)\s+\(index : @& Lean\.Vir\.Js Float\) :\s+RuntimeM \(Lean\.Vir\.Js α\)/u);
  assert.doesNotMatch(text, /getAs/u);
  const shipped = await readFile(new URL("../../Vir/Js/Generated.lean", import.meta.url), "utf8");
  for (const name of ["push", "getJs"]) {
    const declaration = text.match(new RegExp(`opaque ${name}[^]*?RuntimeM \\(Lean\\.Vir\\.Js (?:Float|α)\\)`))[0];
    assert.ok(shipped.includes(declaration), `${name}: shipped Lean signature must be the validated translation`);
  }
});

for (const [label, target, mutate] of [
  ["independent parameters", "js.array.push", (op) => op.typeParameters.push("β")],
  ["unrelated receiver", "js.array.push", (op) => { op.arguments[0].type.lean = "Lean.Vir.Js.Array β"; }],
  ["unrelated item", "js.array.push", (op) => { op.arguments[1].type.lean = "Lean.Vir.Js β"; }],
  ["unrelated result", "js.array.item", (op) => { op.result.type.lean = "Lean.Vir.Js β"; }],
  ["erased receiver", "js.array.item", (op) => { op.arguments[0].type.lean = "Lean.Vir.Js.Array Lean.Vir.Js.Any"; }],
  ["retagged result descriptor", "js.array.item", (op) => { op.result.type.resourceInner = "β"; }],
  ["extra push arity", "js.array.push", (op) => { op.arguments.push(structuredClone(op.arguments[1])); }],
  ["unrelated constructor result", "js.array.empty", (op) => { op.result.type.lean = "Lean.Vir.Js.Array β"; }],
  ["redundant element resource wrapper", "js.array.push", (op) => { op.arguments[0].type.lean = "Lean.Vir.Js.Array (Lean.Vir.Js α)"; }],
]) {
  test(`array fidelity rejects ${label}, even when marked preserving`, () => {
    const policy = structuredClone(generation);
    const op = operation(policy, target);
    mutate(op);
    assert.equal(op.upstreamRelation.semantics, "preserving");
    assert.throws(() => render(policy), /TypeScript Array<T> element relationship violated/u);
  });
}

test("missing or changed upstream relationships fail closed", () => {
  for (const mutate of [
    (array) => { delete array.typeParameters; },
    (array) => { delete array.indexSignatures; },
    (array) => { array.indexSignatures[0].result.id = "Unrelated"; },
    (array) => { array.indexSignatures[0].args[0].type.name = "string"; },
    (_array, push) => { push.shape.args[0].type.element.id = "Unrelated"; },
    (_array, push) => { push.typeParameters = [{ name: "T" }]; },
  ]) {
    const upstream = structuredClone(descriptor);
    mutate(upstream.symbols.find((entry) => entry.id === "Array"),
      upstream.symbols.find((entry) => entry.id === "Array.push"));
    assert.throws(() => render(generation, upstream), /TypeScript Array<T> element relationship violated/u);
  }
});

test("the relationship follows the upstream binder, not its spelling", () => {
  const upstream = structuredClone(descriptor);
  const array = upstream.symbols.find((entry) => entry.id === "Array");
  array.typeParameters[0].name = "Item";
  array.indexSignatures[0].result.id = "Item";
  upstream.symbols.find((entry) => entry.id === "Array.push").shape.args[0].type.element.id = "Item";
  assert.equal(render(generation, upstream), render());
});

for (const target of ["js.tuple2.first", "js.tuple2.second"]) {
  test(`${target} rejects erased or unrelated position types`, () => {
    for (const mutate of [
      (op) => { op.arguments[0].type.lean = "Lean.Vir.Js.Array Lean.Vir.Js.Any"; },
      (op) => { op.result.type.lean = "Lean.Vir.Js γ"; },
      (op) => { op.result.type.lean = target.endsWith("first") ? "Lean.Vir.Js β" : "Lean.Vir.Js α"; },
    ]) {
      const policy = structuredClone(generation);
      mutate(operation(policy, target));
      assert.throws(() => render(policy), /tuple \[A, B\] position relationship violated/u);
    }
  });
}
