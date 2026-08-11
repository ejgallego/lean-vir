/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";

import {
  aggregateSurfaceDeclarations,
  CURRENT_SURFACE_REPORT_VERSION,
  isSha256,
  isSurfaceAbi,
  SURFACE_REPORT_FORMAT,
  surfaceAbiMatchesCapability,
  validateSurfaceReport,
} from "./surface-report-schema.mjs";

const GRAPH_FORMAT = "lean-ir-surface-graph";

export function analyzeSurfaceGraph(graph, capabilityReport, provenance) {
  validateInputs(graph, capabilityReport, provenance);
  const nodes = new Map(graph.nodes.map((node) => [node.name, node]));
  const capabilities = new Map(
    capabilityReport.runtimeCapabilities.nativeExterns.map((entry) => [entry.name, entry]),
  );
  const primitiveNamespaces = new Set(capabilityReport.runtimeCapabilities.primitiveNamespaces);
  const analyses = graph.capture.roots.map((root) =>
    analyzeRoot(root, nodes, capabilities, primitiveNamespaces));
  const declarations = analyses.map(({ root, blockers }) => {
    const node = nodes.get(root);
    if (!node || node.kind !== "function") {
      throw new Error(`selected root ${JSON.stringify(root)} is not a captured IR function`);
    }
    const primary = blockers[0] ?? null;
    return {
      name: root,
      module: node.module,
      kind: node.class,
      runnable: primary === null,
      blocker: primary?.blocker ?? null,
      blockerPath: primary?.path ?? [],
      blockers,
      type: node.type ?? null,
      doc: node.doc ?? null,
    };
  });
  const reached = new Set(analyses.flatMap((analysis) => [...analysis.reached]));
  const capturedNodes = graph.nodes.length;
  const rootReachableNodes = reached.size;
  const externs = [...reached]
    .map((name) => nodes.get(name))
    .filter((node) => node?.kind === "extern")
    .map((node) => {
      const capability = capabilities.get(node.name);
      const incompatible = capability && !nativeAbiMatches(node.abi, capability);
      return {
        name: node.name,
        module: node.module,
        status: incompatible ? "incompatible" : capability ? "native" : node.host ? "host" : "missing",
        targets: node.targets,
        ...(incompatible ? {
          targetAbi: node.abi,
          capabilityAbi: nativeCapabilityAbi(capability),
        } : {}),
        type: node.type ?? null,
        doc: node.doc ?? null,
      };
    })
    .sort(compareByModuleAndName);
  const { counts, modules, libraries } = aggregateSurfaceDeclarations(declarations);
  const runtimeCapabilities = {
    ...capabilityReport.runtimeCapabilities,
    lean: capabilityReport.lean,
  };
  const report = {
    format: SURFACE_REPORT_FORMAT,
    version: CURRENT_SURFACE_REPORT_VERSION,
    lean: graph.lean,
    capture: {
      mode: "targetToolchainSource",
      source: graph.capture.source,
      sourceSha256: provenance.sourceSha256,
      graphSha256: provenance.graphSha256,
      rootGraphSha256: rootReachableGraphSha256(graph),
      module: graph.capture.module,
      supportRoots: graph.capture.supportRoots,
      graphFormat: graph.format,
      graphVersion: graph.version,
      ...(provenance.clientNativeExternManifest
        ? { clientNativeExternManifest: provenance.clientNativeExternManifest }
        : {}),
    },
    definition: {
      headline: "static transitive IR closure completeness",
      encodingIsGate: false,
      interfaceCallabilityIsGate: false,
      dynamicValidationIsGate: false,
      primaryBlockerPolicy: "shortest terminal path, then lexical boundary",
      completeBlockerFrontier: true,
      blockerCoverage: "complete terminal frontier per selected root",
      externScope: "extern declarations reached from selected roots",
      hostProvisioningVerified: false,
      missingNodeKind: "namespace heuristic",
    },
    selectedModules: [graph.capture.module],
    selectedDeclarations: graph.capture.roots,
    loadedModules: graph.capture.loadedModules,
    closure: {
      selectedRoots: graph.capture.roots.length,
      capturedNodes,
      rootReachableNodes,
      supportOnlyNodes: capturedNodes - rootReachableNodes,
    },
    runtimeCapabilities,
    counts,
    libraries,
    modules,
    primaryBlockers: summarizeBlockers(declarations, false),
    reachableBlockers: summarizeBlockers(declarations, true),
    externs,
    declarations,
  };
  return validateSurfaceReport(report, {
    label: "analyzed surface report",
    versions: [CURRENT_SURFACE_REPORT_VERSION],
  });
}

