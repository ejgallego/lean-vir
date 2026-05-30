#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactName = process.env.VIR_SDK_ARTIFACT_NAME ?? "lean-vir-sdk";
const artifactRoot = join(repoRoot, "build", "artifacts");
const sdkDir = join(artifactRoot, artifactName);
const archive = join(artifactRoot, `${artifactName}.tar.gz`);
const publicDownloads = join(repoRoot, "web", "public", "downloads");
const publicArchive = join(publicDownloads, `${artifactName}.tar.gz`);
const payloads = [
  ["wasm/vir-upstream.wasm", "web/public/vir-upstream.wasm"],
  ["js/vir-runtime.js", "web/src/vir-runtime.js"],
  ["js/vir-runtime-node.js", "web/src/vir-runtime-node.js"],
  ["js/vir-host-bindings.js", "web/src/vir-host-bindings.js"],
  ["js/interface-manifest.js", "web/src/interface-manifest.js"],
];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function copyFileWithDirs(source, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, await readFile(source));
}

await rm(sdkDir, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(sdkDir, { recursive: true });

const files = [];
for (const [destRel, sourceRel] of payloads) {
  const source = join(repoRoot, sourceRel);
  const dest = join(sdkDir, destRel);
  await copyFileWithDirs(source, dest);
  files.push({
    path: destRel,
    source: sourceRel,
    sha256: await sha256(dest),
  });
}

await copyFileWithDirs(join(repoRoot, "LICENSE"), join(sdkDir, "LICENSE"));
await copyFileWithDirs(join(repoRoot, "NOTICE"), join(sdkDir, "NOTICE"));

const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const leanToolchain = (await readFile(join(repoRoot, "lean-toolchain"), "utf8")).trim();
const gitCommit = run("git", ["rev-parse", "HEAD"]);
const gitStatus = run("git", ["status", "--short"]);
const leanVersion = run("lean", ["--version"]);
const artifact = {
  name: artifactName,
  version: packageJson.version,
  gitCommit,
  gitDirty: gitStatus.length !== 0,
  leanToolchain,
  leanVersion,
  packageFormatVersion: 5,
  manifestVersion: 1,
  runtimeAbiVersion: 1,
  generatedAt: new Date().toISOString(),
  files,
};
await writeFile(join(sdkDir, "lean-vir-artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
await writeFile(
  join(sdkDir, "README.txt"),
  `Lean VIR SDK
============

This SDK contains the JavaScript runtime modules and wasm32-wasip1 interpreter
for the matching lean_vir package revision.

Use the matching Lean package generator to create .irpkg files, then serve:

  wasm/vir-upstream.wasm
  js/*.js
  your generated .irpkg

Check lean-vir-artifact.json before mixing this SDK with generated packages
from another lean_vir revision.
`,
);

const tar = spawnSync("tar", ["-czf", archive, "-C", artifactRoot, artifactName], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (tar.status !== 0) {
  throw new Error(`tar failed with status ${tar.status}`);
}

await mkdir(publicDownloads, { recursive: true });
await copyFileWithDirs(archive, publicArchive);

console.log(`wrote ${join("build", "artifacts", basename(archive))}`);
console.log(`wrote ${join("web", "public", "downloads", basename(publicArchive))}`);
