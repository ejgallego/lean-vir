#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { copyFileWithDirs } from "../file-utils.mjs";
import { runSync } from "../process-utils.mjs";
import { repositoryRoot } from "../repository-paths.mjs";
import { parseLeanBuildIdentity } from "./lean-build-identity.mjs";
import { PACKAGE_VERSIONS } from "./package-versions.mjs";
import {
  SDK_METADATA_FILES,
  sdkFileRecord,
  sdkReadme,
} from "./sdk-metadata.mjs";
import { SDK_PAYLOADS } from "./sdk-payloads.mjs";

const usage = `usage: node scripts/packages/build-local-sdk.mjs
  --out DIR --cache DIR --expect-version VERSION --expect-commit SHA
  --lean-toolchain TOOLCHAIN --lean-version VERSION --lean-githash SHA`;

function parseArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined) {
      throw new Error(usage);
    }
    if (options.has(option)) throw new Error(`duplicate option: ${option}`);
    options.set(option, value);
  }
  const take = (option) => {
    const value = options.get(option);
    if (value === undefined || value.length === 0) {
      throw new Error(`missing ${option}\n\n${usage}`);
    }
    options.delete(option);
    return value;
  };
  const parsed = {
    out: resolve(take("--out")),
    cache: resolve(take("--cache")),
    expectVersion: take("--expect-version"),
    expectCommit: take("--expect-commit").toLowerCase(),
    leanToolchain: take("--lean-toolchain"),
    leanVersion: take("--lean-version"),
    leanGithash: take("--lean-githash").toLowerCase(),
  };
  if (options.size !== 0) {
    throw new Error(
      `unknown option: ${options.keys().next().value}\n\n${usage}`,
    );
  }
  return parsed;
}

function git(root, args, options = {}) {
  return runSync("git", ["-C", root, ...args], {
    capture: true,
    ...options,
  });
}

function safeCachePart(value, label) {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`${label} is not safe for a cache path: ${value}`);
  }
  return value;
}

async function isExecutable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function syncTrackedSource(source, destination) {
  const files = git(source, ["ls-files", "-z"], { trimStdout: false })
    .split("\0")
    .filter((path) => path.length !== 0);
  await mkdir(destination, { recursive: true });
  for (const path of files) {
    if (isAbsolute(path) || path.split("/").some((part) => part === "..")) {
      throw new Error(`unsafe tracked source path: ${path}`);
    }
    const sourcePath = join(source, path);
    const destinationPath = join(destination, path);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    const mode = (await stat(sourcePath)).mode & 0o777;
    await chmod(destinationPath, mode);
  }
}

function validateAutomaticLeanToolchain(toolchain) {
  const prefix = "leanprover/lean4:";
  if (!toolchain.startsWith(prefix) || toolchain.length === prefix.length) {
    throw new Error(
      `automatic Lean source acquisition requires ${prefix}<toolchain>, got ${toolchain}; ` +
        "set LEAN4_SRC to an exact Lean source checkout",
    );
  }
}

async function exactLeanSource(path, expectedCommit) {
  try {
    return git(path, ["rev-parse", "HEAD"]).toLowerCase() === expectedCommit;
  } catch {
    return false;
  }
}

export async function acquireLeanSource(
  cache,
  toolchain,
  expectedCommit,
  {
    configuredSource = process.env.LEAN4_SRC,
    repository = "https://github.com/leanprover/lean4.git",
  } = {},
) {
  if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) {
    throw new Error(`invalid exact Lean git hash: ${expectedCommit}`);
  }
  if (
    configuredSource !== undefined &&
    configuredSource !== null &&
    configuredSource.length !== 0
  ) {
    const source = resolve(configuredSource);
    if (!(await exactLeanSource(source, expectedCommit))) {
      throw new Error(
        `LEAN4_SRC must be the exact Lean checkout ${expectedCommit}: ${source}`,
      );
    }
    return source;
  }

  const source = join(
    cache,
    `lean4-${safeCachePart(expectedCommit, "Lean git hash")}`,
  );
  if (!(await exactLeanSource(source, expectedCommit))) {
    validateAutomaticLeanToolchain(toolchain);
    await mkdir(cache, { recursive: true });
    await rm(source, { recursive: true, force: true });
    runSync("git", ["init", "--quiet", source], { cwd: cache });
    git(source, ["remote", "add", "origin", repository]);
    git(source, ["fetch", "--depth", "1", "origin", expectedCommit], {
      capture: false,
    });
    git(source, ["checkout", "--quiet", "--detach", expectedCommit]);
  }
  if (!(await exactLeanSource(source, expectedCommit))) {
    const actual = git(source, ["rev-parse", "HEAD"]);
    throw new Error(
      `Lean source identity mismatch for ${toolchain}: expected ${expectedCommit}, got ${actual}`,
    );
  }
  return source;
}