function rootReachableGraphSha256(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.name, node]));
  const pending = [...graph.capture.roots];
  const reached = new Set();
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const name = pending[cursor];
    if (reached.has(name)) continue;
    reached.add(name);
    for (const dependency of nodes.get(name)?.deps ?? []) {
      if (!reached.has(dependency)) pending.push(dependency);
    }
  }
  const identity = {
    format: graph.format,
    version: graph.version,
    lean: graph.lean,
    capture: {
      module: graph.capture.module,
      roots: graph.capture.roots,
    },
    nodes: [...reached]
      .sort(compareText)
      .map((name) => nodes.get(name) ?? { name, kind: "uncaptured" }),
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(identity))).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function analyzeRoot(root, nodes, capabilities, primitiveNamespaces) {
  const pending = [root];
  const paths = new Map([[root, [root]]]);
  const reached = new Set();
  const blockers = [];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const name = pending[cursor];
    if (reached.has(name)) continue;
    reached.add(name);
    const path = paths.get(name);
    const outcome = classifyNode(name, nodes, capabilities, primitiveNamespaces);
    if (outcome.blocker) {
      blockers.push({ blocker: outcome.blocker, path });
      continue;
    }
    for (const dependency of [...outcome.deps].sort(compareText)) {
      if (!paths.has(dependency)) {
        paths.set(dependency, [...path, dependency]);
        pending.push(dependency);
      }
    }
  }
  blockers.sort((lhs, rhs) =>
    lhs.path.length - rhs.path.length
      || compareText(lhs.blocker.name, rhs.blocker.name)
      || compareText(lhs.blocker.kind, rhs.blocker.kind));
  return { root, reached, blockers };
}

function classifyNode(name, nodes, capabilities, primitiveNamespaces) {
  const capability = capabilities.get(name);
  const node = nodes.get(name);
  if (capability) {
    if (!nativeAbiMatches(node?.abi, capability)) {
      return { blocker: { kind: "incompatibleExtern", name } };
    }
    return { deps: capability.deps ?? [] };
  }
  if (!node || node.kind === "missing") {
    return {
      blocker: {
        kind: isNativeExternCandidate(name, primitiveNamespaces) ? "missingExtern" : "missingDecl",
        name,
      },
    };
  }
  if (node.kind === "extern") {
    if (node.host) return { deps: [] };
    return { blocker: { kind: "missingExtern", name } };
  }
  if (node.unsupportedInitGlobal) {
    return { blocker: { kind: "unsupportedInitGlobal", name } };
  }
  return { deps: node.deps ?? [] };
}

function nativeAbiMatches(targetAbi, capability) {
  if (targetAbi === undefined || targetAbi === null) return true;
  return surfaceAbiMatchesCapability(targetAbi, capability);
}

function nativeCapabilityAbi(capability) {
  return {
    params: capability.params.map(({ borrow, type }) => ({ borrow, type })),
    resultType: capability.resultType,
  };
}

function isNativeExternCandidate(name, primitiveNamespaces) {
  return primitiveNamespaces.has(name.split(".", 1)[0]);
}

function summarizeBlockers(declarations, all) {
  const grouped = new Map();
  for (const declaration of declarations) {
    const entries = all ? declaration.blockers : declaration.blockers.slice(0, 1);
    for (const entry of entries) {
      const key = `${entry.blocker.kind}\0${entry.blocker.name}`;
      const previous = grouped.get(key);
      if (previous) {
        previous.roots += 1;
        if (declaration.kind === "publicConstant") previous.publicRoots += 1;
        if (entry.path.length < previous.examplePath.length) {
          previous.exampleRoot = declaration.name;
          previous.examplePath = entry.path;
        }
      } else {
        grouped.set(key, {
          blocker: entry.blocker,
          roots: 1,
          publicRoots: declaration.kind === "publicConstant" ? 1 : 0,
          exampleRoot: declaration.name,
          examplePath: entry.path,
        });
      }
    }
  }
  return [...grouped.values()].sort((lhs, rhs) =>
    rhs.roots - lhs.roots
      || lhs.examplePath.length - rhs.examplePath.length
      || compareText(lhs.blocker.name, rhs.blocker.name));
}

