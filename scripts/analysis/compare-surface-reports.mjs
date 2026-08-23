/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareText, isSha256, validateSurfaceReport } from "./surface-report-schema.mjs";

const DELTA_FORMAT = "lean-vir-library-surface-delta";
const DELTA_VERSION = 1;

export function compareSurfaceReports(control, candidate, files = {}) {
  validateComparableReports(control, candidate);

  const controlModules = new Map(control.modules.map((module) => [module.name, module.counts]));
  const candidateModules = new Map(candidate.modules.map((module) => [module.name, module.counts]));
  const moduleChanges = new Map();
  const folderChanges = new Map();
  const libraryChanges = new Map();
  const unlockedByBlocker = new Map();
  const regressedByBlocker = new Map();
  const blockerTransitions = new Map();
  const newlyRunnable = [];
  const regressions = [];
  const changedBlockers = [];

  for (let index = 0; index < control.declarations.length; index += 1) {
    const before = control.declarations[index];
    const after = candidate.declarations[index];
    validateAlignedDeclaration(before, after, index);
    if (!before.runnable && after.runnable) {
      newlyRunnable.push({
        name: before.name,
        module: before.module,
        kind: before.kind,
        previousBlocker: before.blocker,
        previousBlockerPath: before.blockerPath,
      });
      incrementRollups(moduleChanges, folderChanges, libraryChanges, before, "newlyRunnable");
      incrementBoundary(unlockedByBlocker, before.blocker, before, before.blockerPath);
    } else if (before.runnable && !after.runnable) {
      regressions.push({
        name: after.name,
        module: after.module,
        kind: after.kind,
        blocker: after.blocker,
        blockerPath: after.blockerPath,
      });
      incrementRollups(moduleChanges, folderChanges, libraryChanges, after, "regressions");
      incrementBoundary(regressedByBlocker, after.blocker, after, after.blockerPath);
    } else if (!before.runnable && !after.runnable && !sameBlocker(before.blocker, after.blocker)) {
      changedBlockers.push({
        name: before.name,
        module: before.module,
        kind: before.kind,
        previousBlocker: before.blocker,
        blocker: after.blocker,
        previousBlockerPath: before.blockerPath,
        blockerPath: after.blockerPath,
      });
      incrementRollups(moduleChanges, folderChanges, libraryChanges, before, "changedBlockers");
      incrementTransition(blockerTransitions, before, after);
    }
  }

  const changes = {
    newlyRunnable: newlyRunnable.length,
    publicNewlyRunnable: countPublic(newlyRunnable),
    regressions: regressions.length,
    publicRegressions: countPublic(regressions),
    changedBlockers: changedBlockers.length,
  };
  validateCountDelta(control, candidate, changes);

  return {
    format: DELTA_FORMAT,
    version: DELTA_VERSION,
    control: reportIdentity(control, files.control),
    candidate: reportIdentity(candidate, files.candidate),
    changes,
    capabilities: compareNativeCapabilities(control, candidate),
    externs: compareExterns(control, candidate),
    libraries: finishRollups(libraryChanges),
    folders: finishRollups(folderChanges),
    modules: finishRollups(moduleChanges, controlModules, candidateModules),
    unlockedByBlocker: finishBoundaries(unlockedByBlocker),
    regressedByBlocker: finishBoundaries(regressedByBlocker),
    blockerTransitions: finishTransitions(blockerTransitions),
    declarations: {
      newlyRunnable,
      regressions,
      changedBlockers,
    },
  };
}

