#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = JSON.parse(await readFile("docs/bindings/report.json", "utf8"));
const html = await readFile("docs/bindings/index.html", "utf8");

assert.equal(report.format, "lean-vir-binding-explorer");
assert.deepEqual(report.summary, {
  libraries: 6,
  apiGroups: 29,
  targets: 132,
  provided: 132,
  missingProvider: 0,
  runtimeOnly: 0,
  publicSurface: {
    entries: 363,
    targetEdges: 2888,
    reachedTargets: 132,
  },
  analysis: {
    externalGroups: 23,
    complete: 1,
    inProgress: 0,
    automatic: 19,
    curated: 1,
    needsInput: 2,
    notRun: 0,
    notApplicable: 6,
  },
  semantic: { exact: 0, compatible: 7, weak: 2, missing: 3 },
  upstreamSymbols: 2104,
  coverage: {
    groups: 20,
    members: 2066,
    reviewed: 4,
    suggested: 58,
    ambiguous: 1,
    missing: 2003,
  },
  issues: { error: 0, warning: 2, gap: 19 },
});

const roots = report.libraries.flatMap((library) =>
  library.apiGroups.map((root) => ({ library: library.id, ...root })));
const targets = roots.flatMap((root) => root.bindings.map((binding) => binding.target));
assert.equal(new Set(targets).size, 132, "every shipped target should occur exactly once");
const publicEntries = new Map(report.publicEntries.map((entry) => [entry.declaration, entry]));
assert.equal(publicEntries.size, 363);
assert.deepEqual(
  publicEntries.get("Lean.Vir.Browser.HTMLCanvasElement.getContext2D")?.targets.find(
    (entry) => entry.target === "browser.htmlCanvasElement.getContext2D",
  )?.path,
  [
    "Lean.Vir.Browser.HTMLCanvasElement.getContext2D",
    "_private.Vir.Browser.0.Lean.Vir.Browser.HTMLCanvasElement.getContext2DNullable",
  ],
);

const documentRoot = roots.find((root) => root.library === "browser" && root.id === "document");
assert.deepEqual(documentRoot?.analysis, {
  status: "complete",
  scope: "complete-upstream-surface",
});
assert.equal(documentRoot?.findingStatus, "gap");
assert.deepEqual(documentRoot?.upstream.roots, ["Document"]);
assert.ok(documentRoot?.bindings.some((binding) => binding.target === "browser.document.getTitle"));
assert.deepEqual(documentRoot?.comparison.summary, {
  exact: 0,
  compatible: 5,
  weak: 0,
  missing: 0,
});
assert.deepEqual(documentRoot?.coverage.summary, {
  exact: 0,
  compatible: 4,
  weak: 0,
  missing: 267,
  unreviewed: 0,
  mappedTargets: 5,
});
const documentTitle = documentRoot?.coverage.members.find((member) => member.id === "Document.title");
assert.equal(documentTitle?.status, "compatible");
assert.deepEqual(documentTitle?.mapping.targets, [
  "browser.document.getTitle",
  "browser.document.setTitle",
]);
const documentQuerySelector = documentRoot?.coverage.members.find(
  (member) => member.id === "Document.querySelector",
);
assert.equal(documentQuerySelector?.inheritedFrom, "ParentNode");
assert.equal(documentQuerySelector?.status, "compatible");

const canvasElement = roots.find((root) =>
  root.library === "browser" && root.id === "canvas-element");
assert.deepEqual(canvasElement?.analysis, {
  status: "automatic",
  scope: "complete-upstream-surface",
});
assert.equal(canvasElement?.findingStatus, "gap");
assert.deepEqual(canvasElement?.summary, { bindings: 6, provided: 6, issues: 1 });
assert.deepEqual(canvasElement?.coverage.summary, {
  exact: 0,
  compatible: 0,
  weak: 0,
  missing: 330,
  unreviewed: 3,
  suggested: 3,
  ambiguous: 0,
  mappedTargets: 5,
  ambiguousTargets: 0,
  unmatchedTargets: 1,
});
const canvasContext = canvasElement?.coverage.targetMappings.find(
  (mapping) => mapping.target === "browser.htmlCanvasElement.getContext2D",
);
assert.equal(canvasContext?.status, "suggested");
assert.deepEqual(canvasContext?.candidates, [
  {
    typescript: "HTMLCanvasElement.getContext",
    score: 80,
    reason: "shared member-name prefix on matching owner",
  },
]);
assert.equal(
  canvasElement?.coverage.targetMappings.find(
    (mapping) => mapping.target === "browser.htmlCanvasElement.fromElement",
  )?.status,
  "unmatched",
);

const localCommands = roots.find((root) =>
  root.library === "infoview" && root.id === "commands");
assert.deepEqual(localCommands?.analysis, {
  status: "needs-input",
  scope: "local-upstream-contract-missing",
});

const reactDomRoot = roots.find((root) => root.library === "react" && root.id === "react-dom-root");
assert.deepEqual(reactDomRoot?.analysis, {
  status: "curated",
  scope: "selected-symbol-comparison",
});
assert.equal(reactDomRoot?.findingStatus, "warning");
assert.deepEqual(reactDomRoot?.comparison.summary, {
  exact: 0,
  compatible: 2,
  weak: 2,
  missing: 3,
});
assert.equal(
  reactDomRoot?.comparison.results.find((result) => result.id === "react_dom.root.create")?.target,
  "react.root.create",
);

assert.match(html, /<h1>Binding explorer<\/h1>/u);
assert.match(html, /id="provided-metric">132\/132</u);
assert.match(html, /id="search" type="search"/u);
assert.match(html, /Complete surface analysis/u);
assert.match(html, /Automatic analysis/u);
assert.match(html, /Upstream contract needs input/u);
assert.match(html, /runtime coverage and API fidelity/u);
assert.match(html, /Upstream libraries/u);
assert.match(html, /Public Lean API/u);
assert.match(html, /Host targets/u);
assert.match(html, /Expected versus actual type/u);
assert.match(html, /Reviewed type fidelity/u);
assert.match(html, /Upstream TypeScript surface/u);
const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(dataMatch, "explorer should embed its machine report");
assert.equal(JSON.parse(dataMatch[1]).summary.targets, 132);
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu)];
assert.ok(scripts.length >= 2, "explorer should include data and interaction scripts");
Function(scripts.at(-1)[1]);

console.log("binding explorer smoke ok: 6 libraries, 29 API groups, 2104 upstream symbols, 132 unique targets");
