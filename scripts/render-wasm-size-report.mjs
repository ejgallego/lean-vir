#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compactFrontierCostReport } from "./frontier-size-costs.mjs";
import { parseLinkMap, parseWasm } from "./wasm-size-report.mjs";

const HTML_FORMAT = "lean-vir-wasm-size-html";
const HTML_VERSION = 8;
const templateDir = fileURLToPath(new URL("wasm-size-report/", import.meta.url));

const [releaseWasmArg, debugWasmArg, mapArg, outputArg, ...rest] = process.argv.slice(2);
let surfaceLinksArg = null;
let frontierCostsArg = null;
let optionsValid = rest.length % 2 === 0;
for (let index = 0; optionsValid && index < rest.length; index += 2) {
  const option = rest[index];
  const value = rest[index + 1];
  if (!value || !["--surface-links", "--frontier-costs"].includes(option)) {
    optionsValid = false;
  } else if (option === "--surface-links" && surfaceLinksArg === null) {
    surfaceLinksArg = value;
  } else if (option === "--frontier-costs" && frontierCostsArg === null) {
    frontierCostsArg = value;
  } else {
    optionsValid = false;
  }
}
if (!releaseWasmArg || !debugWasmArg || !mapArg || !outputArg || !optionsValid) {
  console.error(
    "usage: render-wasm-size-report.mjs <release-wasm> <debug-wasm> <link.map> " +
      "<output-directory> [--surface-links <links.json>] [--frontier-costs <costs.json>]",
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
const surfaceLinks = surfaceLinksArg ? await readSurfaceLinks(resolve(surfaceLinksArg)) : null;
const frontierCosts = frontierCostsArg
  ? compactFrontierCostReport(
    JSON.parse(await readFile(resolve(frontierCostsArg), "utf8")),
    resolve(frontierCostsArg),
  )
  : null;
const surfaceDeclarationsByTarget = indexSurfaceLinks(surfaceLinks);
const connectedSymbols = connectSurfaceLinks(ownershipTree, surfaceDeclarationsByTarget);
annotateSurfaceSummaries(ownershipTree);
const runtimeContext = await buildRuntimeContext(
  ownershipTree,
  identity,
  surfaceLinks,
  surfaceDeclarationsByTarget,
);
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
    connectedSymbols,
  },
  runtimeContext: runtimeContext.summary,
  frontierCosts,
  trees: {
    ownership: ownershipTree,
    releaseSections: buildSectionTree(releaseBinary, "release"),
    debugSections: buildSectionTree(debugBinary, "debug"),
    runtimeContext: runtimeContext.tree,
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
  runtimeContext: payload.runtimeContext,
  frontierCosts: frontierCosts ? {
    baseline: frontierCosts.baseline,
    candidates: frontierCosts.candidates.length,
  } : null,
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

function indexSurfaceLinks(links) {
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

function connectSurfaceLinks(root, externsByTarget) {
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

async function buildRuntimeContext(
  ownershipTree,
  identity,
  surfaceLinks,
  surfaceDeclarationsByTarget,
) {
  const lean = spawnSync("lean", ["--print-prefix"], { encoding: "utf8" });
  if (lean.status !== 0) {
    throw new Error(`unable to locate the Lean toolchain: ${lean.stderr || lean.stdout}`);
  }
  const prefix = lean.stdout.trim();
  const sourceRoot = resolve(identity?.leanSource?.path ?? "third_party/lean4-src");
  const sourceCandidates = await runtimeSourceCandidates(sourceRoot);
  const boundaryObjects = runtimeBoundaryObjects(ownershipTree);
  const archiveFiles = ["libleanrt.a", "libleancpp.a", "libLeanIR.a"];
  let nextId = 0;
  let memberCount = 0;
  let nativeMemberCount = 0;
  let programMemberCount = 0;
  let sourceMemberCount = 0;
  let boundaryMemberCount = 0;
  let boundaryNativeBytes = 0;
  let boundaryWasmBytes = 0;
  let sizedFunctionCount = 0;
  let sizedFunctionBytes = 0;
  let boundarySizedFunctions = 0;
  let boundarySizedFunctionBytes = 0;
  let retainedFunctions = 0;
  let retainedNativeFunctionBytes = 0;
  let retainedWasmFunctionBytes = 0;
  const membersByArchive = new Map();

  for (const file of archiveFiles) {
    const path = join(prefix, "lib", "lean", file);
    const members = parseArArchive(await readFile(path));
    const functionsByMember = archiveFunctionCatalog(path);
    const duplicateCount = new Map();
    for (const [archiveIndex, member] of members.entries()) {
      const occurrence = (duplicateCount.get(member.name) ?? 0) + 1;
      duplicateCount.set(member.name, occurrence);
      const candidates = sourceCandidates.get(`${file}/${member.name}`) ?? [];
      const source = candidates[occurrence - 1];
      if (!source) {
        throw new Error(
          `no Lean source provenance for ${file} member ${member.name} occurrence ${occurrence}`,
        );
      }
      const boundary = boundaryObjects.get(`${file}/${member.name}`);
      memberCount += 1;
      sourceMemberCount += 1;
      if (source.layer === "native") nativeMemberCount += 1;
      else programMemberCount += 1;
      if (boundary) {
        boundaryMemberCount += 1;
        boundaryNativeBytes += member.bytes;
        boundaryWasmBytes += boundary.bytes;
      }
      const functions = functionsByMember.get(member.name)?.[occurrence - 1] ?? [];
      sizedFunctionCount += functions.length;
      sizedFunctionBytes += functions.reduce((sum, fn) => sum + fn.bytes, 0);
      if (boundary) {
        boundarySizedFunctions += functions.length;
        boundarySizedFunctionBytes += functions.reduce((sum, fn) => sum + fn.bytes, 0);
      }
      const surfaceDeclarations = runtimeMemberSurfaceDeclarations(
        functions,
        boundary?.meta?.surfaceDeclarations ?? [],
        surfaceDeclarationsByTarget,
      );
      const memberChildren = runtimeMemberChildren({
        archive: file,
        archiveIndex: archiveIndex + 1,
        member,
        functions,
        retainedSymbols: boundary?.children ?? [],
        surfaceDeclarations,
        nextId: () => nextId++,
      });
      for (const child of memberChildren) {
        if (child.kind !== "runtimeFunction" || !child.meta.inVirBoundary) continue;
        retainedFunctions += 1;
        retainedNativeFunctionBytes += child.bytes;
        retainedWasmFunctionBytes += child.meta.retainedWasmBytes;
      }
      const node = {
        id: `runtime-member-${nextId++}`,
        name: basename(source.path),
        kind: "runtimeMember",
        bytes: member.bytes,
        meta: {
          archive: file,
          archiveIndex: archiveIndex + 1,
          memberName: member.name,
          source: source.path,
          sourceGroup: source.subsystem,
          sourceLabel: source.label,
          layer: source.layer,
          generated: source.generated ?? false,
          inVirBoundary: Boolean(boundary),
          retainedWasmBytes: boundary?.bytes ?? null,
          wasmNodeId: boundary?.id ?? null,
          wasmObject: boundary?.name ?? null,
          functionCount: functions.length,
          functionBytes: functions.reduce((sum, fn) => sum + fn.bytes, 0),
          overheadBytes: memberChildren
            .find((child) => child.kind === "runtimeOverhead")?.bytes ?? 0,
          surfaceDeclarations,
        },
        children: memberChildren,
      };
      const archiveMembers = membersByArchive.get(file) ?? [];
      archiveMembers.push(node);
      membersByArchive.set(file, archiveMembers);
    }
  }

  const archiveNodes = archiveFiles.map((archive) => {
    const members = membersByArchive.get(archive) ?? [];
    const layer = members[0]?.meta.layer;
    const sourceTree = buildSourceDirectoryTree(members, archive, layer, () => nextId++);
    return {
      id: `runtime-archive-${nextId++}`,
      name: archive,
      kind: "archive",
      bytes: sumChildren(sourceTree),
      meta: {
        archive,
        layer,
        memberCount: members.length,
        boundaryMembers: members.filter((member) => member.meta.inVirBoundary).length,
      },
      children: sourceTree,
    };
  }).filter((archive) => archive.bytes > 0);
  const nativeArchives = archiveNodes
    .filter((archive) => archive.meta.layer === "native")
    .sort(compareBytesThenName);
  const programArchives = archiveNodes
    .filter((archive) => archive.meta.layer === "program")
    .sort(compareBytesThenName);
  const nativeNode = {
    id: `runtime-layer-${nextId++}`,
    name: "Lean native support",
    kind: "runtimeLayer",
    bytes: sumChildren(nativeArchives),
    meta: {
      layer: "native",
      memberCount: nativeMemberCount,
      boundaryMembers: boundaryMemberCount,
    },
    children: nativeArchives,
  };
  const programNode = {
    id: `runtime-layer-${nextId++}`,
    name: "Nearby compiled Lean program",
    kind: "runtimeLayer",
    bytes: sumChildren(programArchives),
    meta: {
      layer: "program",
      memberCount: programMemberCount,
      boundaryMembers: 0,
      note: "LeanIR.lean is compiled Lean program code, not part of the native runtime denominator.",
    },
    children: programArchives,
  };
  const children = [nativeNode, programNode].filter((node) => node.bytes > 0);
  const tree = {
    id: "runtime-context-root",
    name: "Installed Lean execution context",
    kind: "root",
    bytes: sumChildren(children),
    children,
  };
  annotateNativeFunctionSummaries(tree);
  annotateSurfaceSummaries(tree);
  annotateBoundaryDensities(tree);
  annotateFrontierDensities(tree);
  let maxFrontierDensity = 0;
  visitTree(tree, (node) => {
    maxFrontierDensity = Math.max(maxFrontierDensity, node.meta?.frontierDensity ?? 0);
  });
  const surfaceSummary = tree.meta?.surfaceSummary ?? emptySurfaceSummary();
  const totalSurfaceEntries = surfaceLinks?.externs.length ?? 0;
  const totalMissingSurfaceEntries = surfaceLinks?.externs
    .filter((declaration) => declaration.status === "missing").length ?? 0;
  return {
    summary: {
      source: "installed Lean archives",
      archives: archiveFiles.length,
      memberBytes: tree.bytes,
      members: memberCount,
      sourceMembers: sourceMemberCount,
      nativeMemberBytes: nativeNode.bytes,
      nativeMembers: nativeMemberCount,
      programMemberBytes: programNode.bytes,
      programMembers: programMemberCount,
      boundaryMembers: boundaryMemberCount,
      boundaryNativeBytes,
      boundaryWasmBytes,
      boundaryDensity: nativeNode.meta.boundaryDensity,
      sizedFunctions: sizedFunctionCount,
      sizedFunctionBytes,
      nonFunctionBytes: tree.bytes - sizedFunctionBytes,
      boundarySizedFunctions,
      boundarySizedFunctionBytes,
      retainedFunctions,
      retainedNativeFunctionBytes,
      retainedWasmFunctionBytes,
      connectedSurfaceEntries: surfaceSummary.entries,
      totalSurfaceEntries,
      nativeSurfaceEntries: surfaceSummary.nativeEntries,
      missingSurfaceEntries: surfaceSummary.missingEntries,
      totalMissingSurfaceEntries,
      unmappedMissingSurfaceEntries:
        Math.max(0, totalMissingSurfaceEntries - surfaceSummary.missingEntries),
      primaryRoots: surfaceSummary.primaryRoots,
      primaryPublicRoots: surfaceSummary.primaryPublicRoots,
      maxFrontierDensity,
    },
    tree,
  };
}

function runtimeMemberSurfaceDeclarations(functions, boundaryDeclarations, declarationsByTarget) {
  const declarations = new Map(
    boundaryDeclarations.map((declaration) => [declaration.name, declaration]),
  );
  for (const fn of functions) {
    for (const alias of fn.rawAliases) {
      for (const declaration of declarationsByTarget.get(alias) ?? []) {
        declarations.set(declaration.name, declaration);
      }
    }
  }
  return [...declarations.values()].sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));
}

function buildSourceDirectoryTree(members, archive, layer, nextId) {
  const root = { directories: new Map(), members: [], descendants: [] };
  for (const member of members) {
    root.descendants.push(member);
    const parts = member.meta.source.split("/").slice(0, -1);
    let directory = root;
    for (const part of parts) {
      let child = directory.directories.get(part);
      if (!child) {
        child = { directories: new Map(), members: [], descendants: [] };
        directory.directories.set(part, child);
      }
      child.descendants.push(member);
      directory = child;
    }
    directory.members.push(member);
  }

  const convert = (directory, name, path) => {
    const children = [
      ...[...directory.directories.entries()].map(([childName, child]) =>
        convert(child, childName, path ? `${path}/${childName}` : childName)),
      ...directory.members,
    ].sort(compareBytesThenName);
    const sourceGroups = [...new Set(
      directory.descendants.map((member) => member.meta.sourceGroup),
    )].sort();
    return {
      id: `runtime-source-directory-${nextId()}`,
      name: `${name}/`,
      kind: "sourceDirectory",
      bytes: sumChildren(children),
      meta: {
        archive,
        layer,
        source: `${path}/`,
        sourceGroups,
        memberCount: directory.descendants.length,
        boundaryMembers: directory.descendants
          .filter((member) => member.meta.inVirBoundary).length,
      },
      children,
    };
  };

  return [
    ...[...root.directories.entries()].map(([name, directory]) =>
      convert(directory, name, name)),
    ...root.members,
  ].sort(compareBytesThenName);
}

function archiveFunctionCatalog(archivePath) {
  const result = spawnSync("objdump", ["-t", "--wide", archivePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `unable to inspect native functions in ${archivePath}: ${result.stderr || result.stdout}`,
    );
  }

  const occurrences = new Map();
  let memberName = null;
  let ranges = new Map();
  const flush = () => {
    if (memberName === null) return;
    const members = occurrences.get(memberName) ?? [];
    members.push([...ranges.values()]);
    occurrences.set(memberName, members);
  };

  for (const line of result.stdout.split(/\r?\n/)) {
    const heading = /^(.+):\s+file format \S+\s*$/.exec(line);
    if (heading) {
      flush();
      memberName = heading[1];
      ranges = new Map();
      continue;
    }
    if (memberName === null) continue;
    const symbol = /^([0-9a-fA-F]+)\s+(.+?)\s+(\S+)\s+([0-9a-fA-F]+)\s+(.+)$/.exec(line);
    if (!symbol || !symbol[2].split(/\s+/).includes("F")) continue;
    const bytes = Number.parseInt(symbol[4], 16);
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || symbol[3] === "*UND*") continue;
    const key = `${symbol[3]}/${symbol[1]}/${symbol[4]}`;
    const range = ranges.get(key) ?? {
      address: symbol[1],
      section: symbol[3],
      bytes,
      aliases: [],
    };
    const rawName = symbol[5].replace(/^\.(?:hidden|internal|protected)\s+/, "");
    range.aliases.push({ rawName, flags: symbol[2].trim() });
    ranges.set(key, range);
  }
  flush();

  const rawNames = [...new Set(
    [...occurrences.values()].flat(2).flatMap((fn) =>
      fn.aliases.map((alias) => alias.rawName)),
  )];
  const demangled = demangleNames(rawNames);
  for (const memberOccurrences of occurrences.values()) {
    for (const functions of memberOccurrences) {
      for (const fn of functions) {
        fn.aliases.sort((lhs, rhs) =>
          symbolVisibilityRank(lhs.flags) - symbolVisibilityRank(rhs.flags)
            || lhs.rawName.localeCompare(rhs.rawName));
        fn.rawName = fn.aliases[0].rawName;
        fn.name = demangled.get(fn.rawName) ?? fn.rawName;
        fn.rawAliases = fn.aliases.map((alias) => alias.rawName);
        fn.demangledAliases = fn.rawAliases.map((name) => demangled.get(name) ?? name);
        delete fn.aliases;
      }
      functions.sort(compareBytesThenName);
    }
  }
  return occurrences;
}

function demangleNames(names) {
  if (names.length === 0) return new Map();
  const result = spawnSync("c++filt", [], {
    input: `${names.join("\n")}\n`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) return new Map(names.map((name) => [name, name]));
  const values = result.stdout.trimEnd().split(/\r?\n/);
  return new Map(names.map((name, index) => [name, values[index] ?? name]));
}

function symbolVisibilityRank(flags) {
  const words = flags.split(/\s+/);
  if (words.includes("g")) return 0;
  if (words.includes("w")) return 1;
  return 2;
}

function runtimeMemberChildren({
  archive,
  archiveIndex,
  member,
  functions,
  retainedSymbols,
  surfaceDeclarations,
  nextId,
}) {
  const assignedDeclarations = new Set();
  const retainedByName = new Map();
  for (const symbol of retainedSymbols.filter((node) => node.kind === "symbol")) {
    const name = symbol.meta?.rawName ?? symbol.name;
    const matches = retainedByName.get(name) ?? [];
    matches.push(symbol);
    retainedByName.set(name, matches);
  }
  const children = functions.map((fn) => {
    const aliases = new Set(fn.rawAliases);
    const matches = [...new Map(fn.rawAliases.flatMap((name) =>
      (retainedByName.get(name) ?? []).map((symbol) => [symbol.id, symbol]))).values()]
      .sort(compareBytesThenName);
    const declarationsByName = new Map();
    for (const declaration of surfaceDeclarations.filter((declaration) => {
      if (!aliases.has(declaration.target)) return false;
      assignedDeclarations.add(declaration.name);
      return true;
    })) declarationsByName.set(declaration.name, declaration);
    for (const symbol of matches) {
      for (const declaration of symbol.meta?.surfaceDeclarations ?? []) {
        assignedDeclarations.add(declaration.name);
        declarationsByName.set(declaration.name, declaration);
      }
    }
    const declarations = [...declarationsByName.values()]
      .sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));
    const retainedWasmBytes = sumChildren(matches);
    return {
      id: `runtime-function-${nextId()}`,
      name: fn.name,
      kind: "runtimeFunction",
      bytes: fn.bytes,
      meta: {
        archive,
        archiveIndex,
        memberName: member.name,
        rawName: fn.rawName,
        rawAliases: fn.rawAliases,
        demangledAliases: fn.demangledAliases,
        section: fn.section,
        address: fn.address,
        inVirBoundary: matches.length > 0,
        retainedWasmBytes,
        wasmNodeId: matches[0]?.id ?? null,
        surfaceDeclarations: declarations,
      },
    };
  });
  const functionBytes = sumChildren(children);
  if (functionBytes > member.bytes) {
    throw new Error(
      `${archive} member ${member.name} has ${functionBytes} function bytes but only ${member.bytes} archive bytes`,
    );
  }
  const overheadBytes = member.bytes - functionBytes;
  if (overheadBytes > 0) {
    children.push({
      id: `runtime-overhead-${nextId()}`,
      name: "Non-function data and object overhead",
      kind: "runtimeOverhead",
      bytes: overheadBytes,
      meta: {
        archive,
        archiveIndex,
        memberName: member.name,
        inVirBoundary: false,
        note: "Archive-member bytes not assigned to a sized native function symbol, including data, relocations, debug information, section framing, and object metadata.",
        surfaceDeclarations: surfaceDeclarations
          .filter((declaration) => !assignedDeclarations.has(declaration.name)),
      },
    });
  }
  return children.sort(compareBytesThenName);
}

