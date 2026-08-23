/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSurfaceReports,
  renderSurfaceDeltaMarkdown,
} from "../../scripts/analysis/compare-surface-reports.mjs";
import {
  nativeExternFixture,
  surfaceDefinition,
  targetCaptureFixture,
} from "./fixtures.mjs";
import { aggregateSurfaceDeclarations } from "../../scripts/analysis/surface-report-schema.mjs";

const eqv = { kind: "missingExtern", name: "Lean.Expr.eqv" };
const dbg = { kind: "missingExtern", name: "Lean.Expr.dbgToString" };
const trim = { kind: "missingExtern", name: "String.Internal.trim" };

test("surface comparison reports exact unlocks, regressions, and nearest blocker transitions", () => {
  const control = report([
    blocked("A.pubUnlock", "Lean.A", "publicConstant", eqv),
    blocked("A.privateReveal", "Lean.A", "privateConstant", eqv),
    runnable("B.pubRegression", "Std.B", "publicConstant"),
    blocked("B.generatedUnlock", "Std.B", "generated", trim),
    runnable("A.same", "Lean.A", "publicConstant"),
  ]);
  const candidate = report([
    runnable("A.pubUnlock", "Lean.A", "publicConstant"),
    blocked("A.privateReveal", "Lean.A", "privateConstant", dbg),
    blocked("B.pubRegression", "Std.B", "publicConstant", dbg),
    runnable("B.generatedUnlock", "Std.B", "generated"),
    runnable("A.same", "Lean.A", "publicConstant"),
  ], ["Lean.Expr.eqv"], { "Lean.Expr.eqv": "native" });

  const delta = compareSurfaceReports(control, candidate, {
    control: "/tmp/control.json",
    candidate: "/tmp/candidate.json",
  });

  assert.equal(delta.format, "lean-vir-library-surface-delta");
  assert.equal(delta.version, 1);
  assert.deepEqual(delta.changes, {
    newlyRunnable: 2,
    publicNewlyRunnable: 1,
    regressions: 1,
    publicRegressions: 1,
    changedBlockers: 1,
  });
  assert.deepEqual(delta.capabilities.added.map((extern) => extern.name), ["Lean.Expr.eqv"]);
  assert.deepEqual(delta.capabilities.removed, []);
  assert.deepEqual(delta.externs.transitions, [{
    name: "Lean.Expr.eqv",
    module: "Lean.A",
    previousStatus: "missing",
    status: "native",
    targets: [{ kind: "standard", backend: "all", value: "lean_expr_eqv" }],
  }]);
  assert.deepEqual(
    delta.declarations.newlyRunnable.map((declaration) => declaration.name),
    ["A.pubUnlock", "B.generatedUnlock"],
  );
  assert.deepEqual(
    delta.declarations.regressions.map((declaration) => declaration.name),
    ["B.pubRegression"],
  );
  assert.deepEqual(
    delta.declarations.changedBlockers.map((declaration) => declaration.name),
    ["A.privateReveal"],
  );
  assert.equal(delta.unlockedByBlocker[0].blocker.name, "Lean.Expr.eqv");
  assert.equal(delta.unlockedByBlocker[0].publicRoots, 1);
  assert.equal(delta.blockerTransitions[0].previousBlocker.name, "Lean.Expr.eqv");
  assert.equal(delta.blockerTransitions[0].blocker.name, "Lean.Expr.dbgToString");
  assert.equal(delta.folders.find((folder) => folder.name === "Lean").publicNewlyRunnable, 1);
  assert.equal(delta.modules.find((module) => module.name === "Lean.A").publicNewlyRunnable, 1);
  assert.equal(delta.modules.find((module) => module.name === "Std.B").regressions, 1);

  const markdown = renderSurfaceDeltaMarkdown(delta);
  assert.match(markdown, /Public constants \| 2 \/ 3 \(66\.7%\) \| 2 \/ 3 \(66\.7%\) \| 1 \| 1/);
  assert.match(markdown, /`Lean\.Expr\.eqv` \| `lean_Lean_Expr_eqv`/);
  assert.match(markdown, /Nearest Blocker Transitions/);
  assert.match(markdown, /Exact Declaration Sets/);
});

test("surface comparison rejects a different Lean build", () => {
  const control = report([runnable("A.same", "Lean.A", "publicConstant")]);
  const candidate = structuredClone(control);
  candidate.lean.githash = "different";
  assert.throws(
    () => compareSurfaceReports(control, candidate),
    /Lean git hash differs/,
  );
});

test("exact-target comparison rejects a different captured source", () => {
  const declarations = [blocked("A.entry", "Lean.A", "publicConstant", eqv)];
  const control = exactTargetReport(declarations, "a".repeat(64));
  const candidate = exactTargetReport(declarations, "b".repeat(64));
  assert.throws(
    () => compareSurfaceReports(control, candidate),
    /captured source SHA-256 differs/,
  );
});

