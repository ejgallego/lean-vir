#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { INTERFACE_TAG, SUPPORTED_INTERFACE_TAGS } from "../web/src/runtime/interface-tags.js";
import {
  HOST_IMPORT_BOUNDARY,
  INTERFACE_MANIFEST_ARTIFACT,
  INTERFACE_MANIFEST_VERSION as RUNTIME_INTERFACE_MANIFEST_VERSION,
} from "../web/src/runtime/interface-manifest.js";
import { IR_PACKAGE_MAGIC, IR_PACKAGE_SECTION } from "./irpkg-format.mjs";
import { PACKAGE_FORMAT_VERSION, INTERFACE_MANIFEST_VERSION, RUNTIME_ABI_VERSION } from "./package-versions.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

async function readRepoText(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function leanNatConstant(source, name) {
  const match = new RegExp(`def\\s+${name}\\s*:\\s*Nat\\s*:=\\s*(\\d+)`).exec(source);
  if (!match) {
    throw new Error(`missing Lean Nat constant ${name}`);
  }
  return Number(match[1]);
}

function matchedValue(source, pattern, label) {
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(`missing ${label}`);
  }
  return match[1];
}

function leanStringConstant(source, name) {
  return matchedValue(
    source,
    new RegExp(`def\\s+${name}\\s*:\\s*String\\s*:=\\s*"([^"]*)"`),
    `Lean String constant ${name}`,
  );
}

function cppNatConstant(source, name) {
  return Number(matchedValue(source, new RegExp(`\\b${name}\\s*=\\s*(\\d+)`), `C++ constant ${name}`));
}