async function runtimeSourceCandidates(sourceRoot) {
  const result = new Map();
  const groups = [
    ["libleanrt.a", "native", "runtime", "Runtime core (src/runtime)", "src/runtime"],
    ["libleanrt.a", "native", "runtime/uv", "UV integration (src/runtime/uv)", "src/runtime/uv"],
    ["libleancpp.a", "native", "util", "Utilities (src/util)", "src/util"],
    ["libleancpp.a", "native", "kernel", "Kernel (src/kernel)", "src/kernel"],
    ["libleancpp.a", "native", "library", "C++ library support (src/library)", "src/library"],
    [
      "libleancpp.a",
      "native",
      "library/constructions",
      "Kernel constructions (src/library/constructions)",
      "src/library/constructions",
    ],
    ["libleancpp.a", "native", "initialize", "Initialization (src/initialize)", "src/initialize"],
  ];
  for (const [archive, layer, subsystem, label, directory] of groups) {
    const entries = await readdir(join(sourceRoot, directory), { withFileTypes: true });
    for (const entry of entries.sort((lhs, rhs) => lhs.name.localeCompare(rhs.name))) {
      if (!entry.isFile() || !/\.(?:cpp|c)$/.test(entry.name)) continue;
      addSourceCandidate(result, archive, `${entry.name}.o`, {
        layer,
        subsystem,
        label,
        path: `${directory}/${entry.name}`,
      });
    }
  }
  addSourceCandidate(result, "libleanrt.a", "static.c.o", {
    layer: "native",
    subsystem: "runtime/mimalloc",
    label: "Allocator implementation (mimalloc)",
    path: "mimalloc/src/static.c",
  });
  addSourceCandidate(result, "libLeanIR.a", "LeanIR.c.o.export", {
    layer: "program",
    subsystem: "LeanIR",
    label: "LeanIR program (src/LeanIR.lean)",
    path: "src/LeanIR.lean",
    generated: true,
  });
  return result;
}

