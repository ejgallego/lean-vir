#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLinkMap, parseWasm } from "./wasm-size-report.mjs";

const HTML_FORMAT = "lean-vir-wasm-size-html";
const HTML_VERSION = 1;
const templateDir = fileURLToPath(new URL("wasm-size-report/", import.meta.url));

const [releaseWasmArg, debugWasmArg, mapArg, outputArg, ...rest] = process.argv.slice(2);
if (!releaseWasmArg || !debugWasmArg || !mapArg || !outputArg || rest.length !== 0) {
  console.error(
    "usage: render-wasm-size-report.mjs <release-wasm> <debug-wasm> <link.map> <output-directory>",
  );
  process.exit(2);
}

const releaseWasmPath = resolve(releaseWasmArg);
const debugWasmPath = resolve(debugWasmArg);
const mapPath = resolve(mapArg);
const outputDir = resolve(outputArg);
const assetsDir = join(outputDir, "assets");
const dataDir = join(outputDir, "data");

const releaseBinary = parseWasm(releaseWasmPath);
const debugBinary = parseWasm(debugWasmPath);
const attribution = parseLinkMap(mapPath, releaseBinary);
const identity = await readBuildIdentity(join(dirname(mapPath), "wasm-build-identity.json"));
const revision = process.env.GITHUB_SHA ?? gitRevision();
const ownershipTree = buildOwnershipTree(attribution);
const attributedBytes = attribution.symbols.reduce((sum, symbol) => sum + symbol.rawBytes, 0);

const payload = {
  format: HTML_FORMAT,
  version: HTML_VERSION,
  revision,
  binaries: {
    release: binaryPayload(releaseBinary, releaseWasmPath),
    debug: binaryPayload(debugBinary, debugWasmPath),
  },
  build: sanitizeIdentity(identity),
  attribution: {
    source: basename(mapPath),
    codeDataBytes: attribution.codeDataBytes,
    attributedBytes,
    coverage: attribution.codeDataBytes === 0 ? 0 : attributedBytes / attribution.codeDataBytes,
    areas: ownershipTree.children.length,
    objects: countKind(ownershipTree, "object"),
    symbols: countKind(ownershipTree, "symbol"),
  },
  trees: {
    ownership: ownershipTree,
    releaseSections: buildSectionTree(releaseBinary, "release"),
    debugSections: buildSectionTree(debugBinary, "debug"),
  },
};

await Promise.all([
  mkdir(assetsDir, { recursive: true }),
  mkdir(dataDir, { recursive: true }),
]);

await Promise.all([
  writeFile(join(outputDir, "index.html"), await readFile(join(templateDir, "index.html"), "utf8")),
  writeFile(join(assetsDir, "app.js"), await readFile(join(templateDir, "app.js"), "utf8")),
  writeFile(join(assetsDir, "style.css"), await readFile(join(templateDir, "style.css"), "utf8")),
  writeFile(join(dataDir, "index.js"), `globalThis.__virWasmSize=${scriptSafeJson(payload)};\n`),
]);

