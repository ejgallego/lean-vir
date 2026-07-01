#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  artifactBundlePaths,
  cleanArtifactBundle,
  copyFileWithDirs,
  copyArtifactMetadata,
  writeAndPublishArtifactArchive,
} from "./file-utils.mjs";
import { runSync } from "./process-utils.mjs";
import { PACKAGE_VERSIONS } from "./package-versions.mjs";
import { SDK_PAYLOADS } from "./sdk-payloads.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactName = process.env.VIR_SDK_ARTIFACT_NAME ?? "lean-vir-sdk";
const artifactPaths = artifactBundlePaths(repoRoot, artifactName);

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

await cleanArtifactBundle(artifactPaths);

const files = [];
for (const [destRel, sourceRel] of SDK_PAYLOADS) {
  const source = join(repoRoot, sourceRel);
  const dest = join(artifactPaths.bundleDir, destRel);
  await copyFileWithDirs(source, dest);
  files.push({
    path: destRel,
    source: sourceRel,
    sha256: await sha256(dest),
  });
}

await copyArtifactMetadata(repoRoot, artifactPaths.bundleDir);

const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
const leanToolchain = (await readFile(join(repoRoot, "lean-toolchain"), "utf8")).trim();
const gitCommit = runSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, capture: true });
const gitStatus = runSync("git", ["status", "--short"], { cwd: repoRoot, capture: true });
const leanVersion = runSync("lean", ["--version"], { cwd: repoRoot, capture: true });
const artifactManifest = {
  name: artifactName,
  version: packageJson.version,
  gitCommit,
  gitDirty: gitStatus.length !== 0,
  leanToolchain,
  leanVersion,
  ...PACKAGE_VERSIONS,
  generatedAt: new Date().toISOString(),
  files,
};
await writeFile(join(artifactPaths.bundleDir, "lean-vir-artifact.json"), `${JSON.stringify(artifactManifest, null, 2)}\n`);
await writeFile(
  join(artifactPaths.bundleDir, "README.txt"),
  `Lean VIR SDK
============

This SDK contains the JavaScript runtime modules and wasm32-wasip1 interpreter
for the matching lean_vir package revision.

The JavaScript files are ES modules. The generic runtime and host-binding
modules do not import React; js/vir-react-host-bindings.js imports react and
react-dom/client and should only be used by browser React integrations.

Use the matching Lean package generator to create .irpkg files, then serve:

  wasm/vir-upstream.wasm
  wasm/vir-upstream.dev.wasm
  js/vir-runtime.js
  your generated .irpkg

wasm/vir-upstream.wasm is the stripped release artifact and is selected by
default. wasm/vir-upstream.dev.wasm is an optimized, unstripped debugging
companion.

Minimal browser usage:

  import { createVirRuntime } from "./js/vir-runtime.js";

  const vir = await createVirRuntime({
    wasmUrl: "./wasm/vir-upstream.wasm",
    irPackageUrl: "./my-app.irpkg",
  });

Set debugWasm: true to load ./wasm/vir-upstream.dev.wasm instead:

  const debugVir = await createVirRuntime({
    wasmUrl: "./wasm/vir-upstream.wasm",
    debugWasm: true,
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

await writeAndPublishArtifactArchive(repoRoot, artifactPaths);
