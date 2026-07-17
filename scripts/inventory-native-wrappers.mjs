#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { parseNativeExterns } from "./native-externs.mjs";

const nativeExternsPath = new URL("../Vir/GeneratePackage/NativeExterns.lean", import.meta.url);
const nativeSymbolsPath = new URL("../wasm/upstream_shim/runtime/native_symbols.cpp", import.meta.url);
const nativeRegistryPath = new URL("../wasm/upstream_shim/runtime/native_symbols_registry.inc", import.meta.url);

// This is the complete handwritten boxed-wrapper exception set. Every entry
// records why Lean's standard wrapper would violate ownership at VIR's
// all-owned interpreter boundary.
const intentionalHandwrittenWrapperExceptions = new Map([
  [
    "lean_array_uget_borrowed___boxed",
    {
      kind: "regular-direct-retain",
      reason: "the raw element result is borrowed and must be retained before the array is released",
    },
  ],
  [
    "lean_array_fget_borrowed___boxed",
    {
      kind: "custom",
      reason: "uses the owned-result runtime getter before releasing the borrowed array",
    },
  ],
  [
    "lean_array_get_borrowed___boxed",
    {
      kind: "custom",
      reason: "uses the owned-result checked getter before releasing the default and array",
    },
  ],
]);

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!["--all", "--check", "--json"].includes(arg)) {
    console.error(`unknown argument: ${arg}`);
    console.error("usage: node scripts/inventory-native-wrappers.mjs [--all] [--check] [--json]");
    process.exit(2);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRegistry(source) {
  const entries = [];
  const constants = [];
  const entryRegex = /^\s*(X|X_CONST)\("([^"]+)",\s*"([^"]+)",\s*([A-Za-z0-9_&]+)\)\s*\\?$/gm;
  for (const match of source.matchAll(entryRegex)) {
    const entry = {
      leanName: match[2],
      symbol: match[3],
      wrapper: match[4].replace(/^&/, ""),
    };
    if (match[1] === "X_CONST") {
      constants.push(entry);
    } else {
      entries.push(entry);
    }
  }
  return { entries, constants };
}

function parseWrappers(source) {
  const wrappers = new Map();
  const wrapperRegex =
    /^extern "C" lean_object \* ([A-Za-z0-9_]+___boxed)\(([\s\S]*?)\) \{\n([\s\S]*?)^}/gm;
  for (const match of source.matchAll(wrapperRegex)) {
    wrappers.set(match[1], {
      name: match[1],
      body: match[3],
    });
  }
  return wrappers;
}

function entriesByWrapper(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const group = grouped.get(entry.wrapper) ?? [];
    group.push(entry);
    grouped.set(entry.wrapper, group);
  }
  return grouped;
}

function callsRegisteredSymbol(body, entries) {
  return entries.some((entry) => new RegExp(`\\b${escapeRegExp(entry.symbol)}\\s*\\(`).test(body));
}

function classifyWrapper(wrapper, entries) {
  if (!wrapper) {
    return { kind: "missing", reason: "registry entry has no boxed wrapper definition" };
  }

  const compactBody = wrapper.body.trim().replace(/\s+/g, " ");
  if (/^return [A-Za-z0-9_]+___boxed\([^;]*\);$/.test(compactBody)) {
    return { kind: "custom-alias", reason: "forwards to another boxed wrapper" };
  }

  if (callsRegisteredSymbol(wrapper.body, entries)) {
    if (/\blean_inc\s*\(\s*result\s*\)/.test(wrapper.body)) {
      return { kind: "regular-direct-retain", reason: "direct native call plus result retain" };
    }
    return { kind: "regular-direct", reason: "direct registered-symbol call with handwritten plumbing" };
  }

  return { kind: "custom", reason: "implements behavior beyond a direct registered-symbol adapter" };
}

function formatEntryNames(entries) {
  if (entries.length <= 3) {
    return entries.map((entry) => `\`${entry.leanName}\``).join(", ");
  }
  const first = entries.slice(0, 3).map((entry) => `\`${entry.leanName}\``).join(", ");
  return `${first}, ... (${entries.length} entries)`;
}

function formatSymbols(entries) {
  const symbols = [...new Set(entries.map((entry) => entry.symbol))];
  return symbols.map((symbol) => `\`${symbol}\``).join(", ");
}

const [nativeExternsSource, nativeSymbols, nativeRegistry] = await Promise.all([
  readFile(nativeExternsPath, "utf8"),
  readFile(nativeSymbolsPath, "utf8"),
  readFile(nativeRegistryPath, "utf8"),
]);

