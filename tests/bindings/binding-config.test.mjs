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
});

test("the Browser audit classifies every exception and upstream adapter", () => {
  const exceptions = Object.entries(browser.generation.exceptions);
  assert.equal(exceptions.filter(([, exception]) =>
    exception.semantics === undefined).length, 0);
  assert.deepEqual(
    exceptions.filter(([, exception]) => exception.semantics === "changing")
      .map(([id]) => id).sort(),
    [
      "browser.animation.cancelAnimationFrame",
      "browser.animation.requestAnimationFrame",
      "browser.element.addEventListener",
      "browser.element.removeEventListener",
      "browser.event.currentTarget",
      "browser.event.target",
    ],
  );

  const adapters = browser.generation.protocolOperations.filter((operation) =>
    operation.upstreamRelation.kind === "upstream-adapter");
  assert.equal(adapters.filter((operation) =>
    operation.upstreamRelation.semantics === undefined).length, 0);
  assert.deepEqual(
    adapters.filter((operation) =>
      operation.upstreamRelation.semantics === "changing")
      .map((operation) => operation.id).sort(),
    [
      "browser.timer.clearInterval",
      "browser.timer.clearTimeout",
      "browser.timer.setInterval",
      "browser.timer.setTimeout",
    ],
  );
});

test("the infoview clipboard capability is an explicit semantic adapter", () => {
  const clipboard = infoview.generation.protocolOperations.find((operation) =>
    operation.id === "infoview.clipboard.write-text");
  assert.equal(clipboard.upstreamRelation.semantics, "changing");
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
