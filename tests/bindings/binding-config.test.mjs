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

test("binding configuration accepts justified manual exceptions", async () => {
  const configured = structuredClone(browser);
  configured.roots.find((root) => root.id === "document")
    .mappings.find((mapping) => mapping.typescript === "Document.querySelector")
    .manualException = { reason: "Method generation is not available in this release." };

  const validated = await validateBindingConfig(configured, browserPath);
  assert.equal(
    validated.roots.find((root) => root.id === "document")
      .mappings.find((mapping) => mapping.typescript === "Document.querySelector")
      .manualException.reason,
    "Method generation is not available in this release.",
  );
});

test("generated members cannot also be manual exceptions", async () => {
  const invalid = structuredClone(browser);
  invalid.roots.find((root) => root.id === "document")
    .mappings.find((mapping) => mapping.typescript === "Document.title")
    .manualException = { reason: "Conflicting provenance." };

  await assert.rejects(
    validateBindingConfig(invalid, browserPath),
    /marks generated member Document\.title as a manual exception/u,
  );
});
