/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireLeanSource } from "../../scripts/packages/build-local-sdk.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("acquires an exact Lean RC commit into an empty cache without LEAN4_SRC", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lean-vir-sdk-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const upstream = join(root, "lean4-upstream");
  await mkdir(upstream);
  git(upstream, ["init", "--quiet"]);
  await writeFile(join(upstream, "README.md"), "exact Lean source fixture\n");
  git(upstream, ["add", "README.md"]);
  git(upstream, [
    "-c",
    "user.name=VIR test",
    "-c",
    "user.email=vir-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  const expectedCommit = git(upstream, ["rev-parse", "HEAD"]);
  assert.equal(git(upstream, ["branch", "--list", "4.34.0-rc2"]), "");

  const cache = join(root, "empty-cache");
  const source = await acquireLeanSource(
    cache,
    "leanprover/lean4:v4.34.0-rc2",
    expectedCommit,
    { configuredSource: null, repository: upstream },
  );

  assert.equal(git(source, ["rev-parse", "HEAD"]), expectedCommit);
  assert.equal(source, join(cache, `lean4-${expectedCommit}`));
});