test("exact-target comparison rejects a different root-reachable graph", () => {
  const declarations = [blocked("A.entry", "Lean.A", "publicConstant", eqv)];
  const control = exactTargetReport(declarations, "a".repeat(64), "c".repeat(64));
  const candidate = exactTargetReport(declarations, "a".repeat(64), "d".repeat(64));
  assert.throws(
    () => compareSurfaceReports(control, candidate),
    /root-reachable graph SHA-256 differs/,
  );
});

function exactTargetReport(
  declarations,
  sourceSha256,
  rootGraphSha256 = "d".repeat(64),
) {
  const value = report(declarations);
  value.version = 3;
  value.capture = targetCaptureFixture({
    sourceSha256,
    rootGraphSha256,
  });
  value.definition = surfaceDefinition(true);
  value.selectedModules = ["Library.Entry"];
  value.selectedDeclarations = declarations.map((declaration) => declaration.name);
  value.closure = {
    selectedRoots: declarations.length,
    capturedNodes: declarations.length,
    rootReachableNodes: declarations.length,
    supportOnlyNodes: 0,
  };
  value.runtimeCapabilities.primitiveNamespaces = ["Lean"];
  value.externs = value.externs.map((declaration) => ({
    ...declaration,
    type: null,
    doc: null,
  }));
  value.reachableBlockers = [];
  value.declarations = declarations.map((declaration) => ({
    ...declaration,
    type: null,
    doc: null,
    blockers: declaration.blocker
      ? [{ blocker: declaration.blocker, path: declaration.blockerPath }]
      : [],
  }));
  const aggregates = aggregateSurfaceDeclarations(value.declarations);
  value.counts = aggregates.counts;
  value.modules = aggregates.modules;
  value.libraries = aggregates.libraries;
  value.primaryBlockers = summarizeBlockers(value.declarations, false);
  value.reachableBlockers = summarizeBlockers(value.declarations, true);
  return value;
}

function summarizeBlockers(declarations, all) {
  const summaries = new Map();
  for (const declaration of declarations) {
    const blockers = all
      ? declaration.blockers
      : declaration.blocker
        ? [{ blocker: declaration.blocker, path: declaration.blockerPath }]
        : [];
    for (const entry of blockers) {
      const key = `${entry.blocker.kind}\u0000${entry.blocker.name}`;
      const summary = summaries.get(key) ?? {
        blocker: entry.blocker,
        roots: 0,
        publicRoots: 0,
        exampleRoot: declaration.name,
        examplePath: entry.path,
      };
      summary.roots += 1;
      if (declaration.kind === "publicConstant") summary.publicRoots += 1;
      summaries.set(key, summary);
    }
  }
  return [...summaries.values()];
}

function report(declarations, nativeNames = [], statusOverrides = {}) {
  const counts = countDeclarations(declarations);
  const modules = [...new Set(declarations.map((declaration) => declaration.module))]
    .sort()
    .map((name) => ({
      name,
      counts: countDeclarations(declarations.filter((declaration) => declaration.module === name)),
    }));
  const nativeExterns = nativeNames.map((name) => nativeExternFixture(name));
  return {
    format: "lean-vir-library-surface",
    version: 2,
    lean: {
      version: "4.test",
      toolchain: "leanprover/lean4:test",
      githash: "same-build",
    },
    definition: {
      headline: "static transitive IR closure completeness",
      encodingIsGate: false,
    },
    selectedModules: ["Lean.A", "Std.B"],
    selectedDeclarations: [],
    loadedModules: 2,
    counts,
    runtimeCapabilities: {
      nativeExternCount: nativeExterns.length,
      nativeExterns,
    },
    libraries: [],
    modules,
    primaryBlockers: [],
    externs: [
      extern("Lean.Expr.eqv", "Lean.A", statusOverrides["Lean.Expr.eqv"] ?? "missing", "lean_expr_eqv"),
      extern("Lean.Expr.dbgToString", "Lean.A", "missing", "lean_expr_dbg_to_string"),
      extern("String.Internal.trim", "Std.B", "missing", "lean_string_trim"),
    ],
    declarations,
  };
}

function extern(name, module, status, value) {
  return {
    name,
    module,
    status,
    targets: [{ kind: "standard", backend: "all", value }],
  };
}

function runnable(name, module, kind) {
  return { name, module, kind, runnable: true, blocker: null, blockerPath: [] };
}

function blocked(name, module, kind, blocker) {
  return { name, module, kind, runnable: false, blocker, blockerPath: [name, blocker.name] };
}

function countDeclarations(declarations) {
  const counts = {
    total: declarations.length,
    runnable: 0,
    blocked: 0,
    publicTotal: 0,
    publicRunnable: 0,
    privateTotal: 0,
    boxedTotal: 0,
    generatedTotal: 0,
  };
  for (const declaration of declarations) {
    if (declaration.runnable) counts.runnable += 1;
    else counts.blocked += 1;
    if (declaration.kind === "publicConstant") {
      counts.publicTotal += 1;
      if (declaration.runnable) counts.publicRunnable += 1;
    } else if (declaration.kind === "privateConstant") {
      counts.privateTotal += 1;
    } else if (declaration.kind === "boxed") {
      counts.boxedTotal += 1;
    } else if (declaration.kind === "generated") {
      counts.generatedTotal += 1;
    }
  }
  return counts;
}
