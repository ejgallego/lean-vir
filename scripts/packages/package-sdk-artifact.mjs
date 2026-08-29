#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  artifactBundlePaths,
  cleanArtifactBundle,
  copyArtifactMetadata,
  writeAndPublishArtifactArchive,
} from "./artifact-bundle.mjs";
import { copyFileWithDirs } from "../file-utils.mjs";
import { repositoryRoot } from "../repository-paths.mjs";
import { runSync } from "../process-utils.mjs";
import { parseLeanBuildIdentity } from "./lean-build-identity.mjs";
import { PACKAGE_VERSIONS } from "./package-versions.mjs";
import {
  SDK_METADATA_FILES,
  sdkFileRecord,
  sdkReadme,
} from "./sdk-metadata.mjs";
import {
  SDK_BROWSER_PROFILE,
  SDK_PAYLOADS,
  sdkBrowserFiles,
} from "./sdk-payloads.mjs";

const artifactName = process.env.VIR_SDK_ARTIFACT_NAME ?? "lean-vir-sdk";
const artifactPaths = artifactBundlePaths(repositoryRoot, artifactName);

await cleanArtifactBundle(artifactPaths);

const files = [];
for (const [destRel, sourceRel] of SDK_PAYLOADS) {
  const source = join(repositoryRoot, sourceRel);
  const dest = join(artifactPaths.bundleDir, destRel);
  await copyFileWithDirs(source, dest);
  files.push(
    await sdkFileRecord(artifactPaths.bundleDir, destRel, {
      source: sourceRel,
    }),
  );
}

await copyArtifactMetadata(repositoryRoot, artifactPaths.bundleDir);
await writeFile(join(artifactPaths.bundleDir, "README.txt"), sdkReadme());
for (const path of SDK_METADATA_FILES) {
  files.push(await sdkFileRecord(artifactPaths.bundleDir, path));
}

const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
const leanToolchain = (
  await readFile(join(repositoryRoot, "lean-toolchain"), "utf8")
).trim();
const gitCommit = runSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  capture: true,
});
const gitStatus = runSync("git", ["status", "--short"], {
  cwd: repositoryRoot,
  capture: true,
});
const leanVersion = runSync("lean", ["--version"], {
  cwd: repositoryRoot,
  capture: true,
});
const leanBuildIdentity = parseLeanBuildIdentity(leanVersion);
const browser = {
  ...SDK_BROWSER_PROFILE,
  files: await sdkBrowserFiles(artifactPaths.bundleDir),
};
const artifactManifest = {
  name: artifactName,
  version: packageJson.version,
  gitCommit,
  gitDirty: gitStatus.length !== 0,
  leanToolchain,
  leanVersion,
  ...leanBuildIdentity,
  ...PACKAGE_VERSIONS,
  browser,
  generatedAt: new Date().toISOString(),
  files,
};
await writeFile(
  join(artifactPaths.bundleDir, "lean-vir-artifact.json"),
  `${JSON.stringify(artifactManifest, null, 2)}\n`,
);
await writeAndPublishArtifactArchive(repositoryRoot, artifactPaths);
