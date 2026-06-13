/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";

import { runSync } from "./process-utils.mjs";

const chromiumExecutablePaths = [
  "/snap/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const chromiumExecutableNames = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];

export async function copyFileWithDirs(source, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(source, dest);
}

export async function pathExists(path, mode = fsConstants.R_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function isPathLikeExecutableName(name) {
  return name.includes("/") || name.includes("\\");
}

async function isExecutable(path) {
  return pathExists(path, fsConstants.X_OK);
}

async function findExecutableInPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = resolve(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export async function preferredExecutablePath(preferred, fallback) {
  return (await isExecutable(preferred)) ? preferred : fallback;
}

export async function findChromiumExecutable(configured = process.env.CHROMIUM) {
  if (configured) {
    if (isPathLikeExecutableName(configured)) {
      return (await isExecutable(configured)) ? configured : null;
    }
    return findExecutableInPath(configured);
  }
  for (const candidate of chromiumExecutablePaths) {
    if (await isExecutable(candidate)) return candidate;
  }
  for (const name of chromiumExecutableNames) {
    const found = await findExecutableInPath(name);
    if (found) return found;
  }
  return null;
}

export async function requireChromiumExecutable(configured = process.env.CHROMIUM) {
  const executable = await findChromiumExecutable(configured);
  if (executable) return executable;
  if (configured) {
    throw new Error(
      isPathLikeExecutableName(configured)
        ? `CHROMIUM is set to ${configured}, but that file is not executable`
        : `CHROMIUM is set to ${configured}, but it was not found on PATH`,
    );
  }
  throw new Error(
    `Chromium executable not found. Set CHROMIUM=/path/to/chromium before running npm run test:pages:browser`,
  );
}

export function artifactBundlePaths(repoRoot, artifactName) {
  const archiveName = `${artifactName}.tar.gz`;
  const artifactRoot = join(repoRoot, "build", "artifacts");
  const publicDownloads = join(repoRoot, "web", "public", "downloads");
  return { artifactName, artifactRoot, bundleDir: join(artifactRoot, artifactName),
    archive: join(artifactRoot, archiveName), publicDownloads, publicArchive: join(publicDownloads, archiveName) };
}

export async function cleanArtifactBundle(paths) {
  await rm(paths.bundleDir, { recursive: true, force: true });
  for (const path of [paths.archive, paths.publicArchive]) await rm(path, { force: true });
  await mkdir(paths.bundleDir, { recursive: true });
}

export async function copyArtifactMetadata(repoRoot, bundleDir) {
  await copyFileWithDirs(join(repoRoot, "LICENSE"), join(bundleDir, "LICENSE"));
  await copyFileWithDirs(join(repoRoot, "NOTICE"), join(bundleDir, "NOTICE"));
}

export async function writeAndPublishArtifactArchive(repoRoot, paths) {
  runSync("tar", ["-czf", paths.archive, "-C", paths.artifactRoot, paths.artifactName], { cwd: repoRoot, stdio: "inherit" });
  await mkdir(paths.publicDownloads, { recursive: true });
  await copyFileWithDirs(paths.archive, paths.publicArchive);
  console.log(`wrote ${join("build", "artifacts", basename(paths.archive))}`);
  console.log(`wrote ${join("web", "public", "downloads", basename(paths.publicArchive))}`);
}

export async function removeUnexpectedGeneratedFiles(dir, keepFiles) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !isGeneratedPublicFile(entry.name) || keepFiles.has(entry.name)) continue;
    await rm(join(dir, entry.name), { force: true });
  }
}

export function isGeneratedPublicFile(file) {
  return /\.(wasm|irpkg|input\.json|report\.md)$/.test(file);
}
