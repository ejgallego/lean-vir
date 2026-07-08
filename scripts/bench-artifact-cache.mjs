/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { copyFileWithDirs } from "./file-utils.mjs";
import { runSync } from "./process-utils.mjs";

const artifactCacheVersion = 1;
const buildInputDiffPaths = [
  "Lean",
  "Vir",
  "examples",
  "fixtures",
  "interfaces",
  "tools",
  "wasm",
  "package.json",
  "package-lock.json",
  "lean-toolchain",
  "scripts/browser-package-config.mjs",
  "scripts/build-lean-lib.sh",
  "scripts/build-upstream-probe.sh",
  "scripts/generate-browser-package.mjs",
  "scripts/generate-ir-package.sh",
];
const sourceIdentityPaths = [
  "package-lock.json",
  "fixtures/browser-packages.json",
  "scripts/browser-package-config.mjs",
  "scripts/build-lean-lib.sh",
  "scripts/build-upstream-probe.sh",
  "scripts/generate-browser-package.mjs",
  "scripts/generate-ir-package.sh",
  "tools/GeneratePackage.lean",
  "wasm/upstream_shim/package/decl_provider.h",
  "wasm/upstream_shim/package/package_binary_reader.h",
  "wasm/upstream_shim/package/package_decl_provider_types.h",
  "wasm/upstream_shim/interpreter/interpreter_bridge.cpp",
  "wasm/upstream_shim/interpreter/interpreter_bridge.h",
  "wasm/upstream_shim/abi/call_abi.cpp",
  "wasm/upstream_shim/abi/closure_abi.cpp",
  "wasm/upstream_shim/package/host_import_trampolines.cpp",
  "wasm/upstream_shim/runtime/lean_object_constructors.cpp",
  "wasm/upstream_shim/runtime/name_utils.cpp",
  "wasm/upstream_shim/runtime/name_utils.h",
  "wasm/upstream_shim/runtime/native_symbols.cpp",
  "wasm/upstream_shim/runtime/native_symbol_lookup.cpp",
  "wasm/upstream_shim/runtime/native_symbols_registry.inc",
  "wasm/upstream_shim/abi/object_abi.cpp",
  "wasm/upstream_shim/abi/object_expr_abi.cpp",
  "wasm/upstream_shim/package/package_decl_provider.cpp",
  "wasm/upstream_shim/package/package_ir_decoder.cpp",
  "wasm/upstream_shim/runtime/runtime_environment_stubs.cpp",
  "wasm/upstream_shim/package/package_init_bridge.cpp",
  "wasm/upstream_shim/runtime/runtime_value_stubs.cpp",
  "wasm/upstream_shim/runtime/io_stubs.cpp",
  "wasm/upstream_shim/abi/resource_abi.cpp",
  "wasm/upstream_shim/abi/resource_abi.h",
];

export async function ensureCachedBenchArtifacts({
  root,
  artifactPaths,
  options,
  build,
}) {
  if (!options.artifactCacheEnabled) {
    build();
    return {
      enabled: false,
      restore: { status: "disabled" },
      store: { status: "disabled" },
    };
  }

  const rootPath = fileURLToPath(root);
  const cacheRoot = options.artifactCachePath ?? defaultArtifactCacheRoot(root);
  const payload = artifactCachePayload(root, rootPath, artifactPaths);
  const entry = artifactCacheEntry(cacheRoot, payload);
  let restore = {
    key: entry.key,
    path: entry.path,
    status: "refresh-skip",
  };
  if (!options.refreshArtifactCache) {
    restore = await restoreBenchArtifacts(rootPath, artifactPaths, entry);
  }
  console.log(`benchmark artifact cache ${restore.status}: ${entry.path}`);
  if (restore.status !== "hit") {
    build();
  }
  const store = restore.status === "hit"
    ? { key: entry.key, path: entry.path, status: "skipped-hit" }
    : await storeBenchArtifacts(rootPath, artifactPaths, entry, payload, options.refreshArtifactCache);
  if (store.status !== "skipped-hit") {
    console.log(`benchmark artifact cache ${store.status}: ${entry.path}`);
  }
  return {
    enabled: true,
    cacheRoot,
    payload,
    restore,
    store,
  };
}

