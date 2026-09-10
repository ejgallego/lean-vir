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
import ts from "typescript";

import { buildTypeAnchorReport } from "../../scripts/bindings/type-anchor-report.mjs";
import { generateDescriptorFile } from "../../scripts/bindings/typescript-descriptors.mjs";
import {
  typeScriptAnchorId,
  validateTypeScriptAnchors,
} from "../../scripts/bindings/type-anchor-format.mjs";
import { renderTypeAnchorReport } from "../../scripts/bindings/type-anchor-renderer.mjs";
import { INTERFACE_MANIFEST_VERSION } from "../../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";

test("interface merging retains compatible parameter metadata, including unrelated roots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-ts-merge-"));
  try {
    const declarations = join(directory, "merge.d.ts");
    const generate = (symbols) => generateDescriptorFile({
      files: [declarations], anchors: null, anchorsData: { version: 1, anchors: [] },
      symbols: new Set(symbols), symbolFiles: [], sourceUrl: null,
      dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
    });
    const string = { kind: "primitive", name: "string" };
    for (const [initial, introduced, expected] of [
      ["T", "T = string", [{ name: "T", default: string }]],
      ["T", "T = string, U = number", [
        { name: "T", default: string }, { name: "U", default: { kind: "primitive", name: "number" } },
      ]],
      ["T = string", "T extends string", [{ name: "T", default: string, constraint: string }]],
    ]) {
      const parts = [
        `export interface Box<${initial}> { value: T }`,
        `export interface Box<${introduced}> { label: string }`,
      ];
      for (const declarationsInOrder of [parts, [...parts].reverse()]) {
        await writeFile(declarations, `${declarationsInOrder.join("\n")}\nexport interface Wanted { x: number }\n`);
        const program = ts.createProgram([declarations], { strict: true, noEmit: true, types: [] });
        assert.deepEqual(ts.getPreEmitDiagnostics(program), [], "the merged input is valid TypeScript");
        const descriptor = await generate(["Box"]);
        const box = descriptor.symbols.find((symbol) => symbol.id === "Box");
        assert.deepEqual(box.typeParameters, expected);
        assert.deepEqual(Object.keys(box.shape.fields).sort(), ["label", "value"]);
        assert.deepEqual((await generate(["Wanted"])).symbols.map((symbol) => symbol.id), ["Wanted", "Wanted.x"]);
      }
    }
    for (const [initial, conflicting] of [
      ["T = string", "T = number"], ["T", "U"], ["T", "T, U"],
      ["T extends string", "T extends number"],
    ]) {
      await writeFile(declarations, `export interface Box<${initial}> { label: string }\nexport interface Box<${conflicting}> { extra: string }\n`);
      assert.ok(ts.getPreEmitDiagnostics(ts.createProgram([declarations], { strict: true, noEmit: true, types: [] })).length > 0);
      await assert.rejects(generate(["Box"]), /conflicting TypeScript type parameters for Box/u);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
    const generate = (anchorsData, anchors = null) => generateDescriptorFile({
      files: [declarations],
      anchors,
      anchorsData,
      symbols: new Set(),
      symbolFiles: [],
      sourceUrl: null,
      dependencyDepth: 0,
      dependencyPolicy: null,
      dependencyPolicyData: null,
    });
    for (const [anchorsData, expected] of [
      [
        {
          version: 1,
          anchors: [{
            lean: "Demo.Value",
            ts: "Value",
            portIntent: { representation: "hostResource" },
          }],
        },
        /portIntent is not a structural anchor field/u,
      ],
      [{ version: 1, anchors: [], metadata: {} }, /metadata is not an anchor-file field/u],
      [{ version: 1, anchors: [null] }, /anchors\[0\] must be an object/u],
      [
        {
          version: 1,
          anchors: [{ lean: "Demo.Value", ts: "Value", category: "legacy" }],
        },
        /category is not a structural anchor field/u,
      ],
      [
        {
          version: 1,
          anchors: [{ lean: "Demo.Value", ts: "Value", target: "demo.value" }],
        },
        /target is not a structural anchor field/u,
      ],
    ]) {
      await assert.rejects(generate(anchorsData), expected);
    }
    const nullAnchors = join(directory, "null-anchors.json");
    await writeFile(nullAnchors, "null\n");
    await assert.rejects(
      generate(undefined, nullAnchors),
      /anchor file must be \{ version: 1, anchors: \[\.\.\.\] \}/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("anchor validation and report navigation share identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-anchor-ids-"));
  try {
    const anchors = [
      { lean: "Demo.Value", ts: "First" },
      { lean: "Demo.Value", ts: "Second" },
      { id: "explicit", lean: "Demo.Other", ts: "First" },
    ];
    const symbolIds = new Set(["First", "Second"]);
    validateTypeScriptAnchors(anchors, symbolIds);
    const descriptors = join(directory, "descriptors.json");
    await writeFile(descriptors, JSON.stringify({
      version: 1,
      symbols: [...symbolIds].map((id) => ({ id, shape: { kind: "primitive", name: "string" } })),
      anchors,
    }));
    const report = await buildTypeAnchorReport({ descriptors });
    const ids = report.results.map((result) => result.id);
    assert.deepEqual(ids, ["demo_value_to_first", "demo_value_to_second", "explicit"]);
    assert.deepEqual(ids, anchors.map(typeScriptAnchorId));
    const html = renderTypeAnchorReport(report, "html");
    for (const id of ids) {
      assert.equal(html.split(`id="type-anchor-${id}"`).length - 1, 1);
    }
    for (const collision of [
      anchors[0],
      { lean: "Demo_Value", ts: "First" },
      { id: ids[0], lean: "Demo.Other", ts: "Second" },
      { id: ids[0].toUpperCase(), lean: "Demo.Other", ts: "Second" },
    ]) {
      const duplicateAnchors = [anchors[0], collision];
      assert.throws(() => validateTypeScriptAnchors(duplicateAnchors, symbolIds), /duplicate anchor id/u);
      await writeFile(descriptors, JSON.stringify({
        version: 1,
        symbols: [...symbolIds].map((id) => ({ id })),
        anchors: duplicateAnchors,
      }));
      await assert.rejects(buildTypeAnchorReport({ descriptors }), /duplicate anchor id/u);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the comparator rejects stale structural-anchor fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-stale-anchor-"));
  try {
    const descriptors = join(directory, "descriptors.json");
    await writeFile(descriptors, `${JSON.stringify({
      version: 1,
      symbols: [{
        id: "Value",
        kind: "type",
        shape: { kind: "primitive", name: "string" },
      }],
      anchors: [{
        lean: "Demo.Value",
        ts: "Value",
        category: "legacy",
      }],
    }, null, 2)}\n`);

    await assert.rejects(
      buildTypeAnchorReport({
        descriptors,
        manifest: join(directory, "unused-manifest.json"),
      }),
      /category is not a structural anchor field/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the comparator fails closed on TypeScript absence semantics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lean-vir-nullish-comparison-"));
  try {
    const descriptors = join(directory, "descriptors.json");
    const manifest = join(directory, "manifest.json");
    const string = { kind: "primitive", name: "string" };
    const option = (absence) => ({
      kind: "option",
      ...(absence === undefined ? {} : { absence }),
      element: string,
    });
    const functionShape = (result) => ({
      kind: "function",
      effect: "pure",
      args: [],
      result,
    });
    await writeFile(descriptors, `${JSON.stringify({
      version: 1,
      symbols: [
        {
          id: "maybeUndefined",
          kind: "function",
          shape: functionShape(option("undefined")),
        },
        {
          id: "missingAbsence",
          kind: "function",
          shape: functionShape(option(undefined)),
        },
        {
          id: "optionalProperty",
          kind: "property",
          optional: true,
          shape: functionShape(option("null")),
        },
      ],
      anchors: [
        { id: "maybe_undefined", lean: "Demo.maybeString", ts: "maybeUndefined" },
        { id: "missing_absence", lean: "Demo.maybeString", ts: "missingAbsence" },
        { id: "optional_property", lean: "Demo.maybeString", ts: "optionalProperty" },
      ],
    }, null, 2)}\n`);
    await writeFile(manifest, `${JSON.stringify({
      version: INTERFACE_MANIFEST_VERSION,
      artifact: "lean-vir-ir-package",
      metadata: {},
      exports: [{
        id: "maybeString",
        jsName: "maybeString",
        entry: "Demo.maybeString",
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
    assert.deepEqual(
      report.results.map((result) => [result.id, result.status, result.diagnostics[0]?.code]),
      [
        ["maybe_undefined", "weak", "typescript_undefined_not_represented"],
        ["missing_absence", "weak", "typescript_absence_provenance_missing"],
        ["optional_property", "weak", "typescript_optional_property_not_represented"],
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
