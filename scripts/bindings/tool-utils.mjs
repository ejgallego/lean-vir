/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

export function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`${option} requires a value`);
  return value;
}

export async function emitGeneratedFile(path, contents, {
  check = false,
  root,
  staleHint,
} = {}) {
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== contents) {
      fail(`${relative(root, path)} is stale; ${staleHint}`);
    }
    return "validated";
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return "wrote";
}
