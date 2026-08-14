/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runSync } from "./process-utils.mjs";

function nonempty(value) {
  return typeof value === "string" && value.length !== 0 ? value : null;
}

function rootPathFor(root) {
  return resolve(root instanceof URL ? fileURLToPath(root) : root);
}

function absolutePath(rootPath, path) {
  return isAbsolute(path) ? path : resolve(rootPath, path);
}

function isExecutable(path) {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(rootPath, command, pathValue) {
  if (command.includes("/") || command.includes("\\")) {
    const path = absolutePath(rootPath, command);
    return isExecutable(path) ? path : null;
  }
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue;
    const path = join(directory, command);
    if (isExecutable(path)) return path;
  }
  return null;
}

function requireExecutable(rootPath, command, pathValue, description) {
  const path = resolveExecutable(rootPath, command, pathValue);
  if (path === null) {
    throw new Error(`${description} not found: ${command}`);
  }
  return path;
}

function outputProfile(profile) {
  if (profile === "dev") return "dev";
  if (["dist", "production", "release"].includes(profile)) return "release";
  throw new Error(
    `unsupported VIR_WASM_PROFILE '${profile}'; expected dev, dist, release, or production`,
  );
}

/**
 * Resolve the tools and source checkout exactly as build-upstream-probe.sh does.
 * Paths used to invoke tools are absolute; leanSourceInputPath preserves the
 * caller's path so generated build output remains readable.
 */
export function resolveEffectiveWasmBuildTools(root, env = process.env) {
  const rootPath = rootPathFor(root);
  const sourceInput = nonempty(env.LEAN4_SRC) ?? "third_party/lean4-src";
  const localWasiSdkPath = join(rootPath, ".tools", "wasi-sdk");
  const configuredWasiSdkPath = nonempty(env.WASI_SDK_PATH);
  let wasiSdkPath = null;
  if (configuredWasiSdkPath !== null) {
    const configuredPath = absolutePath(rootPath, configuredWasiSdkPath);
    if (isExecutable(join(configuredPath, "bin", "clang++"))) {
      wasiSdkPath = configuredPath;
    }
  } else if (isExecutable(join(localWasiSdkPath, "bin", "clang++"))) {
    wasiSdkPath = localWasiSdkPath;
  }

  const inheritedPath = env.PATH ?? "";
  const effectivePath = wasiSdkPath === null
    ? inheritedPath
    : `${join(wasiSdkPath, "bin")}${delimiter}${inheritedPath}`;
  const configuredCompiler = nonempty(env.CXX);
  const compilerCommand = wasiSdkPath === null
    ? configuredCompiler
    : configuredCompiler ?? join(wasiSdkPath, "bin", "clang++");
  if (compilerCommand === null) {
    throw new Error("clang++ not found; run npm run install:wasi or set WASI_SDK_PATH or CXX");
  }

  const compiler = requireExecutable(rootPath, compilerCommand, effectivePath, "C++ compiler");
  const wasmLd = requireExecutable(
    rootPath,
    nonempty(env.WASM_LD) ?? "wasm-ld",
    effectivePath,
    "wasm-ld",
  );
  const llvmNm = requireExecutable(
    rootPath,
    nonempty(env.LLVM_NM) ?? "llvm-nm",
    effectivePath,
    "llvm-nm",
  );
  const lean = requireExecutable(rootPath, "lean", effectivePath, "lean");
  const leanPrefix = nonempty(env.LEAN_PREFIX) ?? runSync(lean, ["--print-prefix"], {
    cwd: rootPath,
    capture: true,
    env: { ...process.env, ...env, PATH: effectivePath },
  });

  let llvmObjcopy = null;
  if (outputProfile(nonempty(env.VIR_WASM_PROFILE) ?? "dev") === "release") {
    llvmObjcopy = resolveExecutable(rootPath, "llvm-objcopy", effectivePath);
    if (llvmObjcopy === null && isExecutable(join(localWasiSdkPath, "bin", "llvm-objcopy"))) {
      llvmObjcopy = join(localWasiSdkPath, "bin", "llvm-objcopy");
    }
    if (llvmObjcopy === null) {
      throw new Error(`llvm-objcopy is required for VIR_WASM_PROFILE=${env.VIR_WASM_PROFILE}`);
    }
  }

  return {
    rootPath,
    effectivePath,
    leanSourceInputPath: sourceInput,
    leanSourcePath: absolutePath(rootPath, sourceInput),
    wasiSdkPath,
    compiler,
    wasmLd,
    llvmNm,
    llvmObjcopy,
    lean,
    leanPrefix: absolutePath(rootPath, leanPrefix),
  };
}

