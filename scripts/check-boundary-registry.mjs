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

function parseNativeExterns(source) {
  const entries = [];
  const externsMatch = source.match(/def nativeExterns : Array NativeExtern := #\[((?:.|\n)*?)\n\]/);
  if (!externsMatch) {
    throw new Error("could not find nativeExterns table");
  }

  const blockRegex = /\{\s*name := `([^,\n]+),\s*params := #\[(.*?)\],\s*resultType := [^,]+,\s*symbol := "([^"]+)"\s*\}/gs;
  for (const match of externsMatch[1].matchAll(blockRegex)) {
    const name = match[1].trim();
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

function parseKnownSymbolStems(source) {
  const entries = new Map();
  const knownMatch = source.match(/static char const \* known_symbol_stem\(name const & n\) \{((?:.|\n)*?)\n\}/);
  if (!knownMatch) {
    throw new Error("could not find known_symbol_stem");
  }

  const entryRegex = /if \(n == name\(\{\s*([^}]+?)\s*\}\)\) \{\s*return "([^"]+)";\s*\}/gs;
  for (const match of knownMatch[1].matchAll(entryRegex)) {
    const parts = [...match[1].matchAll(/"([^"]+)"/g)].map((partMatch) => partMatch[1]);
    entries.set(cppNameKey(parts), match[2]);
  }
  return entries;
}

function parseDlsymSymbols(source) {
  return new Set([...source.matchAll(/strcmp\(sym, "([^"]+)"\) == 0/g)].map((match) => match[1]));
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
const knownSymbols = parseKnownSymbolStems(shim);
const dlsymSymbols = parseDlsymSymbols(shim);
const boxedWrappers = parseBoxedWrappers(shim);
const failures = [];

const expectedKnownKeys = new Set();
const expectedDlsymSymbols = new Set();
const expectedWrappers = new Set();

for (const entry of nativeExterns) {
  const key = cppNameKey(entry.parts);
  expectedKnownKeys.add(key);
  expectedDlsymSymbols.add(expectedDlsymSymbol(entry));
  const wrapper = expectedWrapper(entry);
  if (wrapper) {
    expectedWrappers.add(wrapper);
  }

  const knownSymbol = knownSymbols.get(key);
  if (knownSymbol === undefined) {
    failures.push(`${entry.name}: missing known_symbol_stem entry`);
  } else if (knownSymbol !== entry.symbol) {
    failures.push(`${entry.name}: known_symbol_stem has ${knownSymbol}, expected ${entry.symbol}`);
  }

  const dlsymSymbol = expectedDlsymSymbol(entry);
  if (!dlsymSymbols.has(dlsymSymbol)) {
    failures.push(`${entry.name}: missing dlsym entry for ${dlsymSymbol}`);
  }

  if (wrapper && !boxedWrappers.has(wrapper)) {
    failures.push(`${entry.name}: missing boxed wrapper ${wrapper}`);
  }
}

for (const key of knownSymbols.keys()) {
  if (!expectedKnownKeys.has(key)) {
    failures.push(`${key}: shim has extra known_symbol_stem entry`);
  }
}

for (const symbol of dlsymSymbols) {
  if (!expectedDlsymSymbols.has(symbol)) {
    failures.push(`${symbol}: shim has extra dlsym entry`);
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
