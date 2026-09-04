#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INTERFACE_MANIFEST_VERSION } from "../../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

const root = repositoryRoot;
const tmp = await mkdtemp(join(tmpdir(), "lean-vir-type-anchors-"));

try {
  const types = join(tmp, "types.d.ts");
  const anchors = join(tmp, "anchors.json");
  const descriptors = join(tmp, "descriptors.json");
  const manifest = join(tmp, "manifest.json");
  const inventory = join(tmp, "inventory.json");
  const invalidAliasManifest = join(tmp, "invalid-alias-manifest.json");
  const report = join(tmp, "report.json");
  const rendered = join(tmp, "anchors.md");
  const renderedHtml = join(tmp, "anchors.html");
  const dependencyPolicy = join(tmp, "dependency-policy.json");
  const dependencyDescriptors = join(tmp, "dependency-descriptors.json");
  const ambientTypes = join(tmp, "ambient.d.ts");
  const ambientDescriptors = join(tmp, "ambient-descriptors.json");

  await writeFile(types, `export namespace Demo {
  /** Box hover docs & <safe>. */
  export interface Box {
    value: string;
  }

  /** Lean exact integer shape. */
  export type Count = string | number | bigint;

  /** Callable fixture. */
  export type BoxFn = (box: Demo.Box, count: Demo.Count) => Demo.Box;

  /** Method extraction fixture. */
  export interface Controls {
    label: string;
    get text(): string;
    set text(value: string | null);
    reset(value: string): void;
  }

  /** Reviewed external dependency fixture. */
  export type ExternalFn = (value: External.Node) => void;
}
`);

  await writeFile(ambientTypes, `interface AmbientBase {
  inherited: boolean;
}

interface AmbientRoot extends AmbientBase {
  value: string;
  run(value: string): void;
  run(value: number): void;
}

declare function schedule(value: string): void;
declare function schedule(value: number): void;
`);

  await writeFile(dependencyPolicy, `${JSON.stringify({
    version: 1,
    symbols: [
      {
        id: "External.Node",
        reason: "smoke-test abstraction",
        shape: {
          kind: "opaque",
          name: "External.Node",
          abstract: true,
          reason: "smoke-test abstraction",
        },
      },
    ],
  }, null, 2)}\n`);

  await writeFile(anchors, `${JSON.stringify({
    version: 1,
    anchors: [
      { id: "box", lean: "Demo.Box", ts: "Demo.Box" },
      { id: "box_fn", lean: "Demo.bump", ts: "Demo.BoxFn" },
      { id: "missing", lean: "Demo.Missing", ts: "Demo.Box" },
      {
        id: "gap",
        lean: "Demo.Gap",
        ts: "Demo.Box",
        relation: "coverageGap",
      },
    ],
  }, null, 2)}\n`);

  const boxType = {
    type: "Demo.Box",
    interfaceTag: INTERFACE_TAG.STRUCTURE,
    kind: "structure",
    name: "Demo.Box",
    objectFieldCount: 1,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    fields: [
      {
        name: "value",
        type: { type: "String", interfaceTag: INTERFACE_TAG.STRING },
        layout: { kind: "object", index: 0 },
      },
    ],
  };
  const controlsType = {
    type: "Demo.Controls",
    interfaceTag: INTERFACE_TAG.RESOURCE,
    kind: "resource",
    name: "Demo.Controls",
  };

  const manifestValue = {
    version: INTERFACE_MANIFEST_VERSION,
    artifact: "lean-vir-ir-package",
    metadata: {},
    exports: [
      {
        id: "bump",
        jsName: "bump",
        entry: "Demo.bump",
        source: "Demo.lean",
        startup: false,
        args: [
          { name: "box", type: boxType },
          { name: "count", type: { type: "Nat", interfaceTag: INTERFACE_TAG.NAT } },
        ],
        result: boxType,
        effect: "pure",
      },
      {
        id: "getLabel",
        jsName: "getLabel",
        entry: "Demo.getLabel",
        source: "Demo.lean",
        startup: false,
        args: [
          {
            name: "controls",
            type: controlsType,
          },
        ],
        result: { type: "String", interfaceTag: INTERFACE_TAG.STRING },
        effect: "dom",
      },
    ],
    hostImports: [],
    diagnostics: [],
  };
  await writeFile(manifest, `${JSON.stringify(manifestValue, null, 2)}\n`);
  await writeFile(inventory, `${JSON.stringify({
    format: "lean-vir-js-inventory",
    version: 1,
    summary: { publicEntries: 1 },
    publicEntries: [{
      declaration: "Demo.reset",
      module: "Demo",
      type: "Demo.Controls → String → DemoM Unit",
      source: { path: "Demo.lean", startLine: 12, endLine: 12 },
      interface: {
        kind: "function",
        effect: "dom",
        args: [
          { name: "controls", type: controlsType },
          { name: "value", type: { type: "String", interfaceTag: INTERFACE_TAG.STRING } },
        ],
        result: { type: "Unit", interfaceTag: INTERFACE_TAG.UNIT },
      },
      targets: [{ target: "demo.reset", path: ["Demo.reset"] }],
    }],
  }, null, 2)}\n`);
  await writeFile(invalidAliasManifest, `${JSON.stringify({
    ...manifestValue,
    metadata: {
      typeAnchorAliases: [{
        lean: "Demo.MissingAlias",
        type: "Demo.MissingAlias",
        via: "Demo.missingAliasIdentity",
        descriptor: "resource",
      }],
    },
  }, null, 2)}\n`);

  run(["scripts/bindings/generate-ts-descriptors.mjs", "--anchors", anchors, "--out", descriptors, types]);
  run([
    "scripts/bindings/generate-ts-descriptors.mjs",
    "--symbol", "AmbientRoot",
    "--symbol", "AmbientRoot.run",
    "--symbol", "schedule",
    "--out", ambientDescriptors,
    ambientTypes,
  ]);
  run([
    "scripts/bindings/generate-ts-descriptors.mjs",
    "--symbol", "Demo.BoxFn",
    "--symbol", "Demo.ExternalFn",
    "--dependency-depth", "1",
    "--dependency-policy", dependencyPolicy,
    "--out", dependencyDescriptors,
    types,
  ]);
  run(["scripts/bindings/check-type-anchors.mjs", "--descriptors", descriptors, "--manifest", manifest, "--inventory", inventory, "--out", report]);
  runFailure(["scripts/bindings/check-type-anchors.mjs", "--fail-on-errors", "--descriptors", descriptors, "--manifest", manifest, "--inventory", inventory]);
  runFailure([
    "scripts/bindings/check-type-anchors.mjs",
    "--descriptors", descriptors,
    "--manifest", invalidAliasManifest,
  ]);
  run(["scripts/bindings/render-type-anchors.mjs", "--report", report, "--out", rendered]);
  run([
    "scripts/bindings/render-type-anchors.mjs",
    "--format", "html",
    "--report", report,
    "--out", renderedHtml,
  ]);

  const comparison = JSON.parse(await readFile(report, "utf8"));
  const descriptorComparison = JSON.parse(await readFile(descriptors, "utf8"));
  const dependencyComparison = JSON.parse(await readFile(dependencyDescriptors, "utf8"));
  const ambientComparison = JSON.parse(await readFile(ambientDescriptors, "utf8"));
  assert.deepEqual(ambientComparison.symbols.map((symbol) => symbol.id), [
    "AmbientRoot",
    "AmbientRoot.inherited",
    "AmbientRoot.run",
    "AmbientRoot.value",
    "schedule",
  ]);
  assert.equal(
    ambientComparison.symbols.find((symbol) => symbol.id === "AmbientRoot.inherited")?.inheritedFrom,
    "AmbientBase",
  );
  assert.equal(ambientComparison.symbols.find((symbol) => symbol.id === "AmbientRoot.value")?.kind,
    "property");
  assert.deepEqual(
    ambientComparison.symbols.find((symbol) => symbol.id === "AmbientRoot.value")?.accessors,
    {
      get: { kind: "primitive", name: "string" },
      set: { kind: "primitive", name: "string" },
    },
  );
  assert.equal(ambientComparison.symbols.find((symbol) => symbol.id === "AmbientRoot.run")?.shape.kind,
    "union");
  assert.deepEqual(
    descriptorComparison.symbols.find((symbol) => symbol.id === "Demo.Controls.text")?.accessors,
    {
      get: { kind: "primitive", name: "string" },
      set: {
        kind: "option",
        absence: "null",
        element: { kind: "primitive", name: "string" },
      },
    },
  );
  assert.equal(
    descriptorComparison.symbols.find((symbol) => symbol.id === "Demo.Controls.label")?.kind,
    "property",
  );
  assert.equal(
    descriptorComparison.symbols.find((symbol) => symbol.id === "Demo.Controls.reset")?.kind,
    "method",
  );
  assert.equal(ambientComparison.symbols.find((symbol) => symbol.id === "schedule")?.shape.options.length, 2);
  assert.deepEqual(dependencyComparison.dependencies.unresolved, []);
  assert.deepEqual(
    dependencyComparison.symbols.map((symbol) => symbol.id),
    ["Demo.Box", "Demo.BoxFn", "Demo.Count", "Demo.ExternalFn", "External.Node"],
  );
  assert.equal(
    dependencyComparison.symbols.find((symbol) => symbol.id === "External.Node")?.shape.abstract,
    true,
  );
  assert.deepEqual(comparison.summary, {
    exact: 1,
    compatible: 1,
    weak: 0,
    missing: 2,
  });
  assert.deepEqual(comparison.diagnosticSummary, {
    error: 1,
    warning: 0,
    info: 2,
  });
  assert.equal(comparison.results.find((result) => result.id === "missing")?.diagnostics[0]?.code,
    "lean_descriptor_missing");
  assert.equal(comparison.results.find((result) => result.id === "gap")?.diagnostics[0]?.severity, "info");
  assert.match(comparison.inputs.shippedInventory, /inventory\.json$/u);
  const markdown = await readFile(rendered, "utf8");
  assert.match(markdown, /href="types\.d\.ts#L3-L5"/);
  assert.match(markdown, /title="exact: Demo\.Box -&gt; Demo\.Box/);
  assert.match(markdown, /missing Lean descriptor Demo\.Missing/);
  const html = await readFile(renderedHtml, "utf8");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /id="type-anchor-box"/);
  assert.match(html, /class="badge exact"/);
  assert.match(html, /href="types\.d\.ts#L3-L5"/);
  assert.match(html, /<p class="pane-title">Lean VIR descriptor<\/p>/);
  assert.match(html, /error\/lean_descriptor_missing/);
  assert.match(html, /Box hover docs &amp; &lt;safe&gt;\./);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("type anchor smoke ok");

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runFailure(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
}
