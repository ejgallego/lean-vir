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

import { INTERFACE_MANIFEST_VERSION } from "../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../web/src/runtime/interface-tags.js";

const root = new URL("..", import.meta.url).pathname;
const tmp = await mkdtemp(join(tmpdir(), "lean-vir-type-anchors-"));

try {
  const types = join(tmp, "types.d.ts");
  const anchors = join(tmp, "anchors.json");
  const descriptors = join(tmp, "descriptors.json");
  const manifest = join(tmp, "manifest.json");
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
        portIntent: { disposition: "unsupported" },
      },
      {
        id: "controls_reset",
        lean: "Demo.reset",
        ts: "Demo.Controls.reset",
        portIntent: { receiver: "borrowed", effect: "dom" },
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
        id: "reset",
        jsName: "reset",
        entry: "Demo.reset",
        source: "Demo.lean",
        startup: false,
        args: [
          {
            name: "controls",
            type: {
              type: "Demo.Controls",
              interfaceTag: INTERFACE_TAG.RESOURCE,
              kind: "resource",
              name: "Demo.Controls",
            },
          },
          { name: "value", type: { type: "String", interfaceTag: INTERFACE_TAG.STRING } },
        ],
        result: { type: "Unit", interfaceTag: INTERFACE_TAG.UNIT },
        effect: "dom",
      },
    ],
    hostImports: [],
    diagnostics: [],
  };
  await writeFile(manifest, `${JSON.stringify(manifestValue, null, 2)}\n`);
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

  run(["scripts/generate-ts-descriptors.mjs", "--anchors", anchors, "--out", descriptors, types]);
  run([
    "scripts/generate-ts-descriptors.mjs",
    "--symbol", "AmbientRoot",
    "--symbol", "AmbientRoot.run",
    "--symbol", "schedule",
    "--out", ambientDescriptors,
    ambientTypes,
  ]);
  run([
    "scripts/generate-ts-descriptors.mjs",
    "--symbol", "Demo.BoxFn",
    "--symbol", "Demo.ExternalFn",
    "--dependency-depth", "1",
    "--dependency-policy", dependencyPolicy,
    "--out", dependencyDescriptors,
    types,
  ]);
  run(["scripts/check-type-anchors.mjs", "--descriptors", descriptors, "--manifest", manifest, "--out", report]);
  runFailure(["scripts/check-type-anchors.mjs", "--fail-on-errors", "--descriptors", descriptors, "--manifest", manifest]);
  runFailure([
    "scripts/check-type-anchors.mjs",
    "--descriptors", descriptors,
    "--manifest", invalidAliasManifest,
  ]);
  run(["scripts/render-type-anchors.mjs", "--report", report, "--out", rendered]);
  run([
    "scripts/render-type-anchors.mjs",
    "--format", "html",
    "--report", report,
    "--out", renderedHtml,
  ]);

  const comparison = JSON.parse(await readFile(report, "utf8"));
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
  assert.equal(ambientComparison.symbols.find((symbol) => symbol.id === "AmbientRoot.run")?.shape.kind,
    "union");
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
    compatible: 2,
    weak: 0,
    missing: 2,
  });
  assert.deepEqual(comparison.diagnosticSummary, {
    error: 1,
    warning: 0,
    info: 5,
  });
  assert.equal(comparison.results.find((result) => result.id === "missing")?.diagnostics[0]?.code,
    "lean_descriptor_missing");
  assert.equal(comparison.results.find((result) => result.id === "gap")?.diagnostics[0]?.severity, "info");
  assert.deepEqual(comparison.results.find((result) => result.id === "gap")?.portIntent,
    { disposition: "unsupported" });
  assert.equal(comparison.results.find((result) => result.ts === "Demo.Controls.reset")?.tsSymbol.kind, "method");
  assert.deepEqual(
    comparison.results.find((result) => result.ts === "Demo.Controls.reset")?.diagnostics.map((item) => item.code),
    ["reviewed_explicit_method_receiver", "reviewed_effect", "primitive_representation_compatible"],
  );
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
