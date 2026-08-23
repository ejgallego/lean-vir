/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { copyFileWithDirs } from "../file-utils.mjs";
import { runSync } from "../process-utils.mjs";

export function artifactBundlePaths(repositoryRoot, artifactName) {
  if (
    typeof artifactName !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(artifactName)
  ) {
    throw new Error(
      `artifact name must be a safe file name, got ${JSON.stringify(artifactName)}`,
    );
  }
  const archiveName = `${artifactName}.tar.gz`;
  const artifactRoot = join(repositoryRoot, "build", "artifacts");
  const publicDownloads = join(repositoryRoot, "web", "public", "downloads");
  return {
    artifactName,
    artifactRoot,
    bundleDir: join(artifactRoot, artifactName),
    archive: join(artifactRoot, archiveName),
    publicDownloads,
    publicArchive: join(publicDownloads, archiveName),
  };
}

export async function cleanArtifactBundle(paths) {
  await rm(paths.bundleDir, { recursive: true, force: true });
  for (const path of [paths.archive, paths.publicArchive])
    await rm(path, { force: true });
  await mkdir(paths.bundleDir, { recursive: true });
}

export async function copyArtifactMetadata(repositoryRoot, bundleDir) {
  await copyFileWithDirs(
    join(repositoryRoot, "LICENSE"),
    join(bundleDir, "LICENSE"),
  );
  await copyFileWithDirs(
    join(repositoryRoot, "NOTICE"),
    join(bundleDir, "NOTICE"),
  );
}

export async function writeAndPublishArtifactArchive(repositoryRoot, paths) {
  runSync(
    "tar",
    ["-czf", paths.archive, "-C", paths.artifactRoot, paths.artifactName],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
  await mkdir(paths.publicDownloads, { recursive: true });
  await copyFileWithDirs(paths.archive, paths.publicArchive);
  console.log(`wrote ${join("build", "artifacts", basename(paths.archive))}`);
  console.log(
    `wrote ${join("web", "public", "downloads", basename(paths.publicArchive))}`,
  );
}

export async function removeUnexpectedGeneratedFiles(dir, keepFiles) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !isGeneratedPublicFile(entry.name) ||
      keepFiles.has(entry.name)
    )
      continue;
    await rm(join(dir, entry.name), { force: true });
  }
}

export function isGeneratedPublicFile(file) {
  return /\.(wasm|irpkg|input\.json|report\.md)$/.test(file);
}
