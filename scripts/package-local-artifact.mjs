#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { generatedPublicFiles } from "./browser-package-config.mjs";
import { copyFileWithDirs } from "./file-utils.mjs";
import { runSync } from "./process-utils.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactName = process.env.VIR_LOCAL_ARTIFACT_NAME ?? "lean-vir-local";
const archiveName = `${artifactName}.tar.gz`;
const localSite = join(repoRoot, "build", "local-site");
const artifactRoot = join(repoRoot, "build", "artifacts");
const bundleDir = join(artifactRoot, artifactName);
const archive = join(artifactRoot, archiveName);
const publicDownloads = join(repoRoot, "web", "public", "downloads");
const publicArchive = join(publicDownloads, archiveName);
const viteBin = await executablePath(process.env.VITE ?? join(repoRoot, "node_modules", ".bin", "vite"), "vite");
const generatedPublicFileSet = new Set(generatedPublicFiles);

await rm(localSite, { recursive: true, force: true });
await rm(bundleDir, { recursive: true, force: true });
await rm(archive, { force: true });
await rm(publicArchive, { force: true });
await mkdir(artifactRoot, { recursive: true });

runSync(viteBin, ["build", "--base", "./", "--outDir", "../build/local-site", "--emptyOutDir"], {
  cwd: repoRoot,
  stdio: "inherit",
});

await rm(join(localSite, "downloads"), { recursive: true, force: true });
await removeUnexpectedGeneratedFiles(localSite, generatedPublicFileSet);

await mkdir(bundleDir, { recursive: true });
await cp(localSite, bundleDir, { recursive: true });
await copyFileWithDirs(join(repoRoot, "LICENSE"), join(bundleDir, "LICENSE"));
await copyFileWithDirs(join(repoRoot, "NOTICE"), join(bundleDir, "NOTICE"));
await writeFile(join(bundleDir, "README.txt"), localBundleReadme());

runSync("tar", ["-czf", archive, "-C", artifactRoot, artifactName], {
  cwd: repoRoot,
  stdio: "inherit",
});

await mkdir(publicDownloads, { recursive: true });
await copyFileWithDirs(archive, publicArchive);

console.log(`wrote ${join("build", "artifacts", basename(archive))}`);
console.log(`wrote ${join("web", "public", "downloads", basename(publicArchive))}`);

async function executablePath(preferred, fallback) {
  try {
    await access(preferred, fsConstants.X_OK);
    return preferred;
  } catch {
    return fallback;
  }
}

async function removeUnexpectedGeneratedFiles(dir, keepFiles) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!isGeneratedPublicFile(entry.name)) continue;
    if (!keepFiles.has(entry.name)) {
      await rm(join(dir, entry.name), { force: true });
    }
  }
}

function isGeneratedPublicFile(file) {
  return file.endsWith(".wasm") ||
    file.endsWith(".irpkg") ||
    file.endsWith(".input.json") ||
    file.endsWith(".report.md");
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
