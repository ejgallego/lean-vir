#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { WIRE, SUPPORTED_WIRE_TAGS } from "../web/src/runtime/wire-tags.js";
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

function leanCtorToWireKey(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function leanWireTags(source) {
  const start = source.indexOf("def InterfaceType.wireTag");
  if (start < 0) {
    throw new Error("missing Lean InterfaceType.wireTag definition");
  }
  const end = source.indexOf("\n\n", start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const tags = new Map();
  for (const match of block.matchAll(/\|\s+\.([A-Za-z0-9_]+)\b[^=]*=>\s*(\d+)/g)) {
    const key = leanCtorToWireKey(match[1]);
    const value = Number(match[2]);
    if (tags.has(key)) {
      throw new Error(`duplicate Lean wire tag key ${key}`);
    }
    tags.set(key, value);
  }
  if (tags.size === 0) {
    throw new Error("Lean InterfaceType.wireTag definition had no parseable cases");
  }
  return tags;
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
    throw new Error(`${label} has duplicate wire tag values: ${duplicates.join("; ")}`);
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
if (!Number.isSafeInteger(RUNTIME_ABI_VERSION) || RUNTIME_ABI_VERSION < 1) {
  throw new Error(`runtime ABI version must be a positive safe integer, got ${RUNTIME_ABI_VERSION}`);
}

const interfaceSource = await readRepoText("Vir/GeneratePackage/Interface.lean");
const leanTags = leanWireTags(interfaceSource);
const jsTags = new Map(Object.entries(WIRE));

duplicateValues(leanTags, "Lean InterfaceType.wireTag");
duplicateValues(jsTags, "JavaScript WIRE");

for (const [key, value] of jsTags) {
  if (!leanTags.has(key)) {
    throw new Error(`JavaScript WIRE.${key} is missing from Lean InterfaceType.wireTag`);
  }
  if (leanTags.get(key) !== value) {
    throw new Error(`wire tag mismatch for ${key}: Lean=${leanTags.get(key)} JavaScript=${value}`);
  }
  if (!SUPPORTED_WIRE_TAGS.has(value)) {
    throw new Error(`SUPPORTED_WIRE_TAGS is missing WIRE.${key}=${value}`);
  }
}

for (const [key] of leanTags) {
  if (!jsTags.has(key)) {
    throw new Error(`Lean InterfaceType.wireTag case ${key} is missing from JavaScript WIRE`);
  }
}

if (SUPPORTED_WIRE_TAGS.size !== jsTags.size) {
  throw new Error(`SUPPORTED_WIRE_TAGS has ${SUPPORTED_WIRE_TAGS.size} entries; WIRE has ${jsTags.size}`);
}

console.log(`package ABI guardrails ok: versions and ${jsTags.size} wire tags agree`);
