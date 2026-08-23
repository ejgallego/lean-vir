#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { scriptSafeJson } from "../json-utils.mjs";
import { repositoryPath } from "../repository-paths.mjs";
import { compactFrontierCostReport } from "./frontier-size-costs.mjs";
import { stageStaticReportShell } from "./report-render-utils.mjs";
import { validateSurfaceSizeLinks } from "./surface-report-schema.mjs";
import { parseLinkMap, parseWasm } from "./wasm-size-report.mjs";
import {
  annotateRuntimeContextTree,
  annotateSurfaceSummaries,
  binaryPayload,
  buildOwnershipTree,
  buildSectionTree,
  compareBytesThenName,
  connectSurfaceLinks,
  countKind,
  indexSurfaceLinks,
  sumChildren,
  visitTree,
} from "./wasm-size-report/model.mjs";

const HTML_FORMAT = "lean-vir-wasm-size-html";
const HTML_VERSION = 9;
const templateDir = repositoryPath("web", "tools", "wasm-size-report");

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

await mkdir(dataDir, { recursive: true });

await Promise.all([
  stageStaticReportShell(templateDir, outputDir),
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
    failedCandidates: frontierCosts.candidates.filter((candidate) => candidate.error).length,
  } : null,
};
await writeFile(join(outputDir, "vir-wasm-size-html.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `rendered ${payload.attribution.objects} objects and ${payload.attribution.symbols} retained symbols `
    + `to ${outputDir} (${formatBytes(attributedBytes)} of ${formatBytes(attribution.codeDataBytes)} Code+Data attributed)`,
);

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
    const sectionsByMember = archiveSectionCatalog(path);
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
      const sections = sectionsByMember.get(member.name)?.[occurrence - 1];
      if (!sections) {
        throw new Error(
          `no ELF section inventory for ${file} member ${member.name} occurrence ${occurrence}`,
        );
      }
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
        sections,
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
            .filter((child) => child.kind === "runtimeOverhead")
            .reduce((sum, child) => sum + child.bytes, 0),
          zeroFillBytes: sections.zeroFillBytes,
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
  const { surfaceSummary, maxFrontierDensity } = annotateRuntimeContextTree(tree);
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

function archiveSectionCatalog(archivePath) {
  const result = spawnSync("readelf", ["-SW", archivePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `unable to inspect native sections in ${archivePath}: ${result.stderr || result.stdout}`,
    );
  }

  const occurrences = new Map();
  let memberName = null;
  let summary = null;
  const flush = () => {
    if (memberName === null) return;
    const members = occurrences.get(memberName) ?? [];
    members.push(summary);
    occurrences.set(memberName, members);
  };
  for (const line of result.stdout.split(/\r?\n/)) {
    const heading = /^File: .+\((.+)\)$/.exec(line);
    if (heading) {
      flush();
      memberName = heading[1];
      summary = {
        executableBytes: 0,
        readOnlyDataBytes: 0,
        writableDataBytes: 0,
        exceptionBytes: 0,
        relocationBytes: 0,
        symbolNameBytes: 0,
        debugBytes: 0,
        zeroFillBytes: 0,
      };
      continue;
    }
    if (memberName === null) continue;
    const section = /^\s*\[\s*\d+\]\s+(\S+)\s+(\S+)\s+\S+\s+[0-9a-fA-F]+\s+([0-9a-fA-F]+)\s+\S+\s*([A-Z]*)/.exec(line);
    if (!section) continue;
    const [, name, type, sizeText, flags] = section;
    const bytes = Number.parseInt(sizeText, 16);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`invalid ELF section size in ${archivePath}: ${line}`);
    }
    if (type === "NOBITS") {
      if (flags.includes("A")) summary.zeroFillBytes += bytes;
    } else if (type === "REL" || type === "RELA") {
      summary.relocationBytes += bytes;
    } else if (type === "SYMTAB" || type === "STRTAB") {
      summary.symbolNameBytes += bytes;
    } else if (flags.includes("X")) {
      summary.executableBytes += bytes;
    } else if (name.startsWith(".eh_frame") || name.startsWith(".gcc_except_table")) {
      summary.exceptionBytes += bytes;
    } else if (name.startsWith(".debug_") || name.startsWith(".zdebug_")) {
      summary.debugBytes += bytes;
    } else if (flags.includes("A") && flags.includes("W")) {
      summary.writableDataBytes += bytes;
    } else if (flags.includes("A")) {
      summary.readOnlyDataBytes += bytes;
    }
  }
  flush();
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
  sections,
  retainedSymbols,
  surfaceDeclarations,
  nextId,
}) {
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
      return true;
    })) declarationsByName.set(declaration.name, declaration);
    for (const symbol of matches) {
      for (const declaration of symbol.meta?.surfaceDeclarations ?? []) {
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
  const otherExecutableBytes = sections.executableBytes - functionBytes;
  if (otherExecutableBytes < 0 || functionBytes > member.bytes) {
    throw new Error(
      `${archive} member ${member.name} has ${functionBytes} function bytes but only ` +
        `${sections.executableBytes} executable section bytes and ${member.bytes} archive bytes`,
    );
  }
  const measuredCategories = [
    {
      category: "otherExecutable",
      name: "Other executable code",
      bytes: otherExecutableBytes,
      note: "Executable section bytes not assigned to a positive-sized function symbol.",
    },
    {
      category: "readOnlyData",
      name: "Read-only runtime data",
      bytes: sections.readOnlyDataBytes,
      note: "Allocated read-only constants and tables, excluding exception metadata.",
    },
    {
      category: "writableData",
      name: "Initialized writable data",
      bytes: sections.writableDataBytes,
      note: "Writable section payload stored in the archive member; zero-fill memory is reported separately.",
    },
    {
      category: "exceptions",
      name: "Exception and unwind tables",
      bytes: sections.exceptionBytes,
      note: "ELF exception tables and stack-unwind frame data.",
    },
    {
      category: "relocations",
      name: "Relocation records",
      bytes: sections.relocationBytes,
      note: "Link-time relocation entries; these are not retained as runtime data.",
    },
    {
      category: "symbolNames",
      name: "Symbol and string tables",
      bytes: sections.symbolNameBytes,
      note: "ELF symbol and name tables used by archive and linker tooling.",
    },
    {
      category: "debug",
      name: "Debug information",
      bytes: sections.debugBytes,
      note: "Debug sections stored in the installed archive member.",
    },
  ];
  const measuredBytes = measuredCategories.reduce((sum, category) => sum + category.bytes, 0);
  const metadataBytes = member.bytes - functionBytes - measuredBytes;
  if (metadataBytes < 0) {
    throw new Error(
      `${archive} member ${member.name} section categories exceed its ${member.bytes} archive bytes`,
    );
  }
  measuredCategories.push({
    category: "objectMetadata",
    name: "ELF metadata and alignment",
    bytes: metadataBytes,
    note: "ELF headers, section headers, groups, compiler metadata, and file alignment not represented by another category.",
  });
  const visibleCategories = measuredCategories.filter((entry) => entry.bytes > 0);
  // Preserve the previous one-ID-per-member overhead allocation so adding
  // detail categories does not invalidate stable directory/member deep links.
  const overheadId = visibleCategories.length > 0 ? nextId() : null;
  for (const category of visibleCategories) {
    children.push({
      id: `runtime-overhead-${overheadId}-${category.category}`,
      name: category.name,
      kind: "runtimeOverhead",
      bytes: category.bytes,
      meta: {
        archive,
        archiveIndex,
        memberName: member.name,
        category: category.category,
        inVirBoundary: false,
        note: category.note,
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
  return validateSurfaceSizeLinks(links, { label: `runnable-surface links file ${path}` });
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
