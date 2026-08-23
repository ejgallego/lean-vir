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

test("Illuminate browser exporter loads from its package owner", () => {
  const entrypoint =
    "scripts/packages/illuminate/export-browser-package.mjs";
  const result = spawnSync(process.execPath, [entrypoint, "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Consume a validated Illuminate workload and build its matching VIR browser\s+package/,
  );
});

test("Illuminate browser package smoke remains a standalone payload module", () => {
  const smokePath = repositoryPath(
    "scripts",
    "packages",
    "illuminate",
    "browser-package-smoke.mjs",
  );
  const result = spawnSync(process.execPath, ["--check", smokePath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
