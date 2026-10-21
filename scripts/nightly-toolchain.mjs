/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Match lean-beam's dated-nightly selection policy; project gates stay local.
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateNightlyToolchain(toolchain) {
  const value = toolchain.trim();
  const match = /^leanprover\/lean4-nightly:nightly-(\d{4}-\d{2}-\d{2})$/.exec(value);
  const date = new Date(`${match?.[1]}T00:00:00Z`);
  if (!match || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== match[1])
    throw new Error("expected leanprover/lean4-nightly:nightly-YYYY-MM-DD with a valid date");
  return value;
}

export function latestNightlyRelease(releases) {
  const published = releases.filter(release => {
    if (release.draft || !Number.isFinite(Date.parse(release.published_at))) return false;
    try {
      validateNightlyToolchain(`leanprover/lean4-nightly:${release.tag_name}`);
      return true;
    } catch { return false; }
  });
  published.sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at));
  if (!published.length) throw new Error("no published dated Lean nightly release found");
  return published[0];
}

async function main() {
  const [requested, output, ...extra] = process.argv.slice(2);
  if (requested === undefined || !output || extra.length)
    throw new Error('usage: node scripts/nightly-toolchain.mjs "TOOLCHAIN_OR_EMPTY" OUTPUT_DIR');
  let release;
  let toolchain = requested.trim();
  if (!toolchain) {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    const response = await fetch("https://api.github.com/repos/leanprover/lean4-nightly/releases?per_page=5", {
      headers, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`nightly release lookup failed: HTTP ${response.status}`);
    release = latestNightlyRelease(await response.json());
    toolchain = `leanprover/lean4-nightly:${release.tag_name}`;
  }
  toolchain = validateNightlyToolchain(toolchain);
  await mkdir(output, { recursive: true });
  if (release) await writeFile(join(output, "release.json"), JSON.stringify(release, null, 2) + "\n");
  await writeFile(join(output, "toolchain.txt"), toolchain + "\n");
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `NIGHTLY_TOOLCHAIN=${toolchain}\n`);
  console.log(toolchain);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