function portablePath(rootPath, path) {
  if (path === null) return null;
  const relPath = relative(rootPath, path);
  if (relPath === "") return ".";
  if (!relPath.startsWith(`..${sep}`) && relPath !== ".." && !isAbsolute(relPath)) {
    return relPath.split(sep).join("/");
  }
  return path;
}

function optionalRunSync(command, args, options) {
  try {
    return runSync(command, args, options);
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileDigest(path) {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

function leanSourceIdentity(rootPath, sourcePath) {
  const gitOptions = { cwd: sourcePath, capture: true };
  const commit = optionalRunSync("git", ["rev-parse", "HEAD"], gitOptions);
  if (commit === null) {
    return {
      path: portablePath(rootPath, sourcePath),
      commit: null,
      dirty: null,
      dirtyStatusSha256: null,
      dirtyDiffSha256: null,
      untrackedFiles: null,
    };
  }

  const status = runSync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { ...gitOptions, trimStdout: false },
  );
  const diff = runSync(
    "git",
    ["diff", "--binary", "HEAD"],
    { ...gitOptions, trimStdout: false },
  );
  const untracked = runSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { ...gitOptions, trimStdout: false },
  ).split("\0").filter((path) => path.length !== 0);
  return {
    path: portablePath(rootPath, sourcePath),
    commit,
    dirty: status.length !== 0,
    dirtyStatusSha256: status.length === 0 ? null : sha256(status),
    dirtyDiffSha256: diff.length === 0 ? null : sha256(diff),
    untrackedFiles: Object.fromEntries(
      untracked.map((path) => [path, fileDigest(join(sourcePath, path))]),
    ),
  };
}

function toolIdentity(rootPath, path, argv = ["--version"], env = process.env) {
  if (path === null) return null;
  const version = runSync(path, argv, { cwd: rootPath, capture: true, env });
  return {
    path: portablePath(rootPath, path),
    version: version.split(rootPath).join("<repo>"),
  };
}

export function effectiveWasmBuildIdentity(root, env = process.env) {
  const tools = resolveEffectiveWasmBuildTools(root, env);
  const toolEnv = { ...process.env, ...env, PATH: tools.effectivePath };
  return {
    ...wasmBuildConfiguration(env),
    wasiSdkPath: portablePath(tools.rootPath, tools.wasiSdkPath),
    compiler: toolIdentity(tools.rootPath, tools.compiler, ["--version"], toolEnv),
    linker: toolIdentity(tools.rootPath, tools.wasmLd, ["--version"], toolEnv),
    symbolInspector: toolIdentity(tools.rootPath, tools.llvmNm, ["--version"], toolEnv),
    objectStripper: toolIdentity(tools.rootPath, tools.llvmObjcopy, ["--version"], toolEnv),
    lean: {
      ...toolIdentity(tools.rootPath, tools.lean, ["--version"], toolEnv),
      prefix: portablePath(tools.rootPath, tools.leanPrefix),
    },
    leanSource: leanSourceIdentity(tools.rootPath, tools.leanSourcePath),
  };
}

export function wasmBuildConfiguration(env = process.env) {
  return {
    profile: nonempty(env.VIR_WASM_PROFILE) ?? "dev",
    optimization: nonempty(env.VIR_WASM_OPT_LEVEL) ?? "-O3",
    target: nonempty(env.WASI_TARGET) ?? "wasm32-wasip1",
    initialMemory: nonempty(env.VIR_WASM_INITIAL_MEMORY) ?? "4194304",
    stackSize: nonempty(env.VIR_WASM_STACK_SIZE) ?? "1048576",
  };
}

function printResolvedTools(root) {
  const tools = resolveEffectiveWasmBuildTools(root);
  const fields = [
    tools.leanSourceInputPath,
    tools.wasiSdkPath ?? "",
    tools.compiler,
    tools.wasmLd,
    tools.llvmNm,
    tools.leanPrefix,
    tools.llvmObjcopy ?? "",
  ];
  process.stdout.write(`${fields.join("\0")}\0`);
}

function isMainModule() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    if (process.argv[2] === "--print-tools0") {
      printResolvedTools(process.cwd());
    } else if (process.argv[2] === "--print-identity") {
      process.stdout.write(`${JSON.stringify(effectiveWasmBuildIdentity(process.cwd()))}\n`);
    } else {
      throw new Error("usage: node scripts/wasm-build-identity.mjs --print-tools0|--print-identity");
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
