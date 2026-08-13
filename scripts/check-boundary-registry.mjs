/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { loadNativeExterns } from "./native-externs.mjs";
import {
  generateNativeSymbolRegistry,
  parseNativeSymbolRegistry,
} from "./native-symbol-registry.mjs";

const nativeSymbolsPath = new URL("../wasm/upstream_shim/runtime/native_symbols.cpp", import.meta.url);
const nativeRegistryPath = new URL("../build/generated/wasm/runtime/native_symbols_registry.inc", import.meta.url);
const writeMode = process.argv.includes("--write");

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

const nativeSymbols = await readFile(nativeSymbolsPath, "utf8");

const nativeExterns = await loadNativeExterns();
const generatedRegistry = generateNativeSymbolRegistry(nativeExterns);
if (writeMode) {
  await mkdir(new URL(".", nativeRegistryPath), { recursive: true });
  await writeFile(nativeRegistryPath, generatedRegistry);
}

const nativeRegistryEntries = parseNativeSymbolRegistry(generatedRegistry);
const boxedWrappers = parseBoxedWrappers(nativeSymbols);
const failures = [];

const expectedDlsymSymbols = new Set();
const expectedWrappers = new Set();

for (const entry of nativeExterns) {
  const key = entry.name;
  const registryEntry = nativeRegistryEntries.get(key);
  if (entry.generateBoxedWrapper) {
    if (entry.params.length === 0) {
      failures.push(`${entry.name}: compiler-generated wrapper cannot be a native constant`);
    }
    if (registryEntry !== undefined) {
      failures.push(`${entry.name}: compiler-generated wrapper must not be in the shim registry`);
    }
    continue;
  }

  expectedDlsymSymbols.add(expectedDlsymSymbol(entry));
  const wrapper = expectedWrapper(entry);
  if (wrapper) {
    expectedWrappers.add(wrapper);
  }

  if (registryEntry === undefined) {
    failures.push(`${entry.name}: missing native registry entry`);
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

for (const [key, entry] of nativeRegistryEntries.entries()) {
  if (!nativeExterns.some((nativeExtern) => nativeExtern.name === key && !nativeExtern.generateBoxedWrapper)) {
    failures.push(`${key}: native registry has extra entry`);
  }
  if (!expectedDlsymSymbols.has(entry.dlsymSymbol)) {
    failures.push(`${entry.dlsymSymbol}: native registry has extra dlsym entry`);
  }
}

for (const wrapper of boxedWrappers) {
  if (!expectedWrappers.has(wrapper)) {
    failures.push(`${wrapper}: runtime/native_symbols.cpp has extra boxed wrapper`);
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
