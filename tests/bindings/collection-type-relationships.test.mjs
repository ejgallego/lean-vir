/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { generateDescriptorFile } from "../../scripts/bindings/typescript-descriptors.mjs";
import { renderLeanBindings } from "../../scripts/bindings/typescript-to-lean.mjs";

const config = await loadBindingConfig(new URL("../../Vir/Js.bindings.json", import.meta.url).pathname);
const generation = {
  ...config.generation,
  protocolOperations: config.generation.protocolOperations.filter((operation) =>
    ["array", "tuple2"].includes(operation.group) || operation.target === "js.nodeList.toArray"),
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

test("Lean element parameters cannot shadow fixed primitive types", () => {
  for (const name of ["Float", "String", "Unit"]) {
    const policy = JSON.parse(JSON.stringify(generation).replaceAll("α", name));
    assert.throws(() => render(policy), /type parameter .* shadows a fixed Lean type/u);
  }
  const renamed = JSON.parse(JSON.stringify(generation).replaceAll("α", "Element"));
  assert.match(render(renamed), /\{Element : Type\}/u);
});

for (const [member, original, replacement, wrapper, code] of [
  ["Array.length", "length: number;", "length?: number;",
    "export function length<T>(array: Array<T>): number { return array.length; }", 2322],
  ["Array.push", "push(...items: T[]): number;", "push?(...items: T[]): number;",
    "export function push<T>(array: Array<T>, item: T): number { return array.push(item); }", 2722],
]) {
  test(`source-level optional ${member} is rejected before generation`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "lean-vir-array-optional-"));
    try {
      const path = join(directory, "lib.d.ts");
      const source = await readFile(new URL("../../node_modules/typescript/lib/lib.es5.d.ts", import.meta.url), "utf8");
      assert.ok(source.includes(original), "mutation must target the pinned declaration");
      const mutated = source.replaceAll(original, replacement);
      await writeFile(path, mutated);
      const upstream = await generateDescriptorFile({
        files: [path], anchors: null, anchorsData: { version: 1, anchors: [] },
        symbols: new Set(["Array"]), symbolFiles: [], sourceUrl: null,
        dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
      });
      assert.equal(upstream.symbols.find((symbol) => symbol.id === member).optional, true);
      assert.throws(() => render(generation, upstream), /must not be optional/u);
      assert.deepEqual(typeScriptDiagnostics(wrapper), []);
      assert.ok(typeScriptDiagnostics(wrapper, mutated).some((d) => d.code === code && d.file?.text === wrapper),
        "the independent TS wrapper rejects the optional member");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("source-level keyof index results cannot masquerade as the Array element", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-array-operator-"));
  try {
    const path = join(directory, "lib.d.ts");
    const source = await readFile(new URL("../../node_modules/typescript/lib/lib.es5.d.ts", import.meta.url), "utf8");
    const original = "[n: number]: T;";
    assert.ok(source.includes(original), "pinned source mutation must target the index signature");
    const mutated = source.replaceAll(original, "[n: number]: keyof T;");
    await writeFile(path, mutated);
    const upstream = await generateDescriptorFile({
      files: [path], anchors: null, anchorsData: { version: 1, anchors: [] },
      symbols: new Set(["Array"]), symbolFiles: [], sourceUrl: null,
      dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
    });
    assert.deepEqual(upstream.symbols.find((symbol) => symbol.id === "Array").indexSignatures[0].result,
      { kind: "opaque", name: "keyof T" });
    assert.throws(() => render(generation, upstream), /TypeScript Array<T> element relationship violated/u);

    const wrapper = "export function item<T>(array: Array<T>, index: number): T { return array[index]; }";
    assert.deepEqual(typeScriptDiagnostics(wrapper), []);
    assert.ok(typeScriptDiagnostics(wrapper, mutated).some((d) => d.code === 2322 && d.file?.text === wrapper),
    "pinned TS independently rejects the mutated element relationship");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("VIR NodeList conversion preserves the full-view to JS-shape relationship", () => {
  assert.match(render(), /opaque toArray\s+\{α : Type\}\s+\(nodes : @& Lean\.Vir\.Js\.NodeList \(Lean\.Vir\.Js α\)\) :\s+RuntimeM \(Lean\.Vir\.Js\.Array α\)/u);
  for (const mutate of [
    (op) => op.typeParameters.push("β"),
    (op) => { op.arguments[0].type.lean = "Lean.Vir.Js.NodeList α"; },
    (op) => { op.arguments[0].type.resourceInner = "Lean.Vir.Js.NodeList.Value α"; },
    (op) => { op.result.type.lean = "Lean.Vir.Js.Array (Lean.Vir.Js α)"; },
    (op) => { op.result.type.lean = "Lean.Vir.Js.Array β"; },
    (op) => { op.result.type.resourceInner = "Lean.Vir.Js.Array.Value β"; },
  ]) {
    const policy = structuredClone(generation);
    mutate(operation(policy, "js.nodeList.toArray"));
    assert.throws(() => render(policy), /VIR NodeList-to-Array element relationship violated/u);
  }
});