function validateInputs(graph, capabilityReport, provenance) {
  if (graph?.format !== GRAPH_FORMAT || ![1, 2, 3].includes(graph.version)
      || !Array.isArray(graph.nodes)) {
    throw new Error(`expected ${GRAPH_FORMAT} version 1, 2, or 3 input`);
  }
  if (!Array.isArray(graph.capture?.roots) || graph.capture.roots.length === 0) {
    throw new Error("surface graph has no selected roots");
  }
  if (!provenance || !isSha256(provenance.sourceSha256)
      || !isSha256(provenance.graphSha256)) {
    throw new Error("surface graph analysis requires source and graph SHA-256 provenance");
  }
  if (graph.version >= 3) {
    for (const node of graph.nodes) {
      if ((node?.kind === "function" || node?.kind === "extern") && !isSurfaceAbi(node.abi)) {
        throw new Error(`surface graph node ${JSON.stringify(node?.name)} has invalid ABI metadata`);
      }
    }
  }
  validateSurfaceReport(capabilityReport, {
    label: "capability input",
    versions: [CURRENT_SURFACE_REPORT_VERSION],
  });
}

export function renderTargetSurfaceMarkdown(report) {
  const targetLean = report.lean;
  const policyLean = report.runtimeCapabilities.lean;
  const lines = [
    "# VIR Target Surface",
    "",
    `- Target: \`${report.selectedDeclarations.join("`, `")}\``,
    `- Captured with Lean: \`${targetLean.version}\` (\`${targetLean.githash}\`)`,
    `- VIR capability policy: Lean \`${policyLean.version}\` (\`${policyLean.githash}\`)`,
    ...(report.capture.clientNativeExternManifest ? [
      `- Client-native profile: \`${report.capture.clientNativeExternManifest.source}\` `
        + `(${report.capture.clientNativeExternManifest.externs.length} externs)`,
    ] : []),
    `- Static closure: **${report.counts.blocked === 0 ? "complete" : "blocked"}**`,
    `- Root-reachable graph nodes: ${report.closure.rootReachableNodes} / ${report.closure.capturedNodes} captured`,
    `- Capability-support-only nodes: ${report.closure.supportOnlyNodes}`,
    `- Reached extern boundaries: ${report.externs.length}`,
    `- Missing extern boundaries: ${report.externs.filter((entry) => entry.status === "missing").length}`,
    `- ABI-incompatible extern boundaries: ${report.externs.filter((entry) => entry.status === "incompatible").length}`,
    `- All terminal blockers: ${report.reachableBlockers.length}`,
    "",
    "This verdict covers static IR closure only. Package encoding, linking, and browser execution are separate stages.",
    "The frontier includes every terminal under the current policy; a new native capability may add runtime dependencies, so rerun after policy changes.",
    "Host boundaries are accepted from their annotation; host provisioning is not verified here.",
    "",
    "## Complete Blocker Frontier",
    "",
    "| Kind | Boundary | Roots | Steps | Example path |",
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const summary of report.reachableBlockers) {
    lines.push(
      `| \`${summary.blocker.kind}\` | \`${summary.blocker.name}\` | ${summary.roots} | `
        + `${Math.max(0, summary.examplePath.length - 1)} | `
        + `\`${formatPath(summary.examplePath).join(" → ")}\` |`,
    );
  }
  if (report.reachableBlockers.length === 0) lines.push("| — | — | 0 | 0 | — |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatPath(path) {
  if (path.length <= 10) return path;
  return [...path.slice(0, 6), "…", ...path.slice(-3)];
}

function compareByModuleAndName(lhs, rhs) {
  return compareText(lhs.module, rhs.module) || compareText(lhs.name, rhs.name);
}

function compareText(lhs, rhs) {
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}