const nativeExterns = parseNativeExterns(nativeExternsSource);
const compilerGeneratedExterns = nativeExterns.filter((nativeExtern) => nativeExtern.generateBoxedWrapper);
const { entries, constants } = parseRegistry(nativeRegistry);
const wrappers = parseWrappers(nativeSymbols);
const grouped = entriesByWrapper(entries);
const inventory = [];

for (const [wrapperName, groupEntries] of grouped.entries()) {
  inventory.push({
    wrapper: wrapperName,
    entries: groupEntries,
    ...classifyWrapper(wrappers.get(wrapperName), groupEntries),
  });
}

for (const nativeExtern of compilerGeneratedExterns) {
  inventory.push({
    wrapper: `${nativeExtern.name}._boxed`,
    entries: [{
      leanName: nativeExtern.name,
      symbol: nativeExtern.symbol,
      wrapper: `${nativeExtern.name}._boxed`,
    }],
    kind: "compiler-generated",
    reason: "emitted by Lean's standard LCNF boxing and C emission pipeline",
  });
}

for (const wrapperName of wrappers.keys()) {
  if (!grouped.has(wrapperName)) {
    inventory.push({
      wrapper: wrapperName,
      entries: [],
      kind: "extra",
      reason: "boxed wrapper is not referenced by the native registry",
    });
  }
}

const kindOrder = [
  "compiler-generated",
  "regular-direct",
  "regular-direct-retain",
  "custom-alias",
  "custom",
  "missing",
  "extra",
];
const byKind = new Map(kindOrder.map((kind) => [kind, []]));
for (const item of inventory) {
  const exception = intentionalHandwrittenWrapperExceptions.get(item.wrapper);
  if (exception?.kind === item.kind) {
    item.reason = exception.reason;
  }
  const group = byKind.get(item.kind) ?? [];
  group.push(item);
  byKind.set(item.kind, group);
}

if (args.has("--json")) {
  console.log(JSON.stringify({ constants, inventory }, null, 2));
} else {
  console.log(
    `native wrapper inventory: ${inventory.length} boxed wrappers, ${entries.length} boxed registry entries, ` +
      `${compilerGeneratedExterns.length} compiler-generated registry entries, ` +
      `${constants.length} native constants`,
  );
  for (const kind of kindOrder) {
    const group = byKind.get(kind) ?? [];
    if (group.length !== 0) {
      console.log(`${kind}: ${group.length}`);
    }
  }

  const shouldList = (kind) =>
    args.has("--all") ||
    (args.has("--check")
      ? ["missing", "extra"].includes(kind)
      : ["regular-direct", "regular-direct-retain", "custom-alias", "custom", "missing", "extra"].includes(kind));

  for (const kind of kindOrder) {
    const group = byKind.get(kind) ?? [];
    if (group.length === 0 || !shouldList(kind)) {
      continue;
    }
    console.log(`\n## ${kind}`);
    for (const item of group) {
      const names = item.entries.length === 0 ? "(none)" : formatEntryNames(item.entries);
      const symbols = item.entries.length === 0 ? "(none)" : formatSymbols(item.entries);
      console.log(`- \`${item.wrapper}\`: ${names}; symbols ${symbols}; ${item.reason}`);
    }
  }
}

if (args.has("--check")) {
  const policyFailures = [];
  const foundHandwrittenExceptions = new Set();

  for (const item of inventory) {
    if (item.kind === "compiler-generated") {
      continue;
    }
    if (item.kind === "missing" || item.kind === "extra") {
      policyFailures.push(`${item.wrapper}: ${item.reason}`);
      continue;
    }

    const exception = intentionalHandwrittenWrapperExceptions.get(item.wrapper);
    if (!exception) {
      policyFailures.push(`${item.wrapper}: unapproved handwritten ${item.kind} adapter`);
    } else if (exception.kind !== item.kind) {
      policyFailures.push(
        `${item.wrapper}: expected ${exception.kind} ownership exception, found ${item.kind}`,
      );
    } else {
      foundHandwrittenExceptions.add(item.wrapper);
    }
  }

  for (const [wrapper, exception] of intentionalHandwrittenWrapperExceptions) {
    if (!foundHandwrittenExceptions.has(wrapper)) {
      policyFailures.push(
        `${wrapper}: expected ${exception.kind} ownership exception is missing (${exception.reason})`,
      );
    }
  }

  if (policyFailures.length !== 0) {
    if (args.has("--json")) {
      console.error(`native wrapper inventory check failed: ${policyFailures.length} failure(s)`);
    }
    for (const failure of policyFailures) {
      console.error(`native wrapper policy failure: ${failure}`);
    }
    process.exit(1);
  }
}
