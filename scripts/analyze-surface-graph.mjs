/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_SURFACE_REPORT_VERSION,
  SURFACE_REPORT_FORMAT,
} from "./surface-report-schema.mjs";

const GRAPH_FORMAT = "lean-ir-surface-graph";

export function analyzeSurfaceGraph(graph, capabilityReport, provenance = {}) {
  validateInputs(graph, capabilityReport);
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
    .map((node) => ({
      name: node.name,
      module: node.module,
      status: capabilities.has(node.name) ? "native" : node.host ? "host" : "missing",
      targets: node.targets,
      type: node.type ?? null,
      doc: node.doc ?? null,
    }))
    .sort(compareByModuleAndName);
  const counts = countDeclarations(declarations);
  const modules = aggregateModules(declarations);
  const libraries = aggregateLibraries(modules);
  const runtimeCapabilities = {
    ...capabilityReport.runtimeCapabilities,
    lean: capabilityReport.lean,
  };
  return {
    format: SURFACE_REPORT_FORMAT,
    version: CURRENT_SURFACE_REPORT_VERSION,
    lean: graph.lean,
    capture: {
      mode: "targetToolchainSource",
      source: graph.capture.source,
      sourceSha256: provenance.sourceSha256 ?? null,
      graphSha256: provenance.graphSha256 ?? null,
      module: graph.capture.module,
      supportRoots: graph.capture.supportRoots,
      graphFormat: graph.format,
      graphVersion: graph.version,
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
  if (capability) return { deps: capability.deps ?? [] };
  const node = nodes.get(name);
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

function isNativeExternCandidate(name, primitiveNamespaces) {
  return primitiveNamespaces.has(name.split(".", 1)[0]);
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
    if (declaration.kind === "publicConstant") {
      counts.publicTotal += 1;
      if (declaration.runnable) counts.publicRunnable += 1;
    } else if (declaration.kind === "privateConstant") counts.privateTotal += 1;
    else if (declaration.kind === "boxed") counts.boxedTotal += 1;
    else counts.generatedTotal += 1;
  }
  counts.blocked = counts.total - counts.runnable;
  return counts;
}

function aggregateModules(declarations) {
  const grouped = new Map();
  for (const declaration of declarations) {
    const group = grouped.get(declaration.module) ?? [];
    group.push(declaration);
    grouped.set(declaration.module, group);
  }
  return [...grouped]
    .map(([name, entries]) => ({ name, counts: countDeclarations(entries) }))
    .sort((lhs, rhs) => compareText(lhs.name, rhs.name));
}

function aggregateLibraries(modules) {
  const grouped = new Map();
  for (const module of modules) {
    const name = module.name.split(".", 1)[0];
    const previous = grouped.get(name) ?? { name, modulesWithFunctions: 0, counts: emptyCounts() };
    previous.modulesWithFunctions += 1;
    addCounts(previous.counts, module.counts);
    grouped.set(name, previous);
  }
  return [...grouped.values()].sort((lhs, rhs) => compareText(lhs.name, rhs.name));
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

function emptyCounts() {
  return {
    total: 0, runnable: 0, blocked: 0, publicTotal: 0, publicRunnable: 0,
    privateTotal: 0, boxedTotal: 0, generatedTotal: 0,
  };
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] ?? 0;
}

function validateInputs(graph, capabilityReport) {
  if (graph?.format !== GRAPH_FORMAT || ![1, 2].includes(graph.version) || !Array.isArray(graph.nodes)) {
    throw new Error(`expected ${GRAPH_FORMAT} version 1 or 2 input`);
  }
  if (!Array.isArray(graph.capture?.roots) || graph.capture.roots.length === 0) {
    throw new Error("surface graph has no selected roots");
  }
  if (capabilityReport?.format !== SURFACE_REPORT_FORMAT
      || !Array.isArray(capabilityReport.runtimeCapabilities?.nativeExterns)
      || !Array.isArray(capabilityReport.runtimeCapabilities?.primitiveNamespaces)) {
    throw new Error("capability input is not a VIR surface report");
  }
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
    `- Static closure: **${report.counts.blocked === 0 ? "complete" : "blocked"}**`,
    `- Root-reachable graph nodes: ${report.closure.rootReachableNodes} / ${report.closure.capturedNodes} captured`,
    `- Capability-support-only nodes: ${report.closure.supportOnlyNodes}`,
    `- Reached extern boundaries: ${report.externs.length}`,
    `- Missing extern boundaries: ${report.externs.filter((entry) => entry.status === "missing").length}`,
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

async function main(args) {
  if (args.length !== 4) {
    console.error(
      "usage: analyze-surface-graph.mjs <graph.json> <capability-surface.json> "
        + "<surface.json> <surface.md>",
    );
    process.exitCode = 2;
    return;
  }
  const [graphArg, capabilityArg, jsonArg, markdownArg] = args.map((arg) => resolve(arg));
  const graph = JSON.parse(await readFile(graphArg, "utf8"));
  const capabilities = JSON.parse(await readFile(capabilityArg, "utf8"));
  const report = analyzeSurfaceGraph(graph, capabilities);
  await Promise.all([
    mkdir(dirname(jsonArg), { recursive: true }),
    mkdir(dirname(markdownArg), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(jsonArg, `${JSON.stringify(report)}\n`),
    writeFile(markdownArg, renderTargetSurfaceMarkdown(report)),
  ]);
  console.log(
    `analyzed ${report.declarations.length} root(s): ${report.counts.runnable} closure-complete, `
      + `${report.reachableBlockers.length} terminal blockers`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
