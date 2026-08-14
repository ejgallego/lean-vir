/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { loadNativeExterns } from "./native-externs.mjs";
import {
  generateNativeSymbolRegistry,
  nativeSymbolRegistryEntry,
  parseNativeSymbolRegistry,
} from "./native-symbol-registry.mjs";

const nativeSymbolsPath = new URL("../wasm/upstream_shim/runtime/native_symbols.cpp", import.meta.url);
const nativeRegistryPath = new URL("../build/generated/wasm/runtime/native_symbols_registry.inc", import.meta.url);
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (arg !== "--write") {
    throw new Error(`unknown argument ${JSON.stringify(arg)}; expected --write or no arguments`);
  }
}
const writeMode = args.has("--write");

function parseBoxedWrappers(source) {
  return new Set(
    [...source.matchAll(/extern "C" lean_object \* ([A-Za-z0-9_]+___boxed)\(/g)].map((match) => match[1])
  );
}

const nativeSymbols = await readFile(nativeSymbolsPath, "utf8");

const nativeExterns = await loadNativeExterns();
const generatedRegistry = generateNativeSymbolRegistry(nativeExterns);
if (writeMode) {
  await mkdir(new URL(".", nativeRegistryPath), { recursive: true });
  await writeFile(nativeRegistryPath, generatedRegistry);
}

const nativeRegistryEntries = new Map(
  parseNativeSymbolRegistry(generatedRegistry).map((entry) => [entry.leanName, entry]),
);
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

  const expectedRegistryEntry = nativeSymbolRegistryEntry(entry);
  expectedDlsymSymbols.add(expectedRegistryEntry.dlsymSymbol);
  const wrapper = expectedRegistryEntry.kind === "X" ? expectedRegistryEntry.wrapper : null;
  if (wrapper) {
    expectedWrappers.add(wrapper);
  }

  if (registryEntry === undefined) {
    failures.push(`${entry.name}: missing native registry entry`);
  } else if (registryEntry.symbol !== entry.symbol) {
    failures.push(`${entry.name}: registry has ${registryEntry.symbol}, expected ${entry.symbol}`);
  } else if (registryEntry.kind !== expectedRegistryEntry.kind) {
    failures.push(`${entry.name}: registry has ${registryEntry.kind}, expected ${expectedRegistryEntry.kind}`);
  }

  if (registryEntry !== undefined && registryEntry.dlsymSymbol !== expectedRegistryEntry.dlsymSymbol) {
    failures.push(
      `${entry.name}: registry dlsym symbol has ${registryEntry.dlsymSymbol}, `
      + `expected ${expectedRegistryEntry.dlsymSymbol}`,
    );
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