function addSourceCandidate(result, archive, member, source) {
  const key = `${archive}/${member}`;
  const candidates = result.get(key) ?? [];
  candidates.push(source);
  result.set(key, candidates);
}

function runtimeBoundaryObjects(root) {
  const result = new Map();
  visitTree(root, (node) => {
    if (node.kind !== "object") return;
    let key = null;
    if (node.name.startsWith("Lean/runtime/")) {
      key = `libleanrt.a/${basename(node.name)}.o`;
    } else if (node.name.startsWith("Lean/kernel/") || node.name.startsWith("Lean/util/")) {
      key = `libleancpp.a/${basename(node.name)}.o`;
    } else if (node.name === "ir_interpreter.o") {
      key = "libleancpp.a/ir_interpreter.cpp.o";
    }
    if (key) result.set(key, node);
  });
  return result;
}

function annotateSurfaceSummaries(node) {
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
    }),
    {
      functionCount: 0,
      functionBytes: 0,
      overheadBytes: 0,
      retainedFunctionCount: 0,
      retainedNativeFunctionBytes: 0,
      retainedWasmFunctionBytes: 0,
    },
  );
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

function parseArArchive(buffer) {
  if (buffer.subarray(0, 8).toString("ascii") !== "!<arch>\n") {
    throw new Error("expected a Unix archive");
  }
  let offset = 8;
  let stringTable = null;
  const members = [];
  while (offset + 60 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 60);
    if (header.subarray(58, 60).toString("ascii") !== "`\n") {
      throw new Error(`invalid archive member header at byte ${offset}`);
    }
    let name = header.subarray(0, 16).toString("utf8").trim();
    const storedBytes = Number.parseInt(header.subarray(48, 58).toString("ascii").trim(), 10);
    if (!Number.isSafeInteger(storedBytes) || storedBytes < 0) {
      throw new Error(`invalid archive member size at byte ${offset}`);
    }
    const dataOffset = offset + 60;
    let payloadBytes = storedBytes;
    if (name === "//") {
      stringTable = buffer.subarray(dataOffset, dataOffset + storedBytes);
    } else if (/^\/\d+$/.test(name)) {
      if (!stringTable) throw new Error("archive uses a long name before its string table");
      const nameOffset = Number.parseInt(name.slice(1), 10);
      const tail = stringTable.subarray(nameOffset).toString("utf8");
      name = tail.slice(0, tail.search(/\/?\n/)).replace(/\/$/, "");
      members.push({ name, bytes: payloadBytes });
    } else if (name.startsWith("#1/")) {
      const nameBytes = Number.parseInt(name.slice(3), 10);
      name = buffer.subarray(dataOffset, dataOffset + nameBytes).toString("utf8").replace(/\0+$/, "");
      payloadBytes -= nameBytes;
      members.push({ name, bytes: payloadBytes });
    } else if (!["/", "/SYM64/", "__.SYMDEF", "__.SYMDEF SORTED"].includes(name)) {
      members.push({ name: name.replace(/\/$/, ""), bytes: payloadBytes });
    }
    offset = dataOffset + storedBytes + (storedBytes % 2);
  }
  return members;
}

async function readSurfaceLinks(path) {
  const links = JSON.parse(await readFile(path, "utf8"));
  if (links?.format !== "lean-vir-surface-size-links" || links.version !== 2 || !Array.isArray(links.externs)) {
    throw new Error(`invalid runnable-surface links file ${path}`);
  }
  return links;
}

function visitTree(node, visit) {
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
