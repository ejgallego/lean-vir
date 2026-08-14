/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compactFrontierCostReport } from "./frontier-size-costs.mjs";
import { classifySurfaceBoundary } from "./surface-boundary-family.mjs";
import { validateSurfaceReport } from "./surface-report-schema.mjs";

const HTML_FORMAT = "lean-vir-surface-html";
const HTML_VERSION = 6;
const templateDir = fileURLToPath(new URL("../web/tools/surface-report/", import.meta.url));

const [inputArg, outputArg, ...rest] = process.argv.slice(2);
let frontierCostsArg = null;
let collection = false;
for (let index = 0; index < rest.length; index += 1) {
  if (rest[index] === "--frontier-costs" && rest[index + 1]) {
    frontierCostsArg = rest[index + 1];
    index += 1;
  } else if (rest[index] === "--collection") {
    collection = true;
  } else {
    usage();
  }
}
if (!inputArg || !outputArg) usage();

function usage() {
  console.error(
    "usage: render-surface-report.mjs <surface.json> <output-directory> " +
      "[--frontier-costs <costs.json>] [--collection]",
  );
  process.exit(2);
}

const inputPath = resolve(inputArg);
const outputDir = resolve(outputArg);
const modulesDir = join(outputDir, "data", "modules");
const assetsDir = join(outputDir, "assets");
const report = JSON.parse(await readFile(inputPath, "utf8"));
validateSurfaceReport(report, { label: inputPath });
const frontierCosts = frontierCostsArg
  ? compactFrontierCostReport(
    JSON.parse(await readFile(resolve(frontierCostsArg), "utf8")),
    resolve(frontierCostsArg),
  )
  : null;
const externs = (report.externs ?? []).map((declaration) => ({
  ...declaration,
  family: classifySurfaceBoundary(declaration.name, declaration.module),
}));
const selectedDeclarationNames = report.selectedDeclarations ?? [];
const costsByName = frontierCostsByName(frontierCosts);

await rm(modulesDir, { recursive: true, force: true });
await Promise.all([
  mkdir(modulesDir, { recursive: true }),
  mkdir(assetsDir, { recursive: true }),
]);

const countsByModule = new Map(report.modules.map((module) => [module.name, module.counts]));
const selectedDeclarationNameSet = new Set(selectedDeclarationNames);
const selectedDeclarationModules = new Map(
  report.declarations
    .filter((declaration) => selectedDeclarationNameSet.has(declaration.name))
    .map((declaration) => [declaration.name, declaration.module]),
);
const declarationByName = new Map(
  report.declarations.map((declaration) => [declaration.name, declaration]),
);
const selectedDeclarations = selectedDeclarationNames.map((name) => {
  const module = selectedDeclarationModules.get(name);
  if (!module) throw new Error(`selected declaration ${JSON.stringify(name)} has no report record`);
  return { name, module };
});
const selectedRootBlockerSets = selectedDeclarationNames.map((name) => {
  const declaration = declarationByName.get(name);
  if (!declaration) throw new Error(`selected declaration ${JSON.stringify(name)} has no report record`);
  const blockers = Array.isArray(declaration.blockers)
    ? declaration.blockers
    : declaration.blocker
      ? [{ blocker: declaration.blocker, path: declaration.blockerPath ?? [] }]
      : [];
  return {
    name,
    module: declaration.module,
    runnable: declaration.runnable,
    primaryBlocker: declaration.blocker,
    blockers,
  };
});
const declarationsByModule = new Map();
for (const declaration of report.declarations) {
  const declarations = declarationsByModule.get(declaration.module) ?? [];
  declarations.push(declaration);
  declarationsByModule.set(declaration.module, declarations);
}
const externCountByModule = new Map();
for (const declaration of externs) {
  externCountByModule.set(declaration.module, (externCountByModule.get(declaration.module) ?? 0) + 1);
}

const moduleNames = [...new Set([
  ...report.selectedModules,
  ...report.modules.map((module) => module.name),
  ...declarationsByModule.keys(),
  ...externCountByModule.keys(),
])].sort(compareText);

const moduleRecords = moduleNames.map((name, id) => {
  const declarations = declarationsByModule.get(name) ?? [];
  const counts = countsByModule.get(name) ?? emptyCounts();
  return {
    id,
    name,
    counts,
    declarationCount: declarations.length,
    externCount: externCountByModule.get(name) ?? 0,
    dataPath: declarations.length === 0 ? null : `data/modules/${moduleFileName(id)}`,
  };
});

let bytesWritten = 0;
let dataFileCount = 0;
for (const module of moduleRecords) {
  if (module.dataPath === null) continue;
  const declarations = declarationsByModule.get(module.name);
  declarations.sort((lhs, rhs) => compareText(lhs.name, rhs.name));
  const payload = {
    id: module.id,
    name: module.name,
    declarations: declarations.map(declarationTuple),
  };
  const source = `globalThis.__virSurfaceAcceptModule(${scriptSafeJson(payload)});\n`;
  await writeFile(join(outputDir, module.dataPath), source);
  bytesWritten += Buffer.byteLength(source);
  dataFileCount += 1;
}

