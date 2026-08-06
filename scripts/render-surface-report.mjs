/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SURFACE_FORMAT = "lean-vir-library-surface";
const HTML_FORMAT = "lean-vir-surface-html";
const HTML_VERSION = 1;
const templateDir = fileURLToPath(new URL("surface-report/", import.meta.url));

const [inputArg, outputArg, ...rest] = process.argv.slice(2);
if (!inputArg || !outputArg || rest.length !== 0) {
  console.error("usage: render-surface-report.mjs <surface.json> <output-directory>");
  process.exit(2);
}

const inputPath = resolve(inputArg);
const outputDir = resolve(outputArg);
const modulesDir = join(outputDir, "data", "modules");
const assetsDir = join(outputDir, "assets");
const report = JSON.parse(await readFile(inputPath, "utf8"));
validateReport(report);

await Promise.all([
  mkdir(modulesDir, { recursive: true }),
  mkdir(assetsDir, { recursive: true }),
]);

const countsByModule = new Map(report.modules.map((module) => [module.name, module.counts]));
const declarationsByModule = new Map();
for (const declaration of report.declarations) {
  const declarations = declarationsByModule.get(declaration.module) ?? [];
  declarations.push(declaration);
  declarationsByModule.set(declaration.module, declarations);
}

const moduleNames = [...new Set([
  ...report.selectedModules,
  ...report.modules.map((module) => module.name),
  ...declarationsByModule.keys(),
])].sort(compareText);

const moduleRecords = moduleNames.map((name, id) => {
  const declarations = declarationsByModule.get(name) ?? [];
  const counts = countsByModule.get(name) ?? emptyCounts();
  return {
    id,
    name,
    counts,
    declarationCount: declarations.length,
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
  lean: report.lean,
  definition: report.definition,
  selectedModuleCount: report.selectedModules.length,
  loadedModules: report.loadedModules,
  runtimeCapabilityCount: report.runtimeCapabilities.nativeExternCount,
  counts: report.counts,
  libraries: report.libraries,
  primaryBlockers: report.primaryBlockers.slice(0, 50),
  declarationTuple: [
    "name",
    "kind",
    "runnable",
    "blockerKind?",
    "blockerName?",
    "blockerPath?",
  ],
  modules: moduleRecords,
};
const indexSource = `globalThis.__virSurfaceIndex=${scriptSafeJson(indexPayload)};\n`;
bytesWritten += await writeOutput("data/index.js", indexSource);

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
  },
  selectedModules: report.selectedModules.length,
  modulesWithFunctions: report.modules.length,
  declarations: report.declarations.length,
  moduleDataFiles: dataFileCount,
  entrypoint: "index.html",
};
bytesWritten += await writeOutput("vir-surface-html.json", `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `rendered ${moduleRecords.length} modules and ${report.declarations.length} declarations `
    + `to ${outputDir} (${formatBytes(bytesWritten)})`,
);

async function writeOutput(relativePath, contents) {
  await writeFile(join(outputDir, relativePath), contents);
  return Buffer.byteLength(contents);
}

function validateReport(value) {
  if (value?.format !== SURFACE_FORMAT) {
    throw new Error(`expected ${SURFACE_FORMAT} input, got ${JSON.stringify(value?.format)}`);
  }
  for (const field of ["selectedModules", "modules", "declarations", "libraries", "primaryBlockers"]) {
    if (!Array.isArray(value[field])) {
      throw new Error(`surface report field ${JSON.stringify(field)} must be an array`);
    }
  }
  if (!value.counts || !value.lean || !value.definition || !value.runtimeCapabilities) {
    throw new Error("surface report is missing counts, Lean identity, definition, or capabilities");
  }
  if (value.counts.total !== value.declarations.length) {
    throw new Error(
      `surface report has ${value.counts.total} counted functions but ${value.declarations.length} records`,
    );
  }
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

function declarationTuple(declaration) {
  if (declaration.runnable) {
    return [declaration.name, declaration.kind, 1];
  }
  return [
    declaration.name,
    declaration.kind,
    0,
    declaration.blocker?.kind ?? "unknown",
    declaration.blocker?.name ?? "(unknown)",
    declaration.blockerPath,
  ];
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
