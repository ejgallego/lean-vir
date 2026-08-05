/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { untrackedBuildInputDigests } from "./bench-artifact-cache.mjs";
import { benchmarkWasmBuildIdentity } from "./bench-utils.mjs";

test("Wasm build identity has one shared set of defaults and overrides", () => {
  assert.deepEqual(benchmarkWasmBuildIdentity({}), {
    profile: "dev",
    optimization: "-O3",
    target: "wasm32-wasip1",
    initialMemory: "4194304",
    stackSize: "1048576",
  });
  assert.deepEqual(benchmarkWasmBuildIdentity({
    VIR_WASM_PROFILE: "release",
    VIR_WASM_OPT_LEVEL: "-O2",
    WASI_TARGET: "wasm32-wasi",
    VIR_WASM_INITIAL_MEMORY: "8388608",
    VIR_WASM_STACK_SIZE: "2097152",
  }), {
    profile: "release",
    optimization: "-O2",
    target: "wasm32-wasi",
    initialMemory: "8388608",
    stackSize: "2097152",
  });
});

test("artifact cache identity hashes untracked build-input contents", async (t) => {
  const repo = await mkdtemp(join(tmpdir(), "vir-artifact-cache-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: repo, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);

  await mkdir(join(repo, "Vir"), { recursive: true });
  const source = join(repo, "Vir", "NewExperiment.lean");
  await writeFile(source, "def result := 1\n");
  const before = untrackedBuildInputDigests(repo, repo);
  assert.deepEqual(Object.keys(before), ["Vir/NewExperiment.lean"]);
  assert.match(before["Vir/NewExperiment.lean"], /^[0-9a-f]{64}$/);

  await writeFile(source, "def result := 2\n");
  const after = untrackedBuildInputDigests(repo, repo);
  assert.notEqual(
    before["Vir/NewExperiment.lean"],
    after["Vir/NewExperiment.lean"],
  );
});
