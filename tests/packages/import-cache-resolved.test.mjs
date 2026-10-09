import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

test("resolved-import harness initializes its output on a fresh checkout", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vir-import-cache-startup-"));
  try {
    for (const directory of ["tests/packages", "scripts", ".lake/build/lib/lean"])
      mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of [
      "tests/packages/import-cache-resolved.mjs", "scripts/repository-paths.mjs",
    ]) copyFileSync(path.join(repositoryRoot, file), path.join(root, file));
    const result = spawnSync(process.execPath,
      [path.join(root, "tests/packages/import-cache-resolved.mjs")],
      { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    // Stop at the deliberate missing-input boundary, before any Lean command.
    // Output initialization must succeed without a pre-existing build directory.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing prepared IR: ModuleSetFixture.InputSelection/);
    assert.ok(readdirSync(path.join(root, "build"))
      .some((name) => name.startsWith("import-cache-resolved-")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
