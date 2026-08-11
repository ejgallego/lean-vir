/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSurfaceGraph, renderTargetSurfaceMarkdown } from "./analyze-surface-graph.mjs";

test("target graph analysis uses VIR capabilities and keeps every terminal blocker", () => {
  const graph = {
    format: "lean-ir-surface-graph",
    version: 2,
    lean: { version: "4.32.0", toolchain: "leanprover/lean4:4.32.0", githash: "target" },
    capture: {
      source: "Library/Main.lean",
      module: "Library.Main",
      roots: ["Library.main"],
      supportRoots: ["Library.capabilityDependency", "Library.unusedCapabilityDependency"],
      loadedModules: 7,
    },
    nodes: [
      node("Library.main", "function", ["Library.helper", "Library.native", "Other.opaque"]),
      node("Library.helper", "function", ["IO.unsupported"]),
      node("Library.native", "extern"),
      node("Library.capabilityDependency", "function"),
      node("Library.unusedCapabilityDependency", "function"),
      node("IO.unsupported", "extern"),
      node("Other.opaque", "missing"),
    ],
  };
  const capabilities = {
    format: "lean-vir-library-surface",
    version: 3,
    lean: { version: "4.33.0-rc2", toolchain: "leanprover/lean4:4.33.0-rc2", githash: "policy" },
    runtimeCapabilities: {
      nativeExternCount: 2,
      primitiveNamespaces: ["IO"],
      nativeExterns: [
        { name: "Library.native", deps: ["Library.capabilityDependency"] },
        { name: "Library.unused", deps: ["Library.unusedCapabilityDependency"] },
      ],
    },
  };
  const report = analyzeSurfaceGraph(
    graph,
    capabilities,
    { graphSha256: "graph-sha", sourceSha256: "source-sha" },
  );
  assert.equal(report.counts.blocked, 1);
  assert.equal(report.capture.graphSha256, "graph-sha");
  assert.equal(report.capture.sourceSha256, "source-sha");
  assert.equal(report.runtimeCapabilities.lean.githash, "policy");
  assert.deepEqual(report.closure, {
    selectedRoots: 1,
    capturedNodes: 7,
    rootReachableNodes: 6,
    supportOnlyNodes: 1,
  });
  assert.equal(report.definition.blockerCoverage, "complete terminal frontier per selected root");
  assert.equal(report.definition.hostProvisioningVerified, false);
  assert.equal(report.declarations[0].type, "IO Unit");
  assert.equal(report.declarations[0].doc, "Runs the library entry point.");
  assert.deepEqual(
    report.declarations[0].blockers.map((entry) => entry.blocker),
    [
      { kind: "missingDecl", name: "Other.opaque" },
      { kind: "missingExtern", name: "IO.unsupported" },
    ],
  );
  assert.equal(report.primaryBlockers[0].blocker.name, "Other.opaque");
  assert.equal(report.reachableBlockers[0].blocker.name, "Other.opaque");
  assert.match(renderTargetSurfaceMarkdown(report), /Complete Blocker Frontier/);
  assert.match(renderTargetSurfaceMarkdown(report), /Root-reachable graph nodes: 6 \/ 7 captured/);
});

test("target graph analysis aggregates complete blocker membership across several roots", () => {
  const graph = {
    format: "lean-ir-surface-graph",
    version: 2,
    lean: { version: "4.32.0", toolchain: "leanprover/lean4:4.32.0", githash: "target" },
    capture: {
      source: "Library/Profile.lean",
      module: "Library.Profile",
      roots: ["Library.main", "Library.secondary", "Library.ready"],
      supportRoots: [],
      loadedModules: 7,
    },
    nodes: [
      node("Library.main", "function", ["IO.shared", "Other.mainOnly"]),
      node("Library.secondary", "function", ["ByteArray.secondaryOnly", "IO.shared"]),
      node("Library.ready", "function"),
      node("IO.shared", "missing"),
      node("Other.mainOnly", "missing"),
      node("ByteArray.secondaryOnly", "missing"),
    ],
  };
  const capabilities = {
    format: "lean-vir-library-surface",
    version: 3,
    lean: { version: "4.33.0-rc2", toolchain: "leanprover/lean4:4.33.0-rc2", githash: "policy" },
    runtimeCapabilities: {
      nativeExternCount: 0,
      primitiveNamespaces: ["ByteArray", "IO"],
      nativeExterns: [],
    },
  };

  const report = analyzeSurfaceGraph(graph, capabilities);
  assert.deepEqual(
    { total: report.counts.total, runnable: report.counts.runnable, blocked: report.counts.blocked },
    { total: 3, runnable: 1, blocked: 2 },
  );
  assert.deepEqual(
    report.declarations.map((declaration) => [declaration.name, declaration.blockers.length]),
    [["Library.main", 2], ["Library.secondary", 2], ["Library.ready", 0]],
  );
  assert.equal(
    report.reachableBlockers.find((summary) => summary.blocker.name === "IO.shared").roots,
    2,
  );
  assert.equal(report.reachableBlockers.length, 3);
  assert.equal(report.primaryBlockers.reduce((sum, summary) => sum + summary.roots, 0), 2);
});

function node(name, kind, deps = []) {
  return {
    name,
    module: name.split(".").slice(0, -1).join("."),
    kind,
    class: kind === "function" ? "publicConstant" : kind,
    deps,
    targets: [],
    host: false,
    unsupportedInitGlobal: false,
    type: name === "Library.main" ? "IO Unit" : null,
    doc: name === "Library.main" ? "Runs the library entry point." : null,
  };
}