const indexPayload = {
  format: HTML_FORMAT,
  version: HTML_VERSION,
  sourceFormat: report.format,
  sourceVersion: report.version,
  sourceFile: basename(inputPath),
  collection,
  lean: report.lean,
  capture: report.capture ?? null,
  definition: report.definition,
  closure: report.closure ?? null,
  selectedModuleCount: report.selectedModules.length,
  selectedDeclarations,
  selectedRootBlockerSets,
  loadedModules: report.loadedModules,
  runtimeCapabilityCount: report.runtimeCapabilities.nativeExternCount,
  runtimeCapabilityLean: report.runtimeCapabilities.lean ?? report.lean,
  counts: report.counts,
  libraries: report.libraries,
  primaryBlockers: enrichBlockers(report.primaryBlockers),
  reachableBlockers: report.reachableBlockers ? enrichBlockers(report.reachableBlockers) : null,
  frontierCosts,
  externs,
  declarationTuple: [
    "name",
    "kind",
    "runnable",
    "blockerKind?",
    "blockerName?",
    "blockerPath?",
    "allBlockers?",
    "type?",
    "doc?",
  ],
  modules: moduleRecords,
};
const indexSource = `globalThis.__virSurfaceIndex=${scriptSafeJson(indexPayload)};\n`;
bytesWritten += await writeOutput("data/index.js", indexSource);
const blockerByName = new Map(
  report.primaryBlockers.map((summary) => [summary.blocker.name, summary]),
);
const sizeLinks = {
  format: "lean-vir-surface-size-links",
  version: 2,
  externs: externs.map((declaration) => {
    const blocker = blockerByName.get(declaration.name);
    return {
      name: declaration.name,
      module: declaration.module,
      status: declaration.status,
      primaryRoots: blocker?.roots ?? 0,
      primaryPublicRoots: blocker?.publicRoots ?? 0,
      frontierCosts: costsByName.get(declaration.name) ?? [],
      targets: declaration.targets
        .map((target) => target.value)
        .filter((target) => typeof target === "string" && target.length > 0),
    };
  }),
};
bytesWritten += await writeOutput("data/size-links.json", `${JSON.stringify(sizeLinks)}\n`);

for (const asset of ["app.js", "style.css"]) {
  bytesWritten += await writeOutput(`assets/${asset}`, await readFile(join(templateDir, asset), "utf8"));
}
bytesWritten += await writeOutput("index.html", await readFile(join(templateDir, "index.html"), "utf8"));

const manifest = {
  format: HTML_FORMAT,
  version: HTML_VERSION,
  source: {
    format: report.format,
    version: report.version,
    file: basename(inputPath),
    lean: report.lean,
    capture: report.capture ?? null,
    closure: report.closure ?? null,
  },
  selectedModules: report.selectedModules.length,
  selectedDeclarations: selectedDeclarations.length,
  selectedRootBlockerSets: selectedRootBlockerSets.length,
  modulesWithFunctions: report.modules.length,
  declarations: report.declarations.length,
  externs: externs.length,
  sizeLinks: sizeLinks.externs.length,
  frontierCosts: frontierCosts ? {
    baseline: frontierCosts.baseline,
    candidates: frontierCosts.candidates.length,
    failedCandidates: frontierCosts.candidates.filter((candidate) => candidate.error).length,
  } : null,
  moduleDataFiles: dataFileCount,
  entrypoint: "index.html",
};
bytesWritten += await writeOutput("vir-surface-html.json", `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `rendered ${moduleRecords.length} modules, ${report.declarations.length} functions, and `
    + `${externs.length} extern boundaries `
    + `to ${outputDir} (${formatBytes(bytesWritten)})`,
);

async function writeOutput(relativePath, contents) {
  await writeFile(join(outputDir, relativePath), contents);
  return Buffer.byteLength(contents);
}

function emptyCounts() {
  return {
    total: 0,
    runnable: 0,
    blocked: 0,
    publicTotal: 0,
    publicRunnable: 0,
    privateTotal: 0,
    boxedTotal: 0,
    generatedTotal: 0,
  };
}

function enrichBlockers(summaries) {
  const externByName = new Map(externs.map((declaration) => [declaration.name, declaration]));
  return summaries.map((summary) => ({
    ...summary,
    family: classifySurfaceBoundary(
      summary.blocker.name,
      externByName.get(summary.blocker.name)?.module ?? "",
    ),
  }));
}

function declarationTuple(declaration) {
  if (declaration.runnable) {
    if (!declaration.type && !declaration.doc) return [declaration.name, declaration.kind, 1];
    return [
      declaration.name, declaration.kind, 1, null, null, null, null,
      declaration.type ?? null, declaration.doc ?? null,
    ];
  }
  const tuple = [
    declaration.name,
    declaration.kind,
    0,
    declaration.blocker?.kind ?? "unknown",
    declaration.blocker?.name ?? "(unknown)",
    declaration.blockerPath,
    (declaration.blockers ?? []).map((entry) => [
      entry.blocker.kind,
      entry.blocker.name,
      entry.path,
    ]),
  ];
  if (!declaration.type && !declaration.doc) return tuple;
  return [...tuple, declaration.type ?? null, declaration.doc ?? null];
}

function frontierCostsByName(report) {
  const result = new Map();
  for (const candidate of report?.candidates ?? []) {
    for (const name of candidate.names) {
      const costs = result.get(name) ?? [];
      costs.push(candidate);
      result.set(name, costs);
    }
  }
  return result;
}

function moduleFileName(id) {
  return `${String(id).padStart(6, "0")}.js`;
}

function compareText(lhs, rhs) {
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}
