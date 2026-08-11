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
  analysis: {
    externalGroups: 23,
    complete: 1,
    inProgress: 0,
    curated: 1,
    notRun: 21,
    notApplicable: 6,
  },
  semantic: { exact: 0, compatible: 7, weak: 2, missing: 3 },
  upstreamSymbols: 321,
  coverage: { groups: 1, members: 271, mapped: 4, missing: 267 },
  issues: { error: 0, warning: 2, gap: 4 },
});

const roots = report.libraries.flatMap((library) =>
  library.apiGroups.map((root) => ({ library: library.id, ...root })));
const targets = roots.flatMap((root) => root.bindings.map((binding) => binding.target));
assert.equal(new Set(targets).size, 132, "every shipped target should occur exactly once");

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
  status: "not-run",
  scope: "identified-upstream-entry-points",
});
assert.equal(canvasElement?.findingStatus, "none");
assert.deepEqual(canvasElement?.summary, { bindings: 6, provided: 6, issues: 0 });

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
assert.match(html, /Upstream analysis not run/u);
assert.match(html, /runtime coverage and API fidelity/u);
assert.match(html, /Type fidelity comparisons/u);
assert.match(html, /Upstream TypeScript surface/u);
const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(dataMatch, "explorer should embed its machine report");
assert.equal(JSON.parse(dataMatch[1]).summary.targets, 132);
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu)];
assert.ok(scripts.length >= 2, "explorer should include data and interaction scripts");
Function(scripts.at(-1)[1]);

console.log("binding explorer smoke ok: 6 libraries, 29 API groups, 321 upstream symbols, 132 unique targets");