async function resolveWasiSdk(source, buildSource) {
  const candidates = [
    process.env.WASI_SDK_PATH,
    join(source, ".tools", "wasi-sdk"),
    join(buildSource, ".tools", "wasi-sdk"),
  ].filter((path) => path !== undefined && path.length !== 0);
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (await isExecutable(join(path, "bin", "clang++"))) return path;
  }
  runSync("npm", ["run", "install:wasi"], { cwd: buildSource });
  const installed = join(buildSource, ".tools", "wasi-sdk");
  if (!(await isExecutable(join(installed, "bin", "clang++")))) {
    throw new Error(`VIR WASI SDK installation did not produce ${installed}`);
  }
  return installed;
}

async function buildLocalSdk(options) {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  if (packageJson.version !== options.expectVersion) {
    throw new Error(
      `resolved lean_vir version mismatch: expected ${options.expectVersion}, got ${packageJson.version}`,
    );
  }
  const actualCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (actualCommit !== options.expectCommit) {
    throw new Error(
      `resolved lean_vir commit mismatch: expected ${options.expectCommit}, got ${actualCommit}`,
    );
  }

  const leanVersionOutput = runSync("lean", ["--version"], {
    cwd: repositoryRoot,
    capture: true,
  });
  const leanIdentity = parseLeanBuildIdentity(leanVersionOutput);
  if (
    leanIdentity.leanVersionString !== options.leanVersion ||
    leanIdentity.leanGithash !== options.leanGithash
  ) {
    throw new Error(
      `current Lean identity mismatch: expected ${options.leanVersion}/${options.leanGithash}, ` +
        `got ${leanIdentity.leanVersionString}/${leanIdentity.leanGithash}`,
    );
  }

  const buildKey = `${safeCachePart(options.expectCommit, "VIR commit")}-${safeCachePart(options.leanGithash, "Lean git hash")}`;
  const buildRoot = join(options.cache, buildKey);
  const buildSource = join(buildRoot, "vir");
  await mkdir(buildRoot, { recursive: true });
  await syncTrackedSource(repositoryRoot, buildSource);
  const leanSource = await acquireLeanSource(
    buildRoot,
    options.leanToolchain,
    options.leanGithash,
  );
  const wasiSdk = await resolveWasiSdk(repositoryRoot, buildSource);

  runSync("npm", ["run", "probe:upstream"], {
    cwd: buildSource,
    env: {
      ...process.env,
      LEAN4_SRC: leanSource,
      VIR_SKIP_PACKAGES: "1",
      VIR_WASM_PROFILE: "release",
      WASI_SDK_PATH: wasiSdk,
    },
  });

  await rm(options.out, { recursive: true, force: true });
  await mkdir(options.out, { recursive: true });
  const files = [];
  for (const [destination, source] of SDK_PAYLOADS) {
    await copyFileWithDirs(
      join(buildSource, source),
      join(options.out, destination),
    );
    files.push(await sdkFileRecord(options.out, destination));
  }
  await copyFileWithDirs(
    join(repositoryRoot, "LICENSE"),
    join(options.out, "LICENSE"),
  );
  await copyFileWithDirs(
    join(repositoryRoot, "NOTICE"),
    join(options.out, "NOTICE"),
  );
  await writeFile(
    join(options.out, "README.txt"),
    sdkReadme({ localBuild: true }),
  );
  for (const path of SDK_METADATA_FILES) {
    files.push(await sdkFileRecord(options.out, path));
  }

  const gitDirty = git(repositoryRoot, ["status", "--short"]).length !== 0;
  const manifest = {
    name: "lean-vir-sdk",
    version: options.expectVersion,
    gitCommit: options.expectCommit,
    gitDirty,
    leanToolchain: options.leanToolchain,
    leanVersion: leanVersionOutput,
    leanVersionString: options.leanVersion,
    leanGithash: options.leanGithash,
    ...PACKAGE_VERSIONS,
    generatedAt: new Date().toISOString(),
    files,
  };
  await writeFile(
    join(options.out, "lean-vir-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `built local SDK for ${options.leanToolchain} from lean_vir@${options.expectCommit}`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await buildLocalSdk(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
