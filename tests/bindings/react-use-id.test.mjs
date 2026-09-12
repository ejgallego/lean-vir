/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { buildGeneratedOperations } from "../../scripts/bindings/binding-modalities.mjs";
import { generateDescriptorFile } from "../../scripts/bindings/typescript-descriptors.mjs";

const config = await loadBindingConfig(new URL("../../Vir/React.bindings.json", import.meta.url).pathname);
const generation = {
  ...config.generation,
  members: ["React.useId"], protocolOperations: [], exceptions: {}, methodPolicies: {},
};
const descriptor = await generateDescriptorFile({
  files: [new URL("../../node_modules/@types/react/index.d.ts", import.meta.url).pathname],
  anchors: null, anchorsData: { version: 1, anchors: [] }, symbols: new Set(["React.useId"]),
  symbolFiles: [], sourceUrl: null, dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
});
const operations = (upstream = descriptor) =>
  buildGeneratedOperations(config, generation, new Map([["hooks", upstream]]));

test("useId derives its exact string result and zero-argument shape from pinned React", () => {
  assert.ok(config.generation.members.includes("React.useId"));
  const [operation] = operations();
  assert.equal(operation.host.target, "react.useId");
  assert.equal(operation.lean.declaration, "Lean.Vir.React.Hooks.useId");
  assert.equal(operation.typescript.kind, "function");
  assert.deepEqual(operation.typescript.shape.args, []);
  assert.deepEqual(operation.typescript.shape.result, { kind: "primitive", name: "string" });
  assert.equal(operation.typescript.signaturePolicy.selection, "unique");
  assert.equal(operation.receiver.kind, "none");
  assert.deepEqual(operation.arguments, []);
  assert.equal(operation.effect.lean, "Lean.Vir.React.ReactM");
  assert.equal(operation.result.lean, "Lean.Vir.Js String");
  assert.equal(operation.result.modalities.representation, "js-resource");
  assert.equal(operation.semantics.evidence, "typescript-derived");
});

test("useId generation preserves undefined and rejects unsupported nullish absence", () => {
  const changed = structuredClone(descriptor);
  const symbol = changed.symbols.find((symbol) => symbol.id === "React.useId");
  symbol.shape.result = {
    kind: "option", absence: "undefined", element: symbol.shape.result,
  };
  assert.equal(operations(changed)[0].result.lean, "Lean.Vir.Js.UndefinedOr String");
  symbol.shape.result.absence = "nullish";
  assert.throws(() => operations(changed), /without a matching native resource constructor/u);
});
