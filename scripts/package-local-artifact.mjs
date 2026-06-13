#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { constants as fsConstants } from "node:fs";
import { access, cp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  artifactBundlePaths,
  cleanArtifactBundle,
  copyArtifactMetadata,
  removeUnexpectedGeneratedFiles,
  writeAndPublishArtifactArchive,
} from "./file-utils.mjs";
import { generatedPublicFiles } from "./browser-package-config.mjs";
import { runSync } from "./process-utils.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactName = process.env.VIR_LOCAL_ARTIFACT_NAME ?? "lean-vir-local";
const artifactPaths = artifactBundlePaths(repoRoot, artifactName);
const localSite = join(repoRoot, "build", "local-site");
const viteBin = await executablePath(process.env.VITE ?? join(repoRoot, "node_modules", ".bin", "vite"), "vite");
const generatedPublicFileSet = new Set(generatedPublicFiles);

await rm(localSite, { recursive: true, force: true });
await cleanArtifactBundle(artifactPaths);

runSync(viteBin, ["build", "--base", "./", "--outDir", "../build/local-site", "--emptyOutDir"], {
  cwd: repoRoot,
  stdio: "inherit",
});

await rm(join(localSite, "downloads"), { recursive: true, force: true });
await removeUnexpectedGeneratedFiles(localSite, generatedPublicFileSet);

await cp(localSite, artifactPaths.bundleDir, { recursive: true });
await copyArtifactMetadata(repoRoot, artifactPaths.bundleDir);
await writeFile(join(artifactPaths.bundleDir, "README.txt"), localBundleReadme());

await writeAndPublishArtifactArchive(repoRoot, artifactPaths);

async function executablePath(preferred, fallback) {
  try {
    await access(preferred, fsConstants.X_OK);
    return preferred;
  } catch {
    return fallback;
  }
}

function localBundleReadme() {
  return `Lean VIR local bundle
=====================

This directory contains a static build of the Lean VIR browser demo, the
compiled wasm32-wasip1 IR interpreter, and the bundled demo .irpkg files.

Serve this directory from a local HTTP server, then open the printed URL:

  python3 -m http.server 8000
  http://127.0.0.1:8000/

Opening index.html directly from the filesystem is not supported by all
browsers because the runtime fetches WebAssembly modules and package files.

Useful entry points:

  index.html              Main demo and fixture browser
  dev.html                Package runner
  react.html              Lean-authored React examples
  format.html             Format.pretty workbench
  runtime-example.html    Minimal JavaScript runtime example
`;
}