export function renderSurfaceDeltaMarkdown(delta) {
  const lines = [
    "# VIR Lean Library Surface Delta",
    "",
    `- Control: \`${delta.control.file}\` (${delta.control.lean.githash})`,
    `- Candidate: \`${delta.candidate.file}\` (${delta.candidate.lean.githash})`,
    `- Native capabilities: ${delta.control.nativeExternCount} → ${delta.candidate.nativeExternCount} `
      + `(${signed(delta.capabilities.added.length - delta.capabilities.removed.length)})`,
    "",
    "## Exact Coverage Delta",
    "",
    "| Surface | Control | Candidate | Newly runnable | Regressions |",
    "| --- | ---: | ---: | ---: | ---: |",
    coverageRow(
      "Public constants",
      delta.control.counts.publicRunnable,
      delta.control.counts.publicTotal,
      delta.candidate.counts.publicRunnable,
      delta.candidate.counts.publicTotal,
      delta.changes.publicNewlyRunnable,
      delta.changes.publicRegressions,
    ),
    coverageRow(
      "All IR functions",
      delta.control.counts.runnable,
      delta.control.counts.total,
      delta.candidate.counts.runnable,
      delta.candidate.counts.total,
      delta.changes.newlyRunnable,
      delta.changes.regressions,
    ),
    "",
    `Blocked roots with a different nearest boundary: ${delta.changes.changedBlockers}.`,
    "",
  ];

  appendCapabilityTable(lines, delta.capabilities);
  appendRollupTable(lines, "By Library", delta.libraries, 20);
  appendRollupTable(lines, "Top Changed Folders", delta.folders, 50);
  appendRollupTable(lines, "Top Changed Modules", delta.modules, 50);
  appendBoundaryTable(lines, "Newly Runnable By Previous Blocker", delta.unlockedByBlocker);
  appendTransitionTable(lines, delta.blockerTransitions);
  appendBoundaryTable(lines, "Regressions By New Blocker", delta.regressedByBlocker);
  lines.push(
    "## Exact Declaration Sets",
    "",
    "The JSON companion contains every newly runnable declaration, regression, and changed-blocker path.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function validateComparableReports(control, candidate) {
  for (const [label, report] of [["control", control], ["candidate", candidate]]) {
    validateSurfaceReport(report, { label });
    if (!Array.isArray(report.externs)) throw new Error(`${label}.externs must be an array`);
  }
  requireEqual("report version", control.version, candidate.version);
  requireEqual("Lean toolchain", control.lean?.toolchain, candidate.lean?.toolchain);
  requireEqual("Lean git hash", control.lean?.githash, candidate.lean?.githash);
  requireEqual("surface definition", JSON.stringify(control.definition), JSON.stringify(candidate.definition));
  requireEqual("selected modules", JSON.stringify(control.selectedModules), JSON.stringify(candidate.selectedModules));
  requireEqual(
    "selected declarations",
    JSON.stringify(control.selectedDeclarations ?? []),
    JSON.stringify(candidate.selectedDeclarations ?? []),
  );
  if (control.capture || candidate.capture) {
    requireEqual("capture mode", control.capture?.mode, candidate.capture?.mode);
    requireEqual("capture module", control.capture?.module, candidate.capture?.module);
    requireEqual(
      "captured source SHA-256",
      control.capture?.sourceSha256,
      candidate.capture?.sourceSha256,
    );
    requireEqual("capture graph format", control.capture?.graphFormat, candidate.capture?.graphFormat);
    requireEqual("capture graph version", control.capture?.graphVersion, candidate.capture?.graphVersion);
    if (control.capture?.mode === "targetToolchainSource") {
      requireCaptureHash("control", control.capture, "sourceSha256");
      requireCaptureHash("candidate", candidate.capture, "sourceSha256");
      requireCaptureHash("control", control.capture, "rootGraphSha256");
      requireCaptureHash("candidate", candidate.capture, "rootGraphSha256");
      requireEqual(
        "root-reachable graph SHA-256",
        control.capture.rootGraphSha256,
        candidate.capture.rootGraphSha256,
      );
    }
  }
  requireEqual("declaration count", control.declarations.length, candidate.declarations.length);
}

function requireCaptureHash(label, capture, field) {
  if (!isSha256(capture?.[field])) {
    throw new Error(`${label} capture is missing ${field}`);
  }
}

function validateAlignedDeclaration(before, after, index) {
  for (const field of ["name", "module", "kind"]) {
    if (before[field] !== after[field]) {
      throw new Error(
        `declaration ${index} ${field} differs: ${JSON.stringify(before[field])} != ${JSON.stringify(after[field])}`,
      );
    }
  }
}

function validateCountDelta(control, candidate, changes) {
  const runnableDelta = candidate.counts.runnable - control.counts.runnable;
  const publicDelta = candidate.counts.publicRunnable - control.counts.publicRunnable;
  requireEqual("all-IR runnable delta", runnableDelta, changes.newlyRunnable - changes.regressions);
  requireEqual(
    "public runnable delta",
    publicDelta,
    changes.publicNewlyRunnable - changes.publicRegressions,
  );
}

function requireEqual(label, before, after) {
  if (before !== after) {
    throw new Error(`${label} differs: ${JSON.stringify(before)} != ${JSON.stringify(after)}`);
  }
}

function sameBlocker(before, after) {
  return before?.kind === after?.kind && before?.name === after?.name;
}

function incrementRollups(modules, folders, libraries, declaration, field) {
  incrementRollup(modules, declaration.module, declaration.kind, field);
  incrementRollup(libraries, topLevelName(declaration.module), declaration.kind, field);
  for (const folder of parentFolders(declaration.module)) {
    incrementRollup(folders, folder, declaration.kind, field);
  }
}

function incrementRollup(rollups, name, kind, field) {
  const rollup = rollups.get(name) ?? {
    name,
    newlyRunnable: 0,
    publicNewlyRunnable: 0,
    regressions: 0,
    publicRegressions: 0,
    changedBlockers: 0,
  };
  rollup[field] += 1;
  if (kind === "publicConstant") {
    if (field === "newlyRunnable") rollup.publicNewlyRunnable += 1;
    if (field === "regressions") rollup.publicRegressions += 1;
  }
  rollups.set(name, rollup);
}

function finishRollups(rollups, controlCounts = null, candidateCounts = null) {
  const results = [...rollups.values()];
  if (controlCounts && candidateCounts) {
    for (const result of results) {
      result.controlCounts = controlCounts.get(result.name) ?? null;
      result.candidateCounts = candidateCounts.get(result.name) ?? null;
    }
  }
  return results.sort(changeOrder);
}

function changeOrder(lhs, rhs) {
  return rhs.publicNewlyRunnable - lhs.publicNewlyRunnable
    || rhs.newlyRunnable - lhs.newlyRunnable
    || rhs.publicRegressions - lhs.publicRegressions
    || rhs.regressions - lhs.regressions
    || compareText(lhs.name, rhs.name);
}

function incrementBoundary(boundaries, blocker, declaration, path) {
  const key = blockerKey(blocker);
  const summary = boundaries.get(key) ?? {
    blocker,
    roots: 0,
    publicRoots: 0,
    exampleRoot: declaration.name,
    examplePath: path,
  };
  summary.roots += 1;
  if (declaration.kind === "publicConstant") summary.publicRoots += 1;
  boundaries.set(key, summary);
}

function finishBoundaries(boundaries) {
  return [...boundaries.values()].sort(boundaryOrder);
}

function boundaryOrder(lhs, rhs) {
  return rhs.publicRoots - lhs.publicRoots
    || rhs.roots - lhs.roots
    || compareText(lhs.blocker?.name ?? "", rhs.blocker?.name ?? "");
}

function incrementTransition(transitions, before, after) {
  const key = `${blockerKey(before.blocker)}\n${blockerKey(after.blocker)}`;
  const summary = transitions.get(key) ?? {
    previousBlocker: before.blocker,
    blocker: after.blocker,
    roots: 0,
    publicRoots: 0,
    exampleRoot: before.name,
    previousExamplePath: before.blockerPath,
    examplePath: after.blockerPath,
  };
  summary.roots += 1;
  if (before.kind === "publicConstant") summary.publicRoots += 1;
  transitions.set(key, summary);
}

function finishTransitions(transitions) {
  return [...transitions.values()].sort((lhs, rhs) =>
    rhs.publicRoots - lhs.publicRoots
      || rhs.roots - lhs.roots
      || compareText(lhs.previousBlocker?.name ?? "", rhs.previousBlocker?.name ?? "")
      || compareText(lhs.blocker?.name ?? "", rhs.blocker?.name ?? ""));
}

function blockerKey(blocker) {
  return `${blocker?.kind ?? "unknown"}\n${blocker?.name ?? "(unknown)"}`;
}

function compareNativeCapabilities(control, candidate) {
  const before = new Map(control.runtimeCapabilities.nativeExterns.map((extern) => [extern.name, extern]));
  const after = new Map(candidate.runtimeCapabilities.nativeExterns.map((extern) => [extern.name, extern]));
  return {
    added: [...after].filter(([name]) => !before.has(name)).map(([, extern]) => extern).sort(nameOrder),
    removed: [...before].filter(([name]) => !after.has(name)).map(([, extern]) => extern).sort(nameOrder),
  };
}

function compareExterns(control, candidate) {
  const before = new Map(control.externs.map((extern) => [extern.name, extern]));
  const after = new Map(candidate.externs.map((extern) => [extern.name, extern]));
  const transitions = [];
  for (const [name, previous] of before) {
    const current = after.get(name);
    if (!current) throw new Error(`candidate extern catalog is missing ${name}`);
    if (previous.module !== current.module) throw new Error(`extern module changed for ${name}`);
    if (previous.status !== current.status) {
      transitions.push({
        name,
        module: previous.module,
        previousStatus: previous.status,
        status: current.status,
        targets: current.targets,
      });
    }
  }
  for (const name of after.keys()) {
    if (!before.has(name)) throw new Error(`control extern catalog is missing ${name}`);
  }
  transitions.sort((lhs, rhs) => compareText(lhs.name, rhs.name));
  return { transitions };
}

function reportIdentity(report, file = "(report)") {
  return {
    file: basename(file),
    lean: report.lean,
    counts: report.counts,
    selectedModuleCount: report.selectedModules.length,
    nativeExternCount: report.runtimeCapabilities.nativeExternCount,
    capture: report.capture ?? null,
  };
}

function countPublic(declarations) {
  return declarations.reduce((count, declaration) =>
    count + (declaration.kind === "publicConstant" ? 1 : 0), 0);
}

function topLevelName(name) {
  const index = name.indexOf(".");
  return index < 0 ? name : name.slice(0, index);
}

function parentFolders(name) {
  const parts = name.split(".");
  const folders = [];
  for (let length = 1; length < parts.length; length += 1) {
    folders.push(parts.slice(0, length).join("."));
  }
  return folders;
}

function nameOrder(lhs, rhs) {
  return compareText(lhs.name, rhs.name);
}

function coverageRow(label, before, beforeTotal, after, afterTotal, added, removed) {
  return `| ${label} | ${ratio(before, beforeTotal)} | ${ratio(after, afterTotal)} | ${added} | ${removed} |`;
}

function ratio(value, total) {
  const percentage = total === 0 ? "n/a" : `${((value * 100) / total).toFixed(1)}%`;
  return `${value} / ${total} (${percentage})`;
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function appendCapabilityTable(lines, capabilities) {
  lines.push("## Native Capability Changes", "");
  if (capabilities.added.length === 0 && capabilities.removed.length === 0) {
    lines.push("No native capabilities changed.", "");
    return;
  }
  lines.push("| Change | Lean name | Native symbol |", "| --- | --- | --- |");
  for (const extern of capabilities.added) {
    lines.push(`| Added | \`${extern.name}\` | \`${extern.symbol}\` |`);
  }
  for (const extern of capabilities.removed) {
    lines.push(`| Removed | \`${extern.name}\` | \`${extern.symbol}\` |`);
  }
  lines.push("");
}

function appendRollupTable(lines, title, rollups, limit) {
  lines.push(`## ${title}`, "");
  if (rollups.length === 0) {
    lines.push("No coverage changes.", "");
    return;
  }
  lines.push(
    "| Name | Public newly runnable | All newly runnable | Public regressions | All regressions | Changed blocker |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of rollups.slice(0, limit)) {
    lines.push(
      `| \`${result.name}\` | ${result.publicNewlyRunnable} | ${result.newlyRunnable} | `
        + `${result.publicRegressions} | ${result.regressions} | ${result.changedBlockers} |`,
    );
  }
  if (rollups.length > limit) lines.push(``, `_${rollups.length - limit} additional rows are in the JSON report._`);
  lines.push("");
}

function appendBoundaryTable(lines, title, boundaries) {
  lines.push(`## ${title}`, "");
  if (boundaries.length === 0) {
    lines.push("None.", "");
    return;
  }
  lines.push("| Boundary | Kind | Public roots | All roots |", "| --- | --- | ---: | ---: |");
  for (const summary of boundaries.slice(0, 50)) {
    lines.push(
      `| \`${summary.blocker.name}\` | ${summary.blocker.kind} | ${summary.publicRoots} | ${summary.roots} |`,
    );
  }
  if (boundaries.length > 50) lines.push(``, `_${boundaries.length - 50} additional rows are in the JSON report._`);
  lines.push("");
}

function appendTransitionTable(lines, transitions) {
  lines.push("## Nearest Blocker Transitions", "");
  if (transitions.length === 0) {
    lines.push("None.", "");
    return;
  }
  lines.push(
    "| Previous boundary | New boundary | Public roots | All roots |",
    "| --- | --- | ---: | ---: |",
  );
  for (const summary of transitions.slice(0, 50)) {
    lines.push(
      `| \`${summary.previousBlocker.name}\` | \`${summary.blocker.name}\` | `
        + `${summary.publicRoots} | ${summary.roots} |`,
    );
  }
  if (transitions.length > 50) lines.push(``, `_${transitions.length - 50} additional rows are in the JSON report._`);
  lines.push("");
}

async function main() {
  const [controlArg, candidateArg, jsonArg, markdownArg, ...rest] = process.argv.slice(2);
  if (!controlArg || !candidateArg || !jsonArg || !markdownArg || rest.length !== 0) {
    console.error(
      "usage: compare-surface-reports.mjs <control.json> <candidate.json> <delta.json> <delta.md>",
    );
    process.exitCode = 2;
    return;
  }
  const controlPath = resolve(controlArg);
  const candidatePath = resolve(candidateArg);
  const jsonPath = resolve(jsonArg);
  const markdownPath = resolve(markdownArg);
  const control = JSON.parse(await readFile(controlPath, "utf8"));
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const delta = compareSurfaceReports(control, candidate, {
    control: controlPath,
    candidate: candidatePath,
  });
  const json = `${JSON.stringify(delta, null, 2)}\n`;
  const markdown = renderSurfaceDeltaMarkdown(delta);
  await Promise.all([writeFile(jsonPath, json), writeFile(markdownPath, markdown)]);
  console.log(
    `compared ${delta.control.counts.total} functions: `
      + `${delta.changes.newlyRunnable} newly runnable, ${delta.changes.regressions} regressions, `
      + `${delta.changes.changedBlockers} changed blockers`,
  );
  console.log(`wrote ${jsonPath} and ${markdownPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
