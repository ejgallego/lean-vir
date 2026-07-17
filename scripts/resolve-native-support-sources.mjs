#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

function usage() {
  console.error(
    "usage: node scripts/resolve-native-support-sources.mjs STAGE0_ROOT SYMBOLS_FILE",
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectCFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".c")) {
      files.push(path);
    }
  }
  return files.sort();
}

function definesFunction(source, symbol) {
  const escaped = escapeRegExp(symbol);
  return new RegExp(`\\b${escaped}\\s*\\([^;{}]*\\)\\s*\\{`, "m").test(source);
}

const [stage0Root, symbolsFile, ...extraArgs] = process.argv.slice(2);
if (!stage0Root || !symbolsFile || extraArgs.length !== 0) {
  usage();
  process.exit(2);
}

const symbols = [
  ...new Set(
    (await readFile(symbolsFile, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ),
].sort();
const sources = [];
for (const path of await collectCFiles(stage0Root)) {
  sources.push({ path, source: await readFile(path, "utf8") });
}

for (const symbol of symbols) {
  const providers = sources.filter(({ source }) => definesFunction(source, symbol));
  if (providers.length > 1) {
    throw new Error(
      `multiple stage0 providers define ${symbol}:\n${providers.map(({ path }) => `  ${path}`).join("\n")}`,
    );
  }
  if (providers.length === 1) {
    console.log(`${symbol}\t${providers[0].path}`);
  }
}
