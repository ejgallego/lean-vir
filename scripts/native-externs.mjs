/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

function unsupportedSyntax(kind, source) {
  const preview = source.trim().replace(/\s+/g, " ").slice(0, 120);
  throw new Error(`unsupported native extern ${kind} syntax near: ${preview || "(empty)"}`);
}

function assertOnlySeparators(kind, source) {
  if (!/^[\s,]*$/.test(source)) {
    unsupportedSyntax(kind, source);
  }
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
  unsupportedSyntax("name", trimmed);
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
  unsupportedSyntax("IR type", trimmed);
}

function parseParam(paramSource) {
  const match = /^param\s+(\d+)\s+(true|false)\s+(.+)$/.exec(paramSource.trim());
  if (!match) {
    unsupportedSyntax("param", paramSource);
  }
  return {
    index: Number(match[1]),
    borrow: match[2] === "true",
    type: parseIRType(match[3]),
  };
}

function parseParams(source) {
  const params = [];
  const paramRegex = /\bparam\s+\d+\s+(?:true|false)\s+[^,\]]+/g;
  let cursor = 0;
  for (const match of source.matchAll(paramRegex)) {
    assertOnlySeparators("param list", source.slice(cursor, match.index));
    params.push(parseParam(match[0]));
    cursor = match.index + match[0].length;
  }
  assertOnlySeparators("param list", source.slice(cursor));
  return params;
}

export function parseNativeExterns(source) {
  const externsMatch = source.match(/def nativeExterns : Array NativeExtern := #\[((?:.|\n)*?)\n\]/);
  if (!externsMatch) {
    throw new Error("could not find nativeExterns table");
  }

  const table = externsMatch[1];
  const entries = [];
  const names = new Set();
  const blockRegex =
    /\{\s*name := ([^,\n]+(?:\s+"[^"]+")?),\s*params := #\[([^}]*?)\],\s*resultType := ([^,\n]+),\s*symbol := "([^"]+)"(?:,\s*deps := #\[([^}]*?)\])?\s*\}/gs;
  let cursor = 0;
  for (const match of table.matchAll(blockRegex)) {
    assertOnlySeparators("table", table.slice(cursor, match.index));
    const name = normalizeNativeName(match[1]);
    if (names.has(name)) {
      throw new Error(`${name}: duplicate native extern registration`);
    }
    names.add(name);
    entries.push({
      name,
      params: parseParams(match[2]),
      resultType: parseIRType(match[3]),
      symbol: match[4],
    });
    cursor = match.index + match[0].length;
  }
  assertOnlySeparators("table", table.slice(cursor));
  return entries;
}
