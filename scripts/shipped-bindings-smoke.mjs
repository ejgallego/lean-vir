#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = JSON.parse(await readFile("docs/bindings/shipped-v1.coverage.json", "utf8"));
const html = await readFile("docs/bindings/shipped-v1.dashboard.html", "utf8");

assert.equal(report.format, "lean-vir-shipped-bindings-coverage");
assert.equal(report.analysis.representationPolicy, "compiler-validated");
assert.equal(report.summary.declarations, 132);
assert.equal(report.summary.virJs, 119);
assert.equal(report.summary.explicitConversions, 13);
assert.deepEqual(report.summary.boundaries, {
  hostResource: 115,
  objectHandle: 4,
  explicitConversion: 13,
});
assert.equal(report.summary.declaredTargets, 132);
assert.equal(report.summary.provided, 132);
assert.equal(report.summary.missingProvider, 0);
assert.equal(report.summary.runtimeOnly, 0);

const byTarget = new Map(report.bindings.map((entry) => [entry.target, entry]));
assert.equal(byTarget.get("browser.document.getTitle")?.declarations[0]?.boundary, "hostResource");
assert.match(byTarget.get("browser.document.getTitle")?.declarations[0]?.type ?? "", /Lean\.Vir\.Js String/u);
assert.equal(byTarget.get("js.string")?.declarations[0]?.boundary, "explicitConversion");
assert.deepEqual(byTarget.get("js.leanRef.retain")?.providers, ["runtime-intrinsic"]);
assert.equal(byTarget.get("react.root.create")?.status, "provided");

assert.match(html, /id="provided-metric">132\/132</u);
assert.match(html, /id="search" type="search"/u);
assert.match(html, /id="boundary"/u);
const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(dataMatch, "dashboard should embed its machine report");
assert.equal(JSON.parse(dataMatch[1]).summary.provided, 132);
const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/gu)];
assert.ok(scripts.length >= 2, "dashboard should include data and interaction scripts");
Function(scripts.at(-1)[1]);

console.log("shipped bindings smoke ok: 119 vir_js + 13 explicit conversions, 132/132 provided");