function leanCtorToConstantKey(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function leanInterfaceTags(source) {
  const start = source.indexOf("def InterfaceType.interfaceTag");
  if (start < 0) {
    throw new Error("missing Lean InterfaceType.interfaceTag definition");
  }
  const end = source.indexOf("\n\n", start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const tags = new Map();
  for (const match of block.matchAll(/\|\s+\.([A-Za-z0-9_]+)\b[^=]*=>\s*(\d+)/g)) {
    const key = leanCtorToConstantKey(match[1]);
    const value = Number(match[2]);
    if (tags.has(key)) {
      throw new Error(`duplicate Lean interface descriptor tag key ${key}`);
    }
    tags.set(key, value);
  }
  if (tags.size === 0) {
    throw new Error("Lean InterfaceType.interfaceTag definition had no parseable cases");
  }
  return tags;
}

function leanHostImportBoundaries(source) {
  const start = source.indexOf("def HostImportBoundary.label");
  if (start < 0) {
    throw new Error("missing Lean HostImportBoundary.label definition");
  }
  const end = source.indexOf("\n\n", start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const boundaries = new Map();
  for (const match of block.matchAll(/\|\s+\.([A-Za-z0-9_]+)\b\s*=>\s*"([^"]+)"/g)) {
    const key = leanCtorToConstantKey(match[1]);
    const value = match[2];
    if (boundaries.has(key)) {
      throw new Error(`duplicate Lean host import boundary key ${key}`);
    }
    boundaries.set(key, value);
  }
  if (boundaries.size === 0) {
    throw new Error("Lean HostImportBoundary.label definition had no parseable cases");
  }
  return boundaries;
}

function duplicateValues(entries, label) {
  const seen = new Map();
  const duplicates = [];
  for (const [key, value] of entries) {
    const existing = seen.get(value);
    if (existing) {
      duplicates.push(`${value}: ${existing}, ${key}`);
    } else {
      seen.set(value, key);
    }
  }
  if (duplicates.length !== 0) {
    throw new Error(`${label} has duplicate descriptor tag values: ${duplicates.join("; ")}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: Lean=${actual} JavaScript=${expected}`);
  }
}

const packageFormat = await readRepoText("Vir/GeneratePackage/PackageFormat.lean");
assertEqual(
  leanNatConstant(packageFormat, "currentPackageFormatVersion"),
  PACKAGE_FORMAT_VERSION,
  "package format version mismatch",
);
assertEqual(
  leanNatConstant(packageFormat, "currentInterfaceManifestVersion"),
  INTERFACE_MANIFEST_VERSION,
  "interface manifest version mismatch",
);
if (RUNTIME_INTERFACE_MANIFEST_VERSION !== INTERFACE_MANIFEST_VERSION) {
  throw new Error(
    "runtime interface manifest version mismatch: " +
    `runtime=${RUNTIME_INTERFACE_MANIFEST_VERSION} packageVersions=${INTERFACE_MANIFEST_VERSION}`,
  );
}
if (!Number.isSafeInteger(RUNTIME_ABI_VERSION) || RUNTIME_ABI_VERSION < 1) {
  throw new Error(`runtime ABI version must be a positive safe integer, got ${RUNTIME_ABI_VERSION}`);
}

const packageJson = JSON.parse(await readRepoText("package.json"));
const sdkFetcherSource = await readRepoText("tools/VirFetchSdk.lean");
const lakefileSource = await readRepoText("lakefile.lean");
assertEqual(
  leanStringConstant(sdkFetcherSource, "sdkVersion"),
  packageJson.version,
  "SDK fetcher version mismatch",
);
assertEqual(
  leanNatConstant(sdkFetcherSource, "sdkRuntimeAbiVersion"),
  RUNTIME_ABI_VERSION,
  "SDK fetcher runtime ABI version mismatch",
);
assertEqual(
  leanStringConstant(lakefileSource, "virSdkVersion"),
  packageJson.version,
  "Lake SDK facet version mismatch",
);

const emitSource = await readRepoText("Vir/GeneratePackage/Emit.lean");
const manifestEncodeSource = await readRepoText("Vir/GeneratePackage/Manifest/Encode.lean");
const packageDecoderSource = await readRepoText("wasm/upstream_shim/package/package_ir_decoder.cpp");
const packageSectionsSource = await readRepoText("wasm/upstream_shim/package/package_section_directory.h");

assertEqual(
  leanStringConstant(packageFormat, "packageMagic"),
  IR_PACKAGE_MAGIC,
  "package magic mismatch in Lean",
);
if (!/emitString\s+packageMagic\b/.test(emitSource)) {
  throw new Error("Lean IR package emitter does not use packageMagic");
}
if (!/\("artifact",\s*jsonString\s+packageMagic\)/.test(manifestEncodeSource)) {
  throw new Error("Lean manifest encoder does not use packageMagic");
}
assertEqual(INTERFACE_MANIFEST_ARTIFACT, IR_PACKAGE_MAGIC, "manifest artifact mismatch in JavaScript");
assertEqual(
  matchedValue(packageDecoderSource, /magic\s*!=\s*"([^"]+)"/, "C++ IR package magic"),
  IR_PACKAGE_MAGIC,
  "package magic mismatch in C++ decoder",
);
assertEqual(
  Number(matchedValue(packageDecoderSource, /return\s+version\s*==\s*(\d+)/, "C++ package format version")),
  PACKAGE_FORMAT_VERSION,
  "package format version mismatch in C++ decoder",
);

const packageSections = [
  ["packageSectionDeclarations", "package_section_declarations", "DECLARATIONS"],
  ["packageSectionInitGlobals", "package_section_init_globals", "INIT_GLOBALS"],
  ["packageSectionHostImports", "package_section_host_imports", "HOST_IMPORTS"],
  ["packageSectionExportSummaries", "package_section_export_summaries", "EXPORT_SUMMARIES"],
  ["packageSectionInterfaceManifest", "package_section_interface_manifest", "INTERFACE_MANIFEST"],
];
for (const [leanName, cppName, jsName] of packageSections) {
  const leanValue = leanNatConstant(packageFormat, leanName);
  assertEqual(
    cppNatConstant(packageSectionsSource, cppName),
    leanValue,
    `package section ${jsName} mismatch in C++`,
  );
  assertEqual(
    IR_PACKAGE_SECTION[jsName],
    leanValue,
    `package section ${jsName} mismatch in JavaScript`,
  );
}

const interfaceSource = await readRepoText("Vir/GeneratePackage/Interface/Encode.lean");
const leanTags = leanInterfaceTags(interfaceSource);
const jsTags = new Map(Object.entries(INTERFACE_TAG));

duplicateValues(leanTags, "Lean InterfaceType.interfaceTag");
duplicateValues(jsTags, "JavaScript INTERFACE_TAG");

for (const [key, value] of jsTags) {
  if (!leanTags.has(key)) {
    throw new Error(`JavaScript INTERFACE_TAG.${key} is missing from Lean InterfaceType.interfaceTag`);
  }
  if (leanTags.get(key) !== value) {
    throw new Error(`interface descriptor tag mismatch for ${key}: Lean=${leanTags.get(key)} JavaScript=${value}`);
  }
  if (!SUPPORTED_INTERFACE_TAGS.has(value)) {
    throw new Error(`SUPPORTED_INTERFACE_TAGS is missing INTERFACE_TAG.${key}=${value}`);
  }
}

for (const [key] of leanTags) {
  if (!jsTags.has(key)) {
    throw new Error(`Lean InterfaceType.interfaceTag case ${key} is missing from JavaScript INTERFACE_TAG`);
  }
}

if (SUPPORTED_INTERFACE_TAGS.size !== jsTags.size) {
  throw new Error(`SUPPORTED_INTERFACE_TAGS has ${SUPPORTED_INTERFACE_TAGS.size} entries; INTERFACE_TAG has ${jsTags.size}`);
}

const interfaceBasicSource = await readRepoText("Vir/GeneratePackage/Basic.lean");
const leanBoundaries = leanHostImportBoundaries(interfaceBasicSource);
const jsBoundaries = new Map(Object.entries(HOST_IMPORT_BOUNDARY));

duplicateValues(leanBoundaries, "Lean HostImportBoundary.label");
duplicateValues(jsBoundaries, "JavaScript HOST_IMPORT_BOUNDARY");

for (const [key, value] of jsBoundaries) {
  if (!leanBoundaries.has(key)) {
    throw new Error(`JavaScript HOST_IMPORT_BOUNDARY.${key} is missing from Lean HostImportBoundary.label`);
  }
  if (leanBoundaries.get(key) !== value) {
    throw new Error(`host import boundary mismatch for ${key}: Lean=${leanBoundaries.get(key)} JavaScript=${value}`);
  }
}

for (const [key] of leanBoundaries) {
  if (!jsBoundaries.has(key)) {
    throw new Error(`Lean HostImportBoundary.label case ${key} is missing from JavaScript HOST_IMPORT_BOUNDARY`);
  }
}

console.log(
  `package ABI guardrails ok: magic, versions, ${packageSections.length} package sections, ` +
  `${jsTags.size} interface descriptor tags, ${jsBoundaries.size} host import boundaries, and SDK ${packageJson.version} agree`,
);
