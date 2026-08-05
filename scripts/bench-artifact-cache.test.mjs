/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { untrackedBuildInputDigests } from "./bench-artifact-cache.mjs";
import { benchmarkWasmBuildIdentity } from "./bench-utils.mjs";
import {
  effectiveWasmBuildIdentity,
  resolveEffectiveWasmBuildTools,
} from "./wasm-build-identity.mjs";

async function writeExecutable(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\n${contents}\n`);
  await chmod(path, 0o755);
}

async function writeVersionTool(path, version) {
  await writeExecutable(path, `printf '%s\\n' '${version}'`);
}

async function writeLeanTool(path) {
  await writeExecutable(path, [
    "case \"$1\" in",
    "  --print-prefix) printf '%s\\n' \"$FAKE_LEAN_PREFIX\" ;;",
    "  --version) printf '%s\\n' 'Lean version test' ;;",
    "  *) exit 2 ;;",
    "esac",
  ].join("\n"));
}

test("Wasm build identity has one shared set of defaults and overrides", () => {
  assert.deepEqual(benchmarkWasmBuildIdentity({}), {
    profile: "dev",
    optimization: "-O3",
    target: "wasm32-wasip1",
    initialMemory: "4194304",
    stackSize: "1048576",
  });
  assert.deepEqual(benchmarkWasmBuildIdentity({
    VIR_WASM_PROFILE: "",
    VIR_WASM_OPT_LEVEL: "",
    WASI_TARGET: "",
    VIR_WASM_INITIAL_MEMORY: "",
    VIR_WASM_STACK_SIZE: "",
  }), benchmarkWasmBuildIdentity({}));
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

test("effective Wasm tools use the repository-local SDK when the environment is unset", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vir-wasm-identity-local-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdkBin = join(root, ".tools", "wasi-sdk", "bin");
  const pathBin = join(root, "path-bin");
  const leanPrefix = join(root, "lean-prefix");
  await Promise.all([
    writeVersionTool(join(sdkBin, "clang++"), `local clang 22 installed at ${root}`),
    writeVersionTool(join(sdkBin, "wasm-ld"), "local wasm-ld 22"),
    writeVersionTool(join(sdkBin, "llvm-nm"), "local llvm-nm 22"),
    writeVersionTool(join(sdkBin, "llvm-objcopy"), "local llvm-objcopy 22"),
    writeLeanTool(join(pathBin, "lean")),
    mkdir(join(root, "third_party", "lean4-src"), { recursive: true }),
  ]);

  const env = { PATH: pathBin, FAKE_LEAN_PREFIX: leanPrefix };
  const tools = resolveEffectiveWasmBuildTools(root, env);
  assert.equal(tools.wasiSdkPath, join(root, ".tools", "wasi-sdk"));
  assert.equal(tools.compiler, join(sdkBin, "clang++"));
  assert.equal(tools.wasmLd, join(sdkBin, "wasm-ld"));
  assert.equal(tools.llvmNm, join(sdkBin, "llvm-nm"));
  assert.equal(tools.leanPrefix, leanPrefix);

  const identity = effectiveWasmBuildIdentity(root, env);
  assert.equal(identity.wasiSdkPath, ".tools/wasi-sdk");
  assert.deepEqual(identity.compiler, {
    path: ".tools/wasi-sdk/bin/clang++",
    version: "local clang 22 installed at <repo>",
  });
  assert.equal(identity.linker.version, "local wasm-ld 22");
  assert.equal(identity.leanSource.path, "third_party/lean4-src");
  assert.deepEqual(
    identity,
    effectiveWasmBuildIdentity(new URL("./", pathToFileURL(`${root}/`)), env),
  );
  assert.deepEqual(
    effectiveWasmBuildIdentity(root, { ...env, VIR_WASM_PROFILE: "release" }).objectStripper,
    { path: ".tools/wasi-sdk/bin/llvm-objcopy", version: "local llvm-objcopy 22" },
  );
});

test("effective Wasm tools honor explicit build overrides", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vir-wasm-identity-override-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pathBin = join(root, "path-bin");
  const sdk = join(root, "custom-sdk");
  const customBin = join(root, "custom-bin");
  const source = join(root, "custom-lean-source");
  const leanPrefix = join(root, "custom-lean-prefix");
  await Promise.all([
    writeVersionTool(join(sdk, "bin", "clang++"), "unused sdk clang"),
    writeVersionTool(join(customBin, "custom-cxx"), "custom clang"),
    writeVersionTool(join(customBin, "custom-wasm-ld"), "custom wasm-ld"),
    writeVersionTool(join(customBin, "custom-llvm-nm"), "custom llvm-nm"),
    writeLeanTool(join(pathBin, "lean")),
    mkdir(source, { recursive: true }),
  ]);
  const env = {
    PATH: pathBin,
    FAKE_LEAN_PREFIX: join(root, "ignored-prefix"),
    WASI_SDK_PATH: sdk,
    CXX: join(customBin, "custom-cxx"),
    WASM_LD: join(customBin, "custom-wasm-ld"),
    LLVM_NM: join(customBin, "custom-llvm-nm"),
    LEAN_PREFIX: leanPrefix,
    LEAN4_SRC: source,
  };

  const tools = resolveEffectiveWasmBuildTools(root, env);
  assert.equal(tools.wasiSdkPath, sdk);
  assert.equal(tools.compiler, join(customBin, "custom-cxx"));
  assert.equal(tools.wasmLd, join(customBin, "custom-wasm-ld"));
  assert.equal(tools.llvmNm, join(customBin, "custom-llvm-nm"));
  assert.equal(tools.leanPrefix, leanPrefix);
  assert.equal(tools.leanSourcePath, source);
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