const manifest = {
  format: HTML_FORMAT,
  version: HTML_VERSION,
  entrypoint: "index.html",
  binaries: payload.binaries,
  build: payload.build,
  revision,
  attribution: payload.attribution,
};
await writeFile(join(outputDir, "vir-wasm-size-html.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `rendered ${payload.attribution.objects} objects and ${payload.attribution.symbols} retained symbols `
    + `to ${outputDir} (${formatBytes(attributedBytes)} of ${formatBytes(attribution.codeDataBytes)} Code+Data attributed)`,
);

function binaryPayload(report, path) {
  return {
    file: basename(path),
    rawBytes: report.rawBytes,
    gzipBytes: report.gzipBytes,
    sections: report.sections.map((section) => ({
      name: section.label,
      rawBytes: section.rawBytes,
      gzipBytes: section.gzipBytes,
    })),
  };
}

function buildSectionTree(report, profile) {
  const children = report.sections.map((section, index) => ({
    id: `section-${index}`,
    name: section.label,
    kind: "section",
    bytes: section.rawBytes,
    gzipBytes: section.gzipBytes,
  }));
  const sectionBytes = children.reduce((sum, child) => sum + child.bytes, 0);
  if (report.rawBytes > sectionBytes) {
    children.push({
      id: "section-header",
      name: "Wasm header",
      kind: "section",
      bytes: report.rawBytes - sectionBytes,
      gzipBytes: null,
    });
  }
  children.sort(compareBytesThenName);
  return {
    id: `${profile}-sections-root`,
    name: `${profile === "release" ? "Release" : "Debug"} Wasm binary`,
    kind: "root",
    bytes: report.rawBytes,
    children,
  };
}

function buildOwnershipTree(report) {
  const areas = new Map();
  for (const symbol of report.symbols) {
    if (symbol.rawBytes <= 0) continue;
    let area = areas.get(symbol.area);
    if (!area) {
      area = { name: symbol.area, objects: new Map() };
      areas.set(symbol.area, area);
    }
    let object = area.objects.get(symbol.input);
    if (!object) {
      object = { input: symbol.input, name: cleanObjectName(symbol.object), symbols: new Map() };
      area.objects.set(symbol.input, object);
    }
    const symbolKey = `${symbol.section}\t${symbol.name}`;
    const entry = object.symbols.get(symbolKey) ?? {
      name: symbol.displayName,
      rawName: symbol.name,
      section: symbol.section,
      bytes: 0,
    };
    entry.bytes += symbol.rawBytes;
    if (symbol.displayName !== symbol.name) entry.name = symbol.displayName;
    object.symbols.set(symbolKey, entry);
  }

  let nextId = 0;
  const id = (kind) => `${kind}-${nextId++}`;
  const children = [...areas.values()].map((area) => {
    const objects = [...area.objects.values()].map((object) => {
      const symbols = [...object.symbols.values()].map((symbol) => ({
        id: id("symbol"),
        name: symbol.name,
        kind: "symbol",
        bytes: symbol.bytes,
        meta: {
          section: symbol.section,
          rawName: symbol.rawName,
          input: object.input,
        },
      })).sort(compareBytesThenName);
      return {
        id: id("object"),
        name: object.name,
        kind: "object",
        bytes: sumChildren(symbols),
        meta: { input: object.input },
        children: symbols,
      };
    }).sort(compareBytesThenName);
    return {
      id: id("area"),
      name: area.name,
      kind: "area",
      bytes: sumChildren(objects),
      children: objects,
    };
  }).sort(compareBytesThenName);

  const attributedBytes = sumChildren(children);
  const unattributedBytes = Math.max(0, report.codeDataBytes - attributedBytes);
  if (unattributedBytes > 0) {
    children.push({
      id: id("area"),
      name: "Unattributed Code+Data",
      kind: "area",
      bytes: unattributedBytes,
      meta: { note: "Section framing and linker ranges without an input owner" },
    });
  }
  children.sort(compareBytesThenName);
  return {
    id: "ownership-root",
    name: "Retained Code+Data",
    kind: "root",
    bytes: report.codeDataBytes,
    children,
  };
}

function cleanObjectName(name) {
  return name
    .replace(/^_home_.*?_third_party_lean4-src_src_/, "Lean/")
    .replace(/^_home_.*?_third_party_lean4-src_stage0_stdlib_/, "Lean stage0/")
    .replace(/^wasm_upstream_shim_/, "VIR/")
    .replace(/^Lean\/(runtime|kernel|util)_/, "Lean/$1/")
    .replace(/^VIR\/(abi|interpreter|package|runtime)_/, "VIR/$1/")
    .replace(/\.(?:cpp|c)\.o$/, (suffix) => suffix.slice(0, -2));
}

function compareBytesThenName(lhs, rhs) {
  return rhs.bytes - lhs.bytes || lhs.name.localeCompare(rhs.name);
}

function sumChildren(children) {
  return children.reduce((sum, child) => sum + child.bytes, 0);
}

function countKind(node, kind) {
  return (node.kind === kind ? 1 : 0)
    + (node.children ?? []).reduce((sum, child) => sum + countKind(child, kind), 0);
}

async function readBuildIdentity(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sanitizeIdentity(value) {
  if (!value) return null;
  return {
    profile: value.profile,
    optimization: value.optimization,
    target: value.target,
    initialMemory: value.initialMemory,
    stackSize: value.stackSize,
    compiler: firstLine(value.compiler?.version),
    linker: firstLine(value.linker?.version),
    lean: firstLine(value.lean?.version),
    leanSourceCommit: value.leanSource?.commit,
  };
}

function firstLine(value) {
  return typeof value === "string" ? value.split(/\r?\n/, 1)[0] : null;
}

function gitRevision() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