function defaultArtifactCacheRoot(root) {
  const commonGitDir = runSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
    capture: true,
  });
  return join(dirname(commonGitDir), ".perf-artifacts", "vir-bench-cache");
}

function artifactCachePayload(root, rootPath, artifactPaths) {
  const git = gitMetadata(root);
  const status = runSync("git", ["status", "--short", "--untracked-files=all", "--", ...buildInputDiffPaths], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  const diff = runSync("git", ["diff", "--binary", "HEAD", "--", ...buildInputDiffPaths], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  return {
    version: artifactCacheVersion,
    commit: git.commit,
    dirty: git.dirty,
    dirtyStatus: status.length === 0 ? null : sha256Text(status),
    dirtyBuildInputDiff: diff.length === 0 ? null : sha256Text(diff),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lean: optionalCommandVersion(root, "lean", ["--version"]),
    leanToolchain: readFileSyncText(rootPath, "lean-toolchain").trim(),
    lean4Src: process.env.LEAN4_SRC ?? null,
    wasiSdkPath: process.env.WASI_SDK_PATH ?? null,
    wasiClang: process.env.WASI_SDK_PATH
      ? optionalCommandVersion(root, join(process.env.WASI_SDK_PATH, "bin", "clang++"), ["--version"])
      : optionalCommandVersion(root, "clang++", ["--version"]),
    sourceIdentity: Object.fromEntries(
      sourceIdentityPaths.map((path) => [path, fileDigest(rootPath, path)]),
    ),
    artifacts: artifactPaths,
  };
}

function gitMetadata(root) {
  return {
    commit: runSync("git", ["rev-parse", "HEAD"], { cwd: root, capture: true }),
    ref: runSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, capture: true }),
    dirty: runSync("git", ["status", "--short"], { cwd: root, capture: true }).length !== 0,
  };
}

function artifactCacheEntry(cacheRoot, payload) {
  const key = shortDigest(JSON.stringify(payload, null, 0));
  return {
    key,
    path: join(cacheRoot, payload.commit, key),
  };
}

async function restoreBenchArtifacts(rootPath, artifactPaths, entry) {
  for (const relPath of artifactPaths) {
    const source = join(entry.path, "artifacts", relPath);
    try {
      await copyFileWithDirs(source, join(rootPath, relPath));
    } catch {
      return {
        key: entry.key,
        path: entry.path,
        status: "miss",
      };
    }
  }
  return {
    key: entry.key,
    path: entry.path,
    status: "hit",
  };
}

async function storeBenchArtifacts(rootPath, artifactPaths, entry, payload, refresh) {
  if (!refresh) {
    const restored = await restoreBenchArtifacts(rootPath, artifactPaths, entry);
    if (restored.status === "hit") {
      return {
        key: entry.key,
        path: entry.path,
        status: "exists",
      };
    }
  }

  const parent = dirname(entry.path);
  await mkdir(parent, { recursive: true });
  const tmp = join(parent, `.${entry.key}.tmp-${process.pid}-${Date.now()}`);
  await rm(tmp, { recursive: true, force: true });
  try {
    for (const relPath of artifactPaths) {
      await copyFileWithDirs(join(rootPath, relPath), join(tmp, "artifacts", relPath));
    }
    const manifest = {
      version: artifactCacheVersion,
      createdAt: new Date().toISOString(),
      payload,
    };
    await writeFile(join(tmp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(entry.path, { recursive: true, force: true });
    await renamePath(tmp, entry.path);
    return {
      key: entry.key,
      path: entry.path,
      status: "stored",
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function renamePath(source, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await rename(source, dest);
}

function fileDigest(rootPath, relPath) {
  try {
    return createHash("sha256")
      .update(readFileSync(join(rootPath, relPath)))
      .digest("hex");
  } catch {
    return null;
  }
}

function readFileSyncText(rootPath, relPath) {
  return readFileSync(join(rootPath, relPath), "utf8");
}

function optionalCommandVersion(root, cmd, argv) {
  try {
    return runSync(cmd, argv, { cwd: root, capture: true });
  } catch {
    return null;
  }
}

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

function shortDigest(text) {
  return sha256Text(text).slice(0, 16);
}
