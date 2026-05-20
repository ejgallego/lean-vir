/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

const generatorPath = new URL("../tools/GeneratePackage.lean", import.meta.url);
const shimPath = new URL("../wasm/upstream_shim/shim.cpp", import.meta.url);

function nativeNameParts(name) {
  return name.split(".");
}

function cppNameKey(parts) {
  return parts.join(".");
}

function normalizeNativeName(nameExpr) {
  const trimmed = nameExpr.trim();
  if (trimmed.startsWith("`")) {
    return trimmed.slice(1);
  }
  const privateEnvironmentMatch = trimmed.match(/^privateEnvironmentName\s+"([^"]+)"$/);
  if (privateEnvironmentMatch) {
    return `_private.Lean.Environment.0.Lean.Environment.${privateEnvironmentMatch[1]}`;
  }
  throw new Error(`unsupported native extern name expression: ${trimmed}`);
}

function parseNativeExterns(source) {
  const entries = [];
  const externsMatch = source.match(/def nativeExterns : Array NativeExtern := #\[((?:.|\n)*?)\n\]/);
  if (!externsMatch) {
    throw new Error("could not find nativeExterns table");
  }

  const blockRegex = /\{\s*name := ([^,\n]+(?:\s+"[^"]+")?),\s*params := #\[(.*?)\],\s*resultType := [^,]+,\s*symbol := "([^"]+)"(?:,\s*deps := #\[(.*?)\])?\s*\}/gs;
  for (const match of externsMatch[1].matchAll(blockRegex)) {
    const name = normalizeNativeName(match[1]);
    const params = [...match[2].matchAll(/\bparam\s+\d+/g)].map((paramMatch) => paramMatch[0]);
    entries.push({
      name,
      parts: nativeNameParts(name),
      params,
      symbol: match[3],
    });
  }
  return entries;
}

function parseShimRegistry(source) {
  const entries = new Map();
  const startMarker = "#define VIR_NATIVE_SYMBOLS(X, X_CONST) \\\n";
  const endMarker = "\n\nstruct NativeSymbol";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("could not find VIR_NATIVE_SYMBOLS table");
  }

  const table = source.slice(start + startMarker.length, end);
  const entryRegex = /^\s*(X|X_CONST)\("([^"]+)",\s*"([^"]+)",\s*([A-Za-z0-9_&]+)\)\s*\\?$/gm;
  for (const match of table.matchAll(entryRegex)) {
    const kind = match[1];
    const name = match[2];
    const symbol = match[3];
    entries.set(name, {
      symbol,
      dlsymSymbol: kind === "X_CONST" ? symbol : `${symbol}___boxed`,
    });
  }

  return entries;
}

function parseBoxedWrappers(source) {
  return new Set(
    [...source.matchAll(/extern "C" lean_object \* ([A-Za-z0-9_]+___boxed)\(/g)].map((match) => match[1])
  );
}

function expectedDlsymSymbol(entry) {
  if (entry.params.length === 0 && entry.symbol.startsWith("l_")) {
    return entry.symbol;
  }
  return `${entry.symbol}___boxed`;
}

function expectedWrapper(entry) {
  const symbol = expectedDlsymSymbol(entry);
  return symbol.endsWith("___boxed") ? symbol : null;
}

const generator = await readFile(generatorPath, "utf8");
const shim = await readFile(shimPath, "utf8");

const nativeExterns = parseNativeExterns(generator);
const shimRegistry = parseShimRegistry(shim);
const boxedWrappers = parseBoxedWrappers(shim);
const failures = [];

const expectedDlsymSymbols = new Set();
const expectedWrappers = new Set();

for (const entry of nativeExterns) {
  const key = cppNameKey(entry.parts);
  expectedDlsymSymbols.add(expectedDlsymSymbol(entry));
  const wrapper = expectedWrapper(entry);
  if (wrapper) {
    expectedWrappers.add(wrapper);
  }

  const registryEntry = shimRegistry.get(key);
  if (registryEntry === undefined) {
    failures.push(`${entry.name}: missing VIR_NATIVE_SYMBOLS entry`);
  } else if (registryEntry.symbol !== entry.symbol) {
    failures.push(`${entry.name}: registry has ${registryEntry.symbol}, expected ${entry.symbol}`);
  }

  const dlsymSymbol = expectedDlsymSymbol(entry);
  if (registryEntry !== undefined && registryEntry.dlsymSymbol !== dlsymSymbol) {
    failures.push(`${entry.name}: registry dlsym symbol has ${registryEntry.dlsymSymbol}, expected ${dlsymSymbol}`);
  }

  if (wrapper && !boxedWrappers.has(wrapper)) {
    failures.push(`${entry.name}: missing boxed wrapper ${wrapper}`);
  }
}

for (const [key, entry] of shimRegistry.entries()) {
  if (!nativeExterns.some((nativeExtern) => cppNameKey(nativeExtern.parts) === key)) {
    failures.push(`${key}: shim has extra VIR_NATIVE_SYMBOLS entry`);
  }
  if (!expectedDlsymSymbols.has(entry.dlsymSymbol)) {
    failures.push(`${entry.dlsymSymbol}: shim has extra dlsym registry entry`);
  }
}

for (const wrapper of boxedWrappers) {
  if (!expectedWrappers.has(wrapper)) {
    failures.push(`${wrapper}: shim has extra boxed wrapper`);
  }
}

if (failures.length !== 0) {
  console.error("boundary registry check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`boundary registry ok: ${nativeExterns.length} native externs`);
