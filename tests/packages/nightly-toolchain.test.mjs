/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { latestNightlyRelease, validateNightlyToolchain } from "../../scripts/nightly-toolchain.mjs";

test("nightly selection accepts exact dates and rejects floating or invalid names", () => {
  for (const date of ["2026-10-20", "2028-02-29"])
    assert.equal(validateNightlyToolchain(`leanprover/lean4-nightly:nightly-${date}\n`),
      `leanprover/lean4-nightly:nightly-${date}`);
  for (const value of ["nightly", "leanprover/lean4:nightly-2026-10-20",
    "leanprover/lean4-nightly:nightly-2026-02-29", "leanprover/lean4-nightly:nightly-2026-13-01",
    "leanprover/lean4-nightly:nightly-2026-10-20\nEXTRA=value"])
    assert.throws(() => validateNightlyToolchain(value), /expected/);
});

test("selection uses publication time and excludes drafts and non-nightly tags", () => {
  const release = (tag, day, draft = false) => ({ tag_name: tag, published_at: `2026-10-${day}T12:00:00Z`, draft });
  const selected = release("nightly-2026-10-19", "21");
  assert.equal(latestNightlyRelease([
    release("nightly-2026-10-20", "20"), release("nightly-2026-10-22", "22", true),
    release("latest", "23"), selected,
  ]), selected);
  assert.throws(() => latestNightlyRelease([release("nightly", "20")]), /no published/);
});

test("an explicit dated selection records one toolchain without a release lookup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vir-nightly-"));
  try {
    const envFile = join(directory, "env");
    const toolchain = "leanprover/lean4-nightly:nightly-2026-10-20";
    const script = fileURLToPath(new URL("../../scripts/nightly-toolchain.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, toolchain, directory], {
      encoding: "utf8", env: { ...process.env, GITHUB_ENV: envFile },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(directory, "toolchain.txt"), "utf8"), toolchain + "\n");
    assert.equal(await readFile(envFile, "utf8"), `NIGHTLY_TOOLCHAIN=${toolchain}\n`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the workflow creates a project-relative runtime lock for ordinary Lake clients", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vir-nightly-lock-"));
  try {
    const workflow = await readFile(new URL("../../.github/workflows/nightly.yml", import.meta.url), "utf8");
    const step = workflow.split("      - name: Use the run-local pack for ordinary client qualification\n")[1];
    assert.ok(step);
    const script = step.split("node --input-type=module <<'NODE'\n")[1]
      .split("          NODE\n")[0].split("\n").map(line => line.replace(/^          /, "")).join("\n");
    const contentId = "a".repeat(64);
    await mkdir(join(directory, "build/artifacts/runtime"), { recursive: true });
    await mkdir(join(directory, "vir-resources"));
    await writeFile(join(directory, "build/artifacts/runtime/provenance.json"), JSON.stringify({ contentId }));
    const result = spawnSync(process.execPath, ["--input-type=module"], { input: script, cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "vir-resources/runtime.json"), "utf8")), {
      schemaVersion: 1, contentId, source: `build/artifacts/runtime/${contentId}.virres`,
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
