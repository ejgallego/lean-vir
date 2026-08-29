/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { acquireLeanSource } from "../../scripts/packages/build-local-sdk.mjs";
import {
  SDK_METADATA_FILES,
  sdkReadme,
} from "../../scripts/packages/sdk-metadata.mjs";

test("shared SDK guidance prefers composed application assets", () => {
  assert.deepEqual(SDK_METADATA_FILES, ["README.txt", "LICENSE", "NOTICE"]);
  for (const readme of [sdkReadme(), sdkReadme({ localBuild: true })]) {
    assert.match(readme, /named Lean library with one or more explicit application roots/);
    assert.match(readme, /library's virWebAssets facet/);
    assert.match(readme, /one live Wasm instance and Lean heap/);
    assert.match(readme, /lower-level commands remain available/);
  }
  assert.match(
    sdkReadme({ localBuild: true }),
    /built locally for the consuming workspace's exact Lean toolchain/,
  );
});

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function objectPath({
  objectRoot,
  leanRoot,
  virRoot,
  clientRoot = "",
  source,
}) {
  const script = join(
    import.meta.dirname,
    "..",
    "..",
    "scripts",
    "source-object-path.sh",
  );
  const result = spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; vir_object_path_for_source "$2" "$3" "$4" "$5" "$6"',
      "object-path-test",
      script,
      objectRoot,
      leanRoot,
      virRoot,
      clientRoot,
      source,
    ],
    { encoding: "utf8" },
  );
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

test("bounds local SDK object names below a deeply nested consumer cache", () => {
  const virCommit = "a".repeat(40);
  const leanCommit = "b".repeat(40);
  const consumerRoot = join(
    tmpdir(),
    "verso-slides",
    ".worktrees",
    `pr161-consumer-${"nested-".repeat(10)}`,
  );
  const buildRoot = join(
    consumerRoot,
    ".lake",
    "build",
    "vir",
    "sdk-build-cache",
    `${virCommit}-${leanCommit}`,
  );
  const virRoot = join(buildRoot, "vir");
  const leanRoot = join(buildRoot, `lean4-${leanCommit}`);
  const clientRoot = consumerRoot;
  const objectRoot = join(virRoot, "build", "upstream-probe", "obj");
  const paths = [
    objectPath({
      objectRoot,
      leanRoot,
      virRoot,
      clientRoot,
      source: join(leanRoot, "stage0", "stdlib", "Lean", "Data", "KVMap.c"),
    }),
    objectPath({
      objectRoot,
      leanRoot,
      virRoot,
      clientRoot,
      source: join(leanRoot, "src", "runtime", "object.cpp"),
    }),
    objectPath({
      objectRoot,
      leanRoot,
      virRoot,
      clientRoot,
      source: join(clientRoot, "native", "providers", "runtime.c"),
    }),
  ];

  for (const path of paths) {
    assert.ok(
      Buffer.byteLength(basename(path)) <= 80,
      `object basename is unexpectedly long: ${basename(path)}`,
    );
  }

  const movedBuildRoot = join(tmpdir(), "same-sdk-at-another-root");
  const movedLeanRoot = join(movedBuildRoot, `lean4-${leanCommit}`);
  const movedLeanObject = objectPath({
    objectRoot,
    leanRoot: movedLeanRoot,
    virRoot,
    source: join(movedLeanRoot, "stage0", "stdlib", "Lean", "Data", "KVMap.c"),
  });
  assert.equal(movedLeanObject, paths[0]);

  const sameBasenameA = objectPath({
    objectRoot,
    leanRoot,
    virRoot,
    source: join(leanRoot, "src", "runtime", "object.cpp"),
  });
  const sameBasenameB = objectPath({
    objectRoot,
    leanRoot,
    virRoot,
    source: join(leanRoot, "src", "kernel", "object.cpp"),
  });
  assert.notEqual(sameBasenameA, sameBasenameB);

  const externalA = objectPath({
    objectRoot,
    leanRoot,
    virRoot,
    source: join(tmpdir(), "provider-a", "runtime.c"),
  });
  const externalB = objectPath({
    objectRoot,
    leanRoot,
    virRoot,
    source: join(tmpdir(), "provider-b", "runtime.c"),
  });
  assert.notEqual(externalA, externalB);

  const movedClientRoot = join(tmpdir(), "same-client-at-another-root");
  const movedClientObject = objectPath({
    objectRoot,
    leanRoot,
    virRoot,
    clientRoot: movedClientRoot,
    source: join(movedClientRoot, "native", "providers", "runtime.c"),
  });
  assert.equal(basename(movedClientObject), basename(paths[2]));
});
