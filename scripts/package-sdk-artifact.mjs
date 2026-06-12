#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { runSync } from "./process-utils.mjs";
import { SDK_PAYLOADS } from "./sdk-payloads.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactName = process.env.VIR_SDK_ARTIFACT_NAME ?? "lean-vir-sdk";
const artifactRoot = join(repoRoot, "build", "artifacts");
const sdkDir = join(artifactRoot, artifactName);
const archive = join(artifactRoot, `${artifactName}.tar.gz`);
const publicDownloads = join(repoRoot, "web", "public", "downloads");
const publicArchive = join(publicDownloads, `${artifactName}.tar.gz`);

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
for (const [destRel, sourceRel] of SDK_PAYLOADS) {
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
const gitCommit = runSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, capture: true });
const gitStatus = runSync("git", ["status", "--short"], { cwd: repoRoot, capture: true });
const leanVersion = runSync("lean", ["--version"], { cwd: repoRoot, capture: true });
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

The JavaScript files are ES modules. The generic runtime and host-binding
modules do not import React; js/vir-react-host-bindings.js imports react and
react-dom/client and should only be used by browser React integrations.

Use the matching Lean package generator to create .irpkg files, then serve:

  wasm/vir-upstream.wasm
  js/vir-runtime.js
  your generated .irpkg

Minimal browser usage:

  import { createVirRuntime } from "./js/vir-runtime.js";

  const vir = await createVirRuntime({
    wasmUrl: "./wasm/vir-upstream.wasm",
    irPackageUrl: "./my-app.irpkg",
  });

Browser React root usage:

  import { createVirRuntimeFactory } from "./js/vir-runtime.js";
  import {
    createBrowserHostBindings,
    createHostResourceState,
  } from "./js/vir-host-bindings.js";
  import { createBrowserReactHostBindings } from "./js/vir-react-host-bindings.js";

  const factory = createVirRuntimeFactory({
    wasmUrl: "./wasm/vir-upstream.wasm",
    defaultHostBindings: () => {
      const resources = createHostResourceState();
      return createBrowserHostBindings({
        resources,
        reactHostBindings: createBrowserReactHostBindings(resources),
      });
    },
  });

Check lean-vir-artifact.json before mixing this SDK with generated packages
from another lean_vir revision.
`,
);

runSync("tar", ["-czf", archive, "-C", artifactRoot, artifactName], {
  cwd: repoRoot,
  stdio: "inherit",
});

await mkdir(publicDownloads, { recursive: true });
await copyFileWithDirs(archive, publicArchive);

console.log(`wrote ${join("build", "artifacts", basename(archive))}`);
console.log(`wrote ${join("web", "public", "downloads", basename(publicArchive))}`);
