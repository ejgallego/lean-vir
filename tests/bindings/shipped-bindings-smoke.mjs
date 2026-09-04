#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  discoverBindingConfigPaths,
  loadBindingConfig,
} from "../../scripts/bindings/binding-config.mjs";

const report = JSON.parse(await readFile("build/bindings/shipped-v1.coverage.json", "utf8"));
const declarations = report.bindings.flatMap((binding) => binding.declarations);
const configPaths = await discoverBindingConfigPaths(resolve("Vir"));
const configs = await Promise.all(configPaths.map(loadBindingConfig));
const generatedSources = new Set(configs.map((config) => config.generation?.output));

assert.equal(generatedSources.has(undefined), false, "every shipped binding library must generate Lean");
for (const declaration of declarations) {
  assert.ok(
    generatedSources.has(declaration.source.path),
    `${declaration.declaration} is handwritten in ${declaration.source.path}`,
  );
}

assert.equal(report.format, "lean-vir-shipped-bindings-coverage");
assert.deepEqual(report.analysis, {
  representationPolicy: "compiler-validated-coarse-boundary",
  ordinaryBoundary: "Unit, JavaScript resources, object handles, and resource-shaped callbacks",
  conversionBoundary: "explicit vir_js_explicit_conversion declarations only",
  providerCoverage: "target-name-presence-only",
  providerBehavior: "not-mechanically-verified",
  semanticParity: "not-analyzed-by-provider-reconciliation",
});
assert.equal(report.summary.declarations, declarations.length);
assert.equal(
  report.summary.virJs,
  declarations.filter((declaration) => declaration.marker === "vir_js").length,
);
assert.equal(
  report.summary.explicitConversions,
  declarations.filter((declaration) =>
    declaration.marker === "vir_js_explicit_conversion").length,
);
assert.equal(
  report.summary.declarations,
  report.summary.virJs + report.summary.explicitConversions,
);
assert.equal(
  report.summary.declarations,
  Object.values(report.summary.boundaries).reduce((sum, count) => sum + count, 0),
);
assert.equal(report.summary.explicitConversions, report.summary.boundaries.explicitConversion);
assert.equal(report.summary.declaredTargets, report.bindings.length);
assert.equal(report.summary.totalTargets, report.bindings.length);
assert.equal(report.summary.provided, report.summary.totalTargets);
assert.equal(report.summary.missingProvider, 0);
assert.equal(report.summary.runtimeOnly, 0);
assert.equal(report.summary.publicEntries, report.publicEntries.length);
assert.equal(
  report.summary.publicTargetEdges,
  report.publicEntries.reduce((sum, entry) => sum + entry.targets.length, 0),
);
assert.equal(
  report.summary.targetsReachedByPublicEntries,
  new Set(report.publicEntries.flatMap((entry) => entry.targets.map((target) => target.target))).size,
);
assert.equal(report.summary.targetsReachedByPublicEntries, report.summary.totalTargets);

const publicEntries = new Map(report.publicEntries.map((entry) => [entry.declaration, entry]));
assert.equal(publicEntries.has("Lean.Vir.Browser.Document.getTitleString"), false);
assert.equal(publicEntries.has("Lean.Vir.Browser.Document.setTitleString"), false);
assert.deepEqual(publicEntries.get("Lean.Vir.Browser.Document.getTitle")?.interface, {
  kind: "function",
  effect: "dom",
  args: [
    {
      name: "document",
      type: {
        type: "Js",
        interfaceTag: 23,
        kind: "resource",
        name: "Lean.Vir.Js",
      },
    },
  ],
  result: { type: "Js", interfaceTag: 23, kind: "resource", name: "Lean.Vir.Js" },
});
assert.equal(
  publicEntries.get("Lean.Vir.Browser.Document.current")?.targets[0]?.target,
  "browser.document.current",
);
assert.deepEqual(
  publicEntries.get("Lean.Vir.Browser.Element.setTextContent")?.interface?.args.map((arg) => arg.name),
  ["element", "textContent"],
);
const publicCanvasContext = publicEntries.get(
  "Lean.Vir.Browser.HTMLCanvasElement.getContext2D",
);
assert.match(publicCanvasContext?.type ?? "", /DomM \(Option \(Lean\.Vir\.Js/u);
assert.deepEqual(
  publicCanvasContext?.targets.find(
    (entry) => entry.target === "browser.htmlCanvasElement.getContext2D",
  )?.path,
  [
    "Lean.Vir.Browser.HTMLCanvasElement.getContext2D",
    "Lean.Vir.Browser.HTMLCanvasElement.getContext2DNullable",
  ],
);

const byTarget = new Map(report.bindings.map((entry) => [entry.target, entry]));
assert.equal(byTarget.get("browser.document.getTitle")?.declarations[0]?.boundary, "hostResource");
assert.match(byTarget.get("browser.document.getTitle")?.declarations[0]?.type ?? "", /Lean\.Vir\.Js String/u);
assert.equal(byTarget.get("js.string")?.declarations[0]?.boundary, "explicitConversion");
assert.equal(byTarget.get("infoview.command.insertText")?.status, "provided");
assert.equal(
  byTarget.get("infoview.command.insertText")?.declarations[0]?.boundary,
  "hostResource",
);
assert.equal(byTarget.get("react.root.create")?.status, "provided");

console.log(
  `shipped bindings smoke ok: ${report.summary.virJs} vir_js + ` +
  `${report.summary.explicitConversions} explicit conversions, ` +
  `${report.summary.provided}/${report.summary.totalTargets} provider keys present`,
);
