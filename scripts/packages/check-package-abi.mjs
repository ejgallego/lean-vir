#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { repositoryRoot } from "../repository-paths.mjs";
import {
  HOST_IMPORT_BOUNDARY,
  INTERFACE_MANIFEST_ARTIFACT,
  INTERFACE_MANIFEST_VERSION as RUNTIME_INTERFACE_MANIFEST_VERSION,
} from "../../web/src/runtime/interface-manifest.js";
import {
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
} from "../../web/src/vir-runtime.js";
import { IR_PACKAGE_MAGIC, IR_PACKAGE_SECTION } from "./irpkg-format.mjs";
import { PACKAGE_FORMAT_VERSION, INTERFACE_MANIFEST_VERSION, RUNTIME_ABI_VERSION, VIR_COMPATIBILITY_VERSION } from "./package-versions.mjs";
import { assertResourceCompatibility } from "../../web/src/resources/compatibility.js";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--write")) {
  throw new Error("expected --write or no arguments");
}

async function readRepoText(path) {
  return readFile(join(repositoryRoot, path), "utf8");
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
    throw new Error(`${label} has duplicate values: ${duplicates.join("; ")}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: Lean=${actual} JavaScript=${expected}`);
  }
}

const packageFormat = await readRepoText("Vir/Package/Format.lean");
assertEqual(
  leanStringConstant(packageFormat, "packageSetFormat"),
  IR_PACKAGE_SET_FORMAT,
  "package-set descriptor format mismatch",
);
assertEqual(
  leanNatConstant(packageFormat, "currentPackageSetVersion"),
  IR_PACKAGE_SET_VERSION,
  "package-set descriptor version mismatch",
);
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
  leanNatConstant(packageFormat, "currentRuntimeAbiVersion"),
  RUNTIME_ABI_VERSION,
  "runtime ABI version mismatch",
);
assertEqual(
  leanNatConstant(packageFormat, "currentVirCompatibilityVersion"),
  VIR_COMPATIBILITY_VERSION,
  "VIR resource compatibility version mismatch",
);
assertResourceCompatibility(JSON.parse(await readRepoText("vir-resources/compatibility.json")));
// Producer behavior is exercised by resources/acquisition.mjs and the SDK
// acceptance/rejection cases in packages/lake-facets.sh, not source spelling.
assertEqual(
  leanStringConstant(lakefileSource, "virSdkVersion"),
  packageJson.version,
  "Lake SDK facet version mismatch",
);
// Both Lake adapters now consume the shared native program result. Its format
// authority is PackageFormat.lean, checked against the runtime above; Lake no
// longer owns a second descriptor codec or duplicate format/version constants.

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

// Type and value descriptors are validated as a manifest pair. Their string
// tags are part of the versioned manifest grammar, not duplicated numeric ABI
// constants in Lean and JavaScript.

const interfaceModelSource = await readRepoText("Vir/Compiler/Interface/Model.lean");
const leanBoundaries = leanHostImportBoundaries(interfaceModelSource);
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

// The producer owns these limits. Generate the runtime's constants from the
// same definitions; no handwritten slot or arity list lives in the shim.
const packageBasic = await readRepoText("Vir/GeneratePackage/Basic.lean");
const hostSlots = leanNatConstant(packageBasic, "maxHostImportSlots");
const hostArity = leanNatConstant(packageBasic, "maxHostImportArity");
if (!Number.isSafeInteger(hostSlots) || hostSlots <= 0 || hostSlots > 0x7fffffff ||
    !Number.isSafeInteger(hostArity) || hostArity < 0 || hostArity >= 0xffffffff) {
  throw new Error("host import limits must fit their runtime slot/arity types");
}
const hostLimitsPath = join(repositoryRoot, "build/generated/wasm/package/host_import_limits.h");
const hostLimits = `// Generated by scripts/packages/check-package-abi.mjs --write.
// Authority: Vir/GeneratePackage/Basic.lean.
#pragma once
#include <stdint.h>
namespace lean::vir {
inline constexpr uint32_t max_host_import_slots = ${hostSlots};
inline constexpr uint32_t max_host_import_arity = ${hostArity};
}
`;
const existingLimits = await readFile(hostLimitsPath, "utf8").catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (args.includes("--write")) {
  if (existingLimits !== hostLimits) {
    await mkdir(dirname(hostLimitsPath), { recursive: true });
    await writeFile(hostLimitsPath, hostLimits);
  }
} else if (existingLimits !== null && existingLimits !== hostLimits) {
  throw new Error("stale host import limits; run node scripts/packages/check-package-abi.mjs --write");
}

console.log(
  `package ABI guardrails ok: magic, package-set descriptor, versions, ${packageSections.length} package sections, ` +
  `${jsBoundaries.size} host import boundaries, host limits ${hostSlots}/${hostArity}, and SDK ${packageJson.version} agree`,
);
