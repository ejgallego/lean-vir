/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { repositoryRoot } from "../../scripts/repository-paths.mjs";

const helpCases = [
  [
    "scripts/packages/generate-browser-package.mjs",
    /browser packages are generated/u,
  ],
  [
    "scripts/packages/lean-to-irpkg.mjs",
    /Generate one manifest-bearing \.irpkg/u,
  ],
  [
    "scripts/packages/inspect-irpkg.mjs",
    /Inspect one manifest-bearing Lean IR package/u,
  ],
  [
    "scripts/packages/prepare-irpkg.mjs",
    /Generate browser-ready \.irpkg files/u,
  ],
  [
    "scripts/packages/lean-zip/acceptance.mjs",
    /Compare Lean-zip's native and VIR raw-DEFLATE behavior/u,
  ],
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

test("lean-zip acceptance requires an explicit checkout argument", () => {
  const script = "scripts/packages/lean-zip/acceptance.mjs";
  const result = spawnSync(process.execPath, [script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      LEAN_ZIP_CHECKOUT: "unused-lean-zip-checkout",
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /usage: npm run accept:lean-zip/u);
  assert.doesNotMatch(result.stderr, /Lake configuration not found/u);
});

test("module package CLIs reject invalid inputs before invoking build tools", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vir-module-config-errors-"));
  try {
    const cases = [
      [
        "scripts/packages/lean-to-irpkg.mjs",
        ["examples/Fib.lean"],
        /module identity/,
      ],
      [
        "scripts/packages/lean-to-irpkg.mjs",
        ["Fib", "--help"],
        /must be a non-empty path/,
      ],
    ];
    for (const [config, pattern] of [
      [{ version: 1, source: "examples/Fib.lean" }, /unknown field source/],
      [{ version: 2, module: "Fib", roots: "fib" }, /roots.*must be an array/],
      [
        { version: 2, module: "Fib", includeAll: "true" },
        /includeAll.*must be a boolean/,
      ],
      [
        {
          version: 2,
          module: "Fib",
          package: "same.irpkg",
          report: "./same.irpkg",
        },
        /output collision/,
      ],
    ]) {
      const path = join(scratch, `${cases.length}.json`);
      writeFileSync(path, JSON.stringify(config));
      cases.push(["scripts/packages/prepare-irpkg.mjs", [path], pattern]);
    }
    const collidingConfigs = ["Foo.Widget", "Bar.Widget"].map(
      (module, index) => {
        const path = join(scratch, `collision-${index}.json`);
        writeFileSync(path, JSON.stringify({ version: 2, module }));
        return path;
      },
    );
    cases.push([
      "scripts/packages/prepare-irpkg.mjs",
      collidingConfigs,
      /output collision/,
    ]);
    for (const [script, args, pattern] of cases) {
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: scratch },
      });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stderr, /spawn|ENOENT|at file:/);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
