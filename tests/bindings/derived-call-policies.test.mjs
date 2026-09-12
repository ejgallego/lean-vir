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

for (const [library, group, members] of [
  ["React", "hooks", ["React.useEffect"]],
  ["Browser", "timers", ["clearInterval", "clearTimeout"]],
]) {
  const config = await loadBindingConfig(new URL(`../../Vir/${library}.bindings.json`, import.meta.url).pathname);
  const root = config.roots.find((root) => root.id === group);
  const mappings = root.mappings.filter((mapping) => members.includes(mapping.typescript));
  const targets = mappings.flatMap((mapping) => mapping.targets);
  const generation = {
    ...config.generation, members, protocolOperations: [],
    exceptions: Object.fromEntries(Object.entries(config.generation.exceptions)
      .filter(([target]) => targets.includes(target))),
  };
  const descriptor = await generateDescriptorFile({
    files: root.upstream.declarations.map((path) => new URL(`../../${path}`, import.meta.url).pathname),
    anchors: null, anchorsData: { version: 1, anchors: [] }, symbols: new Set(members),
    symbolFiles: [], sourceUrl: null, dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
  });
  const operations = (upstream = descriptor) =>
    buildGeneratedOperations(config, generation, new Map([[group, upstream]]));

  for (const member of members) {
    test(`${member} derives its call shape without changing the shipped boundary`, () => {
      const mapping = mappings.find((mapping) => mapping.typescript === member);
      assert.ok(config.generation.members.includes(member));
      assert.ok(!config.generation.protocolOperations.some((operation) => operation.target === mapping.targets[0]));
      const operation = operations().find((operation) => operation.typescript.member === member);
      const isEffect = member === "React.useEffect";
      const name = isEffect ? "setup" : member === "clearTimeout" ? "timeout" : "interval";
      const type = isEffect ? "Lean.Vir.Js Lean.Vir.React.EffectCallback"
        : `Lean.Vir.Js ${member === "clearTimeout" ? "Timeout" : "Interval"}`;
      assert.equal(operation.host.target, mapping.targets[0]);
      assert.equal(operation.lean.declaration, mapping.lean[0]);
      assert.equal(operation.typescript.kind, "function");
      assert.equal(operation.typescript.signaturePolicy.selection, "unique");
      assert.equal(operation.receiver.kind, "none");
      assert.deepEqual(operation.arguments.map(({ name, role, type, modalities }) =>
        ({ name, role, type, modalities })), [{
        name, role: "argument", type,
        modalities: { representation: "js-resource", passing: isEffect ? "borrowed" : "consumed", retention: "call" },
      }, ...(isEffect ? [{
        name: "deps", role: "argument", type: "Lean.Vir.Js.UndefinedOr Lean.Vir.React.DependencyList",
        modalities: { representation: "js-resource", passing: "borrowed", retention: "call" },
      }] : [])]);
      assert.equal(operation.result.lean, "Unit");
      assert.deepEqual(operation.result.modalities, { representation: "immediate", ownership: "value" });
      assert.equal(operation.effect.lean, isEffect ? "Lean.Vir.React.ReactM" : "DomM");
      assert.equal(operation.activeEffect, isEffect ? undefined : "release");
      assert.equal(operation.semantics.relation, "preserving");
      assert.deepEqual(operation.typescript.signaturePolicy.omittedOptionalParameters, []);
      assert.deepEqual(operation.typescript.signaturePolicy.forwardedOptionalParameters, isEffect ? ["deps"] : []);
      if (!isEffect) {
        // The native-token specialization does not erase upstream undefined provenance.
        assert.deepEqual(operation.typescript.shape.args[0].type, {
          kind: "option", absence: "undefined", element: { kind: "primitive", name: "number" },
        });
      }
    });

    test(`${member} rejects a missing upstream argument or unsupported result`, () => {
      for (const mutation of [
        (shape) => { shape.args = []; },
        (shape) => { shape.result = { kind: "opaque", name: "unsupported result" }; },
      ]) {
        const changed = structuredClone(descriptor);
        mutation(changed.symbols.find((symbol) => symbol.id === member).shape);
        assert.throws(() => operations(changed), /missing parameter|missing generated argument|unsupported faithful translation/u);
      }
    });
  }
}
