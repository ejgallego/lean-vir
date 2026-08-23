/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  artifactBundlePaths,
  isGeneratedPublicFile,
} from "../../scripts/packages/artifact-bundle.mjs";
import {
  repositoryPath,
  repositoryRoot,
} from "../../scripts/repository-paths.mjs";

test("repository paths are independent of a nested caller", () => {
  assert.equal(
    repositoryPath("fixtures", "manifest.json"),
    join(repositoryRoot, "fixtures", "manifest.json"),
  );
});

test("artifact bundle paths share one repository-owned layout", () => {
  assert.deepEqual(artifactBundlePaths("/repo", "lean-vir-sdk"), {
    artifactName: "lean-vir-sdk",
    artifactRoot: join("/repo", "build", "artifacts"),
    bundleDir: join("/repo", "build", "artifacts", "lean-vir-sdk"),
    archive: join("/repo", "build", "artifacts", "lean-vir-sdk.tar.gz"),
    publicDownloads: join("/repo", "web", "public", "downloads"),
    publicArchive: join(
      "/repo",
      "web",
      "public",
      "downloads",
      "lean-vir-sdk.tar.gz",
    ),
  });
});

test("generated public payload detection excludes maintained assets", () => {
  for (const file of [
    "runtime.wasm",
    "demo.irpkg",
    "demo.input.json",
    "demo.report.md",
  ]) {
    assert.equal(isGeneratedPublicFile(file), true, file);
  }
  for (const file of ["index.html", "app.js", "README.md", "wasm-notes.txt"]) {
    assert.equal(isGeneratedPublicFile(file), false, file);
  }
});
