/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Release names follow Lean, independently of SDK versions and milestones.
export function releaseTagFromToolchain(toolchain) {
  const match = /^leanprover\/lean4:v(\d+)\.(\d+)\.(\d+)(-rc\d+)?$/.exec(toolchain.trim());
  if (!match) throw new Error(`unsupported release toolchain: ${toolchain.trim()}`);
  const [, major, minor, patch, suffix = ""] = match;
  return `${major}.${minor}${patch === "0" ? "" : `.${patch}`}${suffix}`;
}

export function checkReleaseTag(tag, toolchain) {
  const expected = releaseTagFromToolchain(toolchain);
  if (tag !== expected) throw new Error(`release tag ${tag} does not match lean-toolchain (expected ${expected})`);
  return expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && !(args.length === 2 && args[0] === "--check"))
      throw new Error("usage: node scripts/release-tag.mjs [--check TAG]");
    const toolchain = await readFile(new URL("../lean-toolchain", import.meta.url), "utf8");
    console.log(args.length ? checkReleaseTag(args[1], toolchain) : releaseTagFromToolchain(toolchain));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
