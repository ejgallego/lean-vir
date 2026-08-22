/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  emptySurfaceCounts,
  SURFACE_REPORT_FORMAT,
} from "../../scripts/surface-report-schema.mjs";

export const TEST_SHA256 = "a".repeat(64);

export function surfaceCounts(overrides = {}) {
  return {
    ...emptySurfaceCounts(),
    ...overrides,
  };
}

export function surfaceDefinition(completeFrontier = false) {
  return {
    headline: "static transitive IR closure completeness",
    encodingIsGate: false,
    interfaceCallabilityIsGate: false,
    dynamicValidationIsGate: false,
    primaryBlockerPolicy: completeFrontier
      ? "shortest terminal path, then lexical boundary"
      : "deterministic nearest terminal blocker",
    completeBlockerFrontier: completeFrontier,
    blockerCoverage: completeFrontier
      ? "complete terminal frontier per selected root"
      : "one primary terminal blocker per blocked root",
    externScope: completeFrontier
      ? "extern declarations reached from selected roots"
      : "extern declarations owned by selected modules",
    hostProvisioningVerified: false,
    missingNodeKind: "namespace heuristic",
  };
}

export function nativeExternFixture(name, overrides = {}) {
  return {
    name,
    symbol: `lean_${name.replaceAll(".", "_")}`,
    generateBoxedWrapper: false,
    params: [],
    resultType: "object",
    deps: [],
    ...overrides,
  };
}

export function targetCaptureFixture(overrides = {}) {
  return {
    mode: "targetToolchainSource",
    source: "Library/Entry.lean",
    sourceSha256: TEST_SHA256,
    graphSha256: "b".repeat(64),
    rootGraphSha256: "c".repeat(64),
    module: "Library.Entry",
    supportRoots: [],
    graphFormat: "lean-ir-surface-graph",
    graphVersion: 3,
    ...overrides,
  };
}

export function emptySurfaceReportV3(overrides = {}) {
  const counts = surfaceCounts();
  return {
    format: SURFACE_REPORT_FORMAT,
    version: 3,
    lean: {
      version: "4.33.0",
      toolchain: "leanprover/lean4:4.33.0",
      githash: "test-build",
    },
    definition: surfaceDefinition(false),
    selectedModules: [],
    selectedDeclarations: [],
    loadedModules: 0,
    closure: { selectedRoots: 0, capturedNodes: 0, rootReachableNodes: 0, supportOnlyNodes: 0 },
    runtimeCapabilities: {
      nativeExternCount: 0,
      primitiveNamespaces: [],
      nativeExterns: [],
    },
    counts,
    libraries: [],
    modules: [],
    primaryBlockers: [],
    externs: [],
    declarations: [],
    ...overrides,
  };
}
