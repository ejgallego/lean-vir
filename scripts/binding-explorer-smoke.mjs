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
  roots: 29,
  targets: 132,
  provided: 132,
  missingProvider: 0,
  runtimeOnly: 0,
  auditedRoots: 1,
  pendingRoots: 22,
  internalRoots: 6,
  semantic: { exact: 0, compatible: 2, weak: 2, missing: 3 },
  upstreamSymbols: 50,
  issues: { error: 0, warning: 2, gap: 3, review: 22 },
});

const roots = report.libraries.flatMap((library) =>
  library.roots.map((root) => ({ library: library.id, ...root })));
const targets = roots.flatMap((root) => root.bindings.map((binding) => binding.target));
assert.equal(new Set(targets).size, 132, "every shipped target should occur exactly once");

const documentRoot = roots.find((root) => root.library === "browser" && root.id === "document");
assert.equal(documentRoot?.status, "pending");
assert.deepEqual(documentRoot?.upstream.roots, ["Document"]);
assert.ok(documentRoot?.bindings.some((binding) => binding.target === "browser.document.getTitle"));

const reactDomRoot = roots.find((root) => root.library === "react" && root.id === "react-dom-root");
assert.equal(reactDomRoot?.status, "missing");
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

assert.match(html, /<h1>Library explorer<\/h1>/u);
assert.match(html, /id="provided-metric">132\/132</u);
assert.match(html, /id="search" type="search"/u);
assert.match(html, /Semantic comparison/u);
const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(dataMatch, "explorer should embed its machine report");
assert.equal(JSON.parse(dataMatch[1]).summary.targets, 132);
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu)];
assert.ok(scripts.length >= 2, "explorer should include data and interaction scripts");
Function(scripts.at(-1)[1]);

console.log("binding explorer smoke ok: 6 libraries, 29 roots, 50 upstream symbols, 132 unique targets");
