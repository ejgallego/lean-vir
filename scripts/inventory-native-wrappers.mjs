#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

const nativeExternsPath = new URL("../Vir/GeneratePackage/NativeExterns.lean", import.meta.url);
const nativeSymbolsPath = new URL("../wasm/upstream_shim/runtime/native_symbols.cpp", import.meta.url);
const nativeRegistryPath = new URL("../wasm/upstream_shim/runtime/native_symbols_registry.inc", import.meta.url);

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
    const kind = match[1];
    const entry = {
      leanName: match[2],
      symbol: match[3],
      wrapper: match[4].replace(/^&/, ""),
    };
    if (kind === "X_CONST") {
      constants.push(entry);
    } else {
      entries.push(entry);
    }
  }
  return { entries, constants };
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

function parseIRType(source) {
  const trimmed = source.trim();
  const simple = /^\.(float|uint8|uint16|uint32|uint64|usize|erased|object|tobject|float32|tagged|void)$/.exec(
    trimmed,
  );
  if (simple) {
    return simple[1];
  }
  const named = /^\.(struct|union)\s+/.exec(trimmed);
  if (named) {
    return named[1];
  }
  return trimmed;
}

function parseParam(paramSource) {
  const match = /\bparam\s+(\d+)\s+(true|false)\s+([^,\]]+)/.exec(paramSource.trim());
  if (!match) {
    throw new Error(`unsupported native extern param expression: ${paramSource.trim()}`);
  }
  return {
    index: Number(match[1]),
    borrow: match[2] === "true",
    type: parseIRType(match[3]),
  };
}

