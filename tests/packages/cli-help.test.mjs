/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { repositoryRoot } from "../../scripts/repository-paths.mjs";

const helpCases = [
  ["scripts/packages/generate-browser-package.mjs", /browser packages are generated/u],
  ["scripts/packages/lean-to-irpkg.mjs", /Generate one manifest-bearing \.irpkg/u],
  ["scripts/packages/inspect-irpkg.mjs", /Inspect one manifest-bearing Lean IR package/u],
  ["scripts/packages/prepare-irpkg.mjs", /Generate browser-ready \.irpkg files/u],
  ["scripts/packages/lean-zip/acceptance.mjs", /Compare Lean-zip's native and VIR raw-DEFLATE behavior/u],
];

test("package entry points provide clean help", () => {
  for (const [script, pattern] of helpCases) {
    for (const option of ["-h", "--help"]) {
      const result = spawnSync(process.execPath, [script, option], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${script} ${option}: ${result.stderr}`);
      assert.match(result.stdout, pattern, `${script} ${option}`);
      assert.equal(result.stderr, "", `${script} ${option}`);
    }
  }
});
