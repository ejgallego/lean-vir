/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Maintainer release operation, never invoked by application acquisition.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [tag, pack, ...extra] = process.argv.slice(2);
if (!tag || !pack || extra.length)
  throw new Error("usage: node scripts/resources/publish-runtime.mjs TAG PACK");
const name = basename(pack);
const { assets } = JSON.parse(
  execFileSync("gh", ["release", "view", tag, "--json", "assets"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
if (assets.some((asset) => asset.name === name)) {
  const temporary = await mkdtemp(join(tmpdir(), "vir-runtime-release-"));
  try {
    execFileSync(
      "gh",
      ["release", "download", tag, "--pattern", name, "--dir", temporary],
      { stdio: "inherit" },
    );
    if (!(await readFile(pack)).equals(await readFile(join(temporary, name))))
      throw new Error(
        `existing runtime asset differs: ${tag}/${name}; left unchanged`,
      );
    console.log(`reused identical runtime asset: ${tag}/${name}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} else {
  // No clobber: concurrent publication or a rerun must never replace this name.
  execFileSync("gh", ["release", "upload", tag, pack], { stdio: "inherit" });
}