function parseNativeExterns(source) {
  const externsMatch = source.match(/def nativeExterns : Array NativeExtern := #\[((?:.|\n)*?)\n\]/);
  if (!externsMatch) {
    throw new Error("could not find nativeExterns table");
  }

  const entries = new Map();
  const blockRegex =
    /\{\s*name := ([^,\n]+(?:\s+"[^"]+")?),\s*params := #\[(.*?)\],\s*resultType := ([^,\n]+),\s*symbol := "([^"]+)"(?:,\s*deps := #\[(.*?)\])?\s*\}/gs;
  for (const match of externsMatch[1].matchAll(blockRegex)) {
    const name = normalizeNativeName(match[1]);
    const params = [...match[2].matchAll(/\bparam\s+\d+\s+(?:true|false)\s+[^,\]]+/g)].map((paramMatch) =>
      parseParam(paramMatch[0]),
    );
    entries.set(name, {
      name,
      params,
      resultType: parseIRType(match[3]),
      symbol: match[4],
    });
  }
  return entries;
}

function parseWrappers(source) {
  const wrappers = new Map();
  const wrapperRegex =
    /^extern "C" lean_object \* ([A-Za-z0-9_]+___boxed)\(([\s\S]*?)\) \{\n([\s\S]*?)^}/gm;
  for (const match of source.matchAll(wrapperRegex)) {
    wrappers.set(match[1], {
      name: match[1],
      params: match[2].trim(),
      body: match[3],
    });
  }
  const generatedHelperRegex =
    /^VIR_DEFINE_BOX_(UNARY|BINARY)_WRAPPER\(([A-Za-z0-9_]+),\s*([A-Za-z0-9_]+)\)$/gm;
  for (const match of source.matchAll(generatedHelperRegex)) {
    const symbol = match[2];
    wrappers.set(`${symbol}___boxed`, {
      name: `${symbol}___boxed`,
      generatedHelper: true,
      arity: match[1].toLowerCase(),
      symbol,
      helper: match[3],
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

function mentionsRegisteredSymbol(body, entries) {
  return entries.some((entry) => new RegExp(`\\b${escapeRegExp(entry.symbol)}\\b`).test(body));
}

function callsRegisteredSymbol(body, entries) {
  return entries.some((entry) => new RegExp(`\\b${escapeRegExp(entry.symbol)}\\s*\\(`).test(body));
}

function customMarker(body) {
  const markers = [
    ["control flow", /\b(if|for|while)\s*\(/],
    ["allocation or constructor access", /\blean_(alloc|ctor)_/],
    ["reference object internals", /\b(lean_ref_object|lean_to_ref|LeanRef)\b/],
    ["interpreter callback", /\brun_boxed\b/],
    ["trap", /__builtin_trap\b/],
    ["raw memory comparison", /\bmemcmp\s*\(/],
    ["shim global state", /\bg_vir_/],
    ["task runtime policy", /\blean_task_map_core\b/],
  ];
  return markers.find(([, pattern]) => pattern.test(body))?.[0] ?? null;
}

function classifyWrapper(wrapper, entries) {
  if (!wrapper) {
    return { kind: "missing", reason: "registry entry has no boxed wrapper definition" };
  }

  if (wrapper.generatedHelper) {
    if (!entries.some((entry) => entry.symbol === wrapper.symbol)) {
      return {
        kind: "generated-helper-mismatch",
        reason: `generated helper wraps ${wrapper.symbol}, but registry has ${formatSymbols(entries)}`,
      };
    }
    return {
      kind: "generated-helper",
      reason: `macro-generated ${wrapper.arity} helper via ${wrapper.helper}`,
    };
  }

  const compactBody = wrapper.body.trim().replace(/\s+/g, " ");
  const mentionsSymbol = mentionsRegisteredSymbol(wrapper.body, entries);
  const callsSymbol = callsRegisteredSymbol(wrapper.body, entries);
  const marker = customMarker(wrapper.body);

  if (/^return box_[A-Za-z0-9_]+\([^;]*\);$/.test(compactBody) && mentionsSymbol) {
    return { kind: "regular-helper", reason: "one-line box_* helper wrapper" };
  }

  if (/^return [A-Za-z0-9_]+___boxed\([^;]*\);$/.test(compactBody)) {
    return { kind: "custom-alias", reason: "forwards to another boxed wrapper" };
  }

  if (!marker && callsSymbol) {
    if (/\blean_inc\s*\(\s*result\s*\)/.test(wrapper.body)) {
      return { kind: "regular-direct-retain", reason: "direct native call plus result retain" };
    }
    return { kind: "regular-direct", reason: "direct native call with local box/unbox/dec plumbing" };
  }

  return {
    kind: "custom",
    reason: marker ?? "does not call the registered native symbol directly",
  };
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

function helperForSignature(nativeExtern) {
  const types = nativeExtern.params.map((param) => param.type);
  if (types.length === 1) {
    const type = types[0];
    if (type === "tobject" && nativeExtern.resultType === "tobject") return "box_object_unary";
    if (type === "uint8" && nativeExtern.resultType === "uint8") return "box_uint8_unary";
    if (type === "uint16" && nativeExtern.resultType === "uint16") return "box_uint16_unary";
    if (type === "uint32" && nativeExtern.resultType === "uint32") return "box_uint32_unary";
    if (type === "uint64" && nativeExtern.resultType === "uint64") return "box_uint64_unary";
  } else if (types.length === 2 && types[0] === types[1]) {
    const type = types[0];
    const result = nativeExtern.resultType;
    if (type === "tobject" && result === "tobject") return "box_object_binary";
    if (type === "tobject" && result === "uint8") return "box_object_predicate";
    if (type === "uint8" && result === "uint8") return "box_uint8_binary";
    if (type === "uint16" && result === "uint16") return "box_uint16_binary";
    if (type === "uint16" && result === "uint8") return "box_uint16_predicate";
    if (type === "uint32" && result === "uint32") return "box_uint32_binary";
    if (type === "uint32" && result === "uint8") return "box_uint32_predicate";
    if (type === "uint64" && result === "uint64") return "box_uint64_binary";
    if (type === "uint64" && result === "uint8") return "box_uint64_predicate";
    if (type === "usize" && result === "usize") return "box_usize_binary";
    if (type === "usize" && result === "uint8") return "box_usize_predicate";
  }
  return null;
}

const [nativeExternsSource, nativeSymbols, nativeRegistry] = await Promise.all([
  readFile(nativeExternsPath, "utf8"),
  readFile(nativeSymbolsPath, "utf8"),
  readFile(nativeRegistryPath, "utf8"),
]);

const nativeExterns = parseNativeExterns(nativeExternsSource);
const { entries, constants } = parseRegistry(nativeRegistry);
const wrappers = parseWrappers(nativeSymbols);
const grouped = entriesByWrapper(entries);
const inventory = [];

for (const [wrapperName, groupEntries] of grouped.entries()) {
  const wrapper = wrappers.get(wrapperName);
  const item = {
    wrapper: wrapperName,
    entries: groupEntries,
    ...classifyWrapper(wrapper, groupEntries),
  };
  if (item.kind === "generated-helper") {
    const expectedHelpers = new Set();
    for (const entry of groupEntries) {
      const nativeExtern = nativeExterns.get(entry.leanName);
      if (!nativeExtern) {
        item.kind = "generated-helper-mismatch";
        item.reason = `${entry.leanName}: no native extern entry found`;
        break;
      }
      const expectedHelper = helperForSignature(nativeExtern);
      if (!expectedHelper) {
        item.kind = "generated-helper-mismatch";
        item.reason = `${entry.leanName}: no helper mapping for ${nativeExtern.params
          .map((param) => param.type)
          .join(", ")} -> ${nativeExtern.resultType}`;
        break;
      }
      expectedHelpers.add(expectedHelper);
    }
    if (item.kind === "generated-helper") {
      const expected = [...expectedHelpers];
      if (expected.length !== 1 || expected[0] !== wrapper.helper) {
        item.kind = "generated-helper-mismatch";
        item.reason = `macro uses ${wrapper.helper}, expected ${expected.join(" or ")}`;
      }
    }
  }
  inventory.push(item);
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
  "generated-helper",
  "regular-helper",
  "regular-direct",
  "regular-direct-retain",
  "custom-alias",
  "custom",
  "generated-helper-mismatch",
  "missing",
  "extra",
];
const byKind = new Map(kindOrder.map((kind) => [kind, []]));
for (const item of inventory) {
  const group = byKind.get(item.kind) ?? [];
  group.push(item);
  byKind.set(item.kind, group);
}

if (args.has("--json")) {
  console.log(JSON.stringify({ constants, inventory }, null, 2));
} else {
  console.log(
    `native wrapper inventory: ${inventory.length} boxed wrappers, ${entries.length} boxed registry entries, ` +
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
      ? ["generated-helper-mismatch", "missing", "extra"].includes(kind)
      : ["generated-helper-mismatch", "regular-direct-retain", "custom-alias", "custom", "missing", "extra"].includes(kind));

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
  const failures = inventory.filter((item) =>
    ["generated-helper-mismatch", "missing", "extra"].includes(item.kind)
  );
  if (failures.length !== 0) {
    if (args.has("--json")) {
      console.error(`native wrapper inventory check failed: ${failures.length} failure(s)`);
    }
    process.exit(1);
  }
}
