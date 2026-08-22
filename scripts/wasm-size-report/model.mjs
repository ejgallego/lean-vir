/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { basename } from "node:path";

export function binaryPayload(report, path) {
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

export function buildSectionTree(report, profile) {
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

export function buildOwnershipTree(report) {
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

export function indexSurfaceLinks(links) {
  const externsByTarget = new Map();
  if (!links) return externsByTarget;
  for (const declaration of links.externs) {
    for (const target of declaration.targets) {
      const declarations = externsByTarget.get(target) ?? [];
      declarations.push({
        name: declaration.name,
        module: declaration.module,
        status: declaration.status,
        target,
        primaryRoots: declaration.primaryRoots ?? 0,
        primaryPublicRoots: declaration.primaryPublicRoots ?? 0,
        frontierCosts: declaration.frontierCosts ?? [],
      });
      externsByTarget.set(target, declarations);
    }
  }
  return externsByTarget;
}

export function connectSurfaceLinks(root, externsByTarget) {
  let connected = 0;
  visitTree(root, (node) => {
    if (node.kind !== "symbol") return;
    const declarations = externsByTarget.get(node.meta?.rawName)
      ?? externsByTarget.get(node.name);
    if (!declarations) return;
    node.meta.surfaceDeclarations = declarations;
    connected += 1;
  });
  return connected;
}

export function annotateSurfaceSummaries(node) {
  const declarations = new Map();
  for (const declaration of node.meta?.surfaceDeclarations ?? []) {
    declarations.set(declaration.name, declaration);
  }
  for (const child of node.children ?? []) {
    for (const [name, declaration] of annotateSurfaceSummaries(child)) {
      declarations.set(name, declaration);
    }
  }
  if (declarations.size > 0) {
    const values = [...declarations.values()].sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));
    node.meta = {
      ...node.meta,
      surfaceDeclarations: values,
      surfaceSummary: summarizeSurfaceDeclarations(values),
    };
  }
  return declarations;
}

export function annotateRuntimeContextTree(tree) {
  annotateNativeFunctionSummaries(tree);
  annotateSurfaceSummaries(tree);
  annotateBoundaryDensities(tree);
  annotateFrontierDensities(tree);
  let maxFrontierDensity = 0;
  visitTree(tree, (node) => {
    maxFrontierDensity = Math.max(maxFrontierDensity, node.meta?.frontierDensity ?? 0);
  });
  return {
    surfaceSummary: tree.meta?.surfaceSummary ?? emptySurfaceSummary(),
    maxFrontierDensity,
  };
}

function annotateBoundaryDensities(node) {
  const children = node.children ?? [];
  let density;
  if (children.length > 0) {
    for (const child of children) annotateBoundaryDensities(child);
    density = node.bytes > 0
      ? children.reduce(
        (sum, child) => sum + (child.meta?.boundaryDensity ?? 0) * child.bytes,
        0,
      ) / node.bytes
      : 0;
  } else {
    density = node.meta?.inVirBoundary ? 1 : 0;
  }
  node.meta = { ...node.meta, boundaryDensity: density };
  return density;
}

function annotateNativeFunctionSummaries(node) {
  const children = node.children ?? [];
  if (children.length === 0) {
    return {
      functionCount: node.kind === "runtimeFunction" ? 1 : 0,
      functionBytes: node.kind === "runtimeFunction" ? node.bytes : 0,
      overheadBytes: node.kind === "runtimeOverhead" ? node.bytes : 0,
      retainedFunctionCount: node.kind === "runtimeFunction" && node.meta.inVirBoundary ? 1 : 0,
      retainedNativeFunctionBytes: node.kind === "runtimeFunction" && node.meta.inVirBoundary
        ? node.bytes
        : 0,
      retainedWasmFunctionBytes: node.kind === "runtimeFunction"
        ? node.meta.retainedWasmBytes ?? 0
        : 0,
      zeroFillBytes: node.meta?.zeroFillBytes ?? 0,
    };
  }
  const summary = children.map(annotateNativeFunctionSummaries).reduce(
    (total, child) => ({
      functionCount: total.functionCount + child.functionCount,
      functionBytes: total.functionBytes + child.functionBytes,
      overheadBytes: total.overheadBytes + child.overheadBytes,
      retainedFunctionCount: total.retainedFunctionCount + child.retainedFunctionCount,
      retainedNativeFunctionBytes:
        total.retainedNativeFunctionBytes + child.retainedNativeFunctionBytes,
      retainedWasmFunctionBytes:
        total.retainedWasmFunctionBytes + child.retainedWasmFunctionBytes,
      zeroFillBytes: total.zeroFillBytes + child.zeroFillBytes,
    }),
    {
      functionCount: 0,
      functionBytes: 0,
      overheadBytes: 0,
      retainedFunctionCount: 0,
      retainedNativeFunctionBytes: 0,
      retainedWasmFunctionBytes: 0,
      zeroFillBytes: 0,
    },
  );
  summary.zeroFillBytes += node.meta?.zeroFillBytes ?? 0;
  node.meta = { ...node.meta, ...summary };
  return summary;
}

function annotateFrontierDensities(node) {
  const children = node.children ?? [];
  let density;
  if (children.length > 0) {
    for (const child of children) annotateFrontierDensities(child);
    density = node.bytes > 0
      ? children.reduce(
        (sum, child) => sum + (child.meta?.frontierDensity ?? 0) * child.bytes,
        0,
      ) / node.bytes
      : 0;
  } else {
    const pressure = node.meta?.surfaceSummary?.primaryRoots ?? 0;
    density = node.bytes > 0 ? pressure * (1024 ** 2) / node.bytes : 0;
  }
  node.meta = { ...node.meta, frontierDensity: density };
  return density;
}

function summarizeSurfaceDeclarations(declarations) {
  return {
    entries: declarations.length,
    nativeEntries: declarations.filter((declaration) => declaration.status === "native").length,
    missingEntries: declarations.filter((declaration) => declaration.status === "missing").length,
    primaryRoots: declarations.reduce((sum, declaration) => sum + declaration.primaryRoots, 0),
    primaryPublicRoots: declarations.reduce(
      (sum, declaration) => sum + declaration.primaryPublicRoots,
      0,
    ),
  };
}

function emptySurfaceSummary() {
  return {
    entries: 0,
    nativeEntries: 0,
    missingEntries: 0,
    primaryRoots: 0,
    primaryPublicRoots: 0,
  };
}

export function visitTree(node, visit) {
  visit(node);
  for (const child of node.children ?? []) visitTree(child, visit);
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

export function compareBytesThenName(lhs, rhs) {
  return rhs.bytes - lhs.bytes || lhs.name.localeCompare(rhs.name);
}

export function sumChildren(children) {
  return children.reduce((sum, child) => sum + child.bytes, 0);
}

export function countKind(node, kind) {
  return (node.kind === kind ? 1 : 0)
    + (node.children ?? []).reduce((sum, child) => sum + countKind(child, kind), 0);
}
