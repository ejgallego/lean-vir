#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = JSON.parse(await readFile("build/bindings/shipped-v1.coverage.json", "utf8"));
const html = await readFile("build/bindings/shipped-v1.dashboard.html", "utf8");
const declarations = report.bindings.flatMap((binding) => binding.declarations);

assert.equal(report.format, "lean-vir-shipped-bindings-coverage");
assert.equal(report.analysis.representationPolicy, "compiler-validated");
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
    "_private.Vir.Browser.0.Lean.Vir.Browser.HTMLCanvasElement.getContext2DNullable",
  ],
);

const byTarget = new Map(report.bindings.map((entry) => [entry.target, entry]));
assert.equal(byTarget.get("browser.document.getTitle")?.declarations[0]?.boundary, "hostResource");
assert.match(byTarget.get("browser.document.getTitle")?.declarations[0]?.type ?? "", /Lean\.Vir\.Js String/u);
assert.equal(byTarget.get("js.string")?.declarations[0]?.boundary, "explicitConversion");
assert.deepEqual(byTarget.get("js.leanRef.retain")?.providers, ["runtime-intrinsic"]);
assert.equal(byTarget.get("infoview.command.insertText")?.status, "provided");
assert.equal(
  byTarget.get("infoview.command.insertText")?.declarations[0]?.boundary,
  "hostResource",
);
assert.equal(byTarget.get("react.root.create")?.status, "provided");

assert.match(
  html,
  new RegExp(`id="provided-metric">${report.summary.provided}/${report.summary.totalTargets}`),
);
assert.match(html, /id="search" type="search"/u);
assert.match(html, /id="boundary"/u);
const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(dataMatch, "dashboard should embed its machine report");
assert.deepEqual(JSON.parse(dataMatch[1]).summary, report.summary);
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu)];
assert.ok(scripts.length >= 2, "dashboard should include data and interaction scripts");
Function(scripts.at(-1)[1]);

console.log(
  `shipped bindings smoke ok: ${report.summary.virJs} vir_js + ` +
  `${report.summary.explicitConversions} explicit conversions, ` +
  `${report.summary.provided}/${report.summary.totalTargets} provided`,
);
