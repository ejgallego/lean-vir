/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  repositoryPath,
  repositoryRoot,
} from "../../scripts/repository-paths.mjs";

test("Lean-zip browser exporter loads from its package owner", () => {
  const entrypoint = "scripts/packages/lean-zip/export-browser-package.mjs";
  const result = spawnSync(process.execPath, [entrypoint, "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Build a client-native VIR runtime and lean-zip package/,
  );
});

test("Lean-zip browser package smoke remains a standalone payload module", () => {
  const smokePath = repositoryPath(
    "scripts",
    "packages",
    "lean-zip",
    "browser-package-smoke.mjs",
  );
  const result = spawnSync(process.execPath, ["--check", smokePath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Lean-zip acceptance command loads from its package owner", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/packages/lean-zip/acceptance.mjs"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: npm run accept:lean-zip/);
});
