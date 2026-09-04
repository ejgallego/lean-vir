/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadBindingConfig,
  validateBindingConfig,
} from "../../scripts/bindings/binding-config.mjs";

const browserPath = new URL("../../Vir/Browser.bindings.json", import.meta.url).pathname;
const browser = JSON.parse(await readFile(browserPath, "utf8"));
const infoviewPath = new URL("../../Vir/Infoview/Surface.bindings.json", import.meta.url).pathname;
const infoview = JSON.parse(await readFile(infoviewPath, "utf8"));

test("the shared loader validates a complete binding library", async () => {
  const loaded = await loadBindingConfig(browserPath);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.id, "browser");
  assert.equal(loaded.path, "Vir/Browser.bindings.json");
});

test("binding configuration rejects unknown nested intent fields", async () => {
  const invalid = structuredClone(browser);
  invalid.roots.find((root) => root.id === "document")
    .anchors[0].portIntent.retention = "until somebody reviews it";

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /portIntent\/retention.*additional properties/u,
  );
});

test("binding configuration requires a TypeScript declaration surface", async () => {
  const invalid = structuredClone(browser);
  delete invalid.roots.find((root) => root.id === "document").upstream.declarations;

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /must have required property 'declarations'/u,
  );
});

test("binding configuration requires a local declaration contract", async () => {
  const invalid = structuredClone(infoview);
  delete invalid.roots.find((root) => root.id === "commands").upstream.declarations;

  await assert.rejects(
    validateBindingConfig(invalid, infoviewPath),
    /must have required property 'declarations'/u,
  );
});

test("every binding library requires a generated Lean boundary", async () => {
  const invalid = structuredClone(browser);
  delete invalid.generation;

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /must have required property 'generation'/u,
  );
});

test("binding configuration rejects duplicate API group ids", async () => {
  const invalid = structuredClone(browser);
  invalid.roots[1].id = invalid.roots[0].id;

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /repeats root id animation/u,
  );
});

test("binding configuration rejects wildcards outside the target suffix", async () => {
  const invalid = structuredClone(browser);
  invalid.roots[0].targets[0] = "browser.*.request";

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /must match pattern/u,
  );
});

test("binding configuration rejects manual declaration exceptions", async () => {
  const invalid = structuredClone(browser);
  invalid.roots.find((root) => root.id === "element")
    .mappings.find((mapping) => mapping.typescript === "Element.addEventListener")
    .manualException = { reason: "Method generation is not available in this release." };

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /manualException.*must NOT have additional properties/u,
  );
});

test("method policies are explicit, selected, and schema checked", async () => {
  const unselected = structuredClone(browser);
  unselected.generation.methodPolicies["Element.closest"] = { signature: "only" };
  await assert.rejects(
    validateBindingConfig(unselected, browserPath),
    /defines a method policy for unselected member Element\.closest/u,
  );

  const vague = structuredClone(browser);
  vague.generation.methodPolicies["Element.getAttribute"].signature = "best";
  await assert.rejects(
    validateBindingConfig(vague, browserPath),
    /methodPolicies\/Element\.getAttribute\/signature.*must/u,
  );
});

test("reviewed protocols require a machine-readable upstream relation", async () => {
  const invalid = structuredClone(browser);
  delete invalid.generation.protocolOperations[0].upstreamRelation;

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /must have required property 'upstreamRelation'/u,
  );
});

test("semantic review classifications are fail-closed enums", async () => {
  const invalidProtocol = structuredClone(browser);
  invalidProtocol.generation.protocolOperations.find((operation) =>
    operation.upstreamRelation.kind === "upstream-adapter")
    .upstreamRelation.semantics = "probably close enough";
  await assert.rejects(
    validateBindingConfig(invalidProtocol, browserPath),
    /semantics.*must be equal to one of the allowed values/u,
  );

  const invalidException = structuredClone(browser);
  Object.values(invalidException.generation.exceptions)[0].semantics = "unknown";
  await assert.rejects(
    validateBindingConfig(invalidException, browserPath),
    /semantics.*must be equal to one of the allowed values/u,
  );

  const invalidMethodPolicy = structuredClone(browser);
  invalidMethodPolicy.generation.methodPolicies["CanvasRenderingContext2D.arc"].semantics = "close";
  await assert.rejects(
    validateBindingConfig(invalidMethodPolicy, browserPath),
    /semantics.*must be equal to one of the allowed values/u,
  );

  const missingMethodReason = structuredClone(browser);
  delete missingMethodReason.generation.methodPolicies["CanvasRenderingContext2D.arc"].reason;
  await assert.rejects(
    validateBindingConfig(missingMethodReason, browserPath),
    /must have property reason when property semantics is present/u,
  );

  const missingGlobalReason = structuredClone(browser);
  missingGlobalReason.generation.abiProfile.receiver.globalTypes.Console = {
    semantics: "changing",
    reason: "test-only global receiver policy",
  };
  delete missingGlobalReason.generation.abiProfile.receiver.globalTypes.Console.reason;
  await assert.rejects(
    validateBindingConfig(missingGlobalReason, browserPath),
    /must have required property 'reason'/u,
  );

  const implicitResourceAlias = structuredClone(browser);
  implicitResourceAlias.generation.resources.KeyboardEvent = "Event";
  await assert.rejects(
    validateBindingConfig(implicitResourceAlias, browserPath),
    /changes the TypeScript marker and requires lean, semantics, and reason/u,
  );

  const sameLeafResourceAlias = structuredClone(browser);
  sameLeafResourceAlias.generation.resources.Element = "Unrelated.Namespace.Element";
  await assert.rejects(
    validateBindingConfig(sameLeafResourceAlias, browserPath),
    /changes the TypeScript marker and requires lean, semantics, and reason/u,
  );

  const previousFormat = structuredClone(browser);
  previousFormat.version = 1;
  await assert.rejects(
    validateBindingConfig(previousFormat, browserPath),
    /version.*must be equal to constant/u,
  );
});

test("private active-effect roles are fail-closed", async () => {
  const invalid = structuredClone(browser);
  invalid.generation.exceptions["browser.animation.requestAnimationFrame"]
    .activeEffect = "maybe-clean-up";

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /activeEffect.*must be equal to one of the allowed values/u,
  );
});

test("local protocol relations identify their declaration member", async () => {
  const invalid = structuredClone(infoview);
  delete invalid.generation.protocolOperations.find((operation) =>
    operation.upstreamRelation.kind === "local-contract").upstreamRelation.member;

  await assert.rejects(
    validateBindingConfig(invalid, infoviewPath),
    /must have required property 'member'/u,
  );
});
