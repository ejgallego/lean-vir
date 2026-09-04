/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildTypeAnchorReport } from "../../scripts/bindings/type-anchor-report.mjs";
import { generateDescriptorFile } from "../../scripts/bindings/typescript-descriptors.mjs";
import { INTERFACE_MANIFEST_VERSION } from "../../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";

test("descriptor options preserve null, undefined, and nullish absence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-ts-descriptors-"));
  try {
    const declarations = join(directory, "nullish.d.ts");
    await writeFile(declarations, `export interface Nullish {
  nullable: string | null;
  undefinable: string | undefined;
  nullish: string | null | undefined;
  optional?: string;
}
`);
    const descriptor = await generateDescriptorFile({
      files: [declarations],
      anchors: null,
      anchorsData: { version: 1, anchors: [] },
      symbols: new Set(),
      symbolFiles: [],
      sourceUrl: null,
      dependencyDepth: 0,
      dependencyPolicy: null,
      dependencyPolicyData: null,
    });
    const symbols = new Map(descriptor.symbols.map((symbol) => [symbol.id, symbol]));
    const string = { kind: "primitive", name: "string" };

    assert.deepEqual(symbols.get("Nullish.nullable")?.shape, {
      kind: "option",
      absence: "null",
      element: string,
    });
    assert.deepEqual(symbols.get("Nullish.undefinable")?.shape, {
      kind: "option",
      absence: "undefined",
      element: string,
    });
    assert.deepEqual(symbols.get("Nullish.nullish")?.shape, {
      kind: "option",
      absence: "nullish",
      element: string,
    });
    assert.equal(symbols.get("Nullish.optional")?.optional, true);
    assert.deepEqual(symbols.get("Nullish.optional")?.accessors, {
      get: string,
      set: string,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("structural anchors reject binding-policy transformations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-structural-anchors-"));
  try {
    const declarations = join(directory, "demo.d.ts");
    await writeFile(declarations, "export type Value = string;\n");
    await assert.rejects(
      generateDescriptorFile({
        files: [declarations],
        anchors: null,
        anchorsData: {
          version: 1,
          anchors: [{
            lean: "Demo.Value",
            ts: "Value",
            portIntent: { representation: "hostResource" },
          }],
        },
        symbols: new Set(),
        symbolFiles: [],
        sourceUrl: null,
        dependencyDepth: 0,
        dependencyPolicy: null,
        dependencyPolicyData: null,
      }),
      /portIntent is not a structural anchor field/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the comparator does not equate TypeScript undefined with Lean Option", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-nullish-comparison-"));
  try {
    const descriptors = join(directory, "descriptors.json");
    const manifest = join(directory, "manifest.json");
    await writeFile(descriptors, `${JSON.stringify({
      version: 1,
      symbols: [{
        id: "maybeUndefined",
        kind: "function",
        shape: {
          kind: "function",
          effect: "pure",
          args: [],
          result: {
            kind: "option",
            absence: "undefined",
            element: { kind: "primitive", name: "string" },
          },
        },
      }],
      anchors: [{ id: "maybe_undefined", lean: "Demo.maybeUndefined", ts: "maybeUndefined" }],
    }, null, 2)}\n`);
    await writeFile(manifest, `${JSON.stringify({
      version: INTERFACE_MANIFEST_VERSION,
      artifact: "lean-vir-ir-package",
      metadata: {},
      exports: [{
        id: "maybeUndefined",
        jsName: "maybeUndefined",
        entry: "Demo.maybeUndefined",
        source: "Demo.lean",
        startup: false,
        args: [],
        result: {
          type: "Option String",
          interfaceTag: INTERFACE_TAG.OPTION,
          element: { type: "String", interfaceTag: INTERFACE_TAG.STRING },
        },
        effect: "pure",
      }],
      hostImports: [],
      diagnostics: [],
    }, null, 2)}\n`);

    const report = await buildTypeAnchorReport({ descriptors, manifest });
    assert.equal(report.results[0]?.status, "weak");
    assert.equal(
      report.results[0]?.diagnostics[0]?.code,
      "typescript_undefined_not_represented",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
