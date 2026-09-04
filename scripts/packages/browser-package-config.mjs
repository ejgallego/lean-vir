/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { deriveBrowserPackageConfig } from "../../web/app/pages/browser-package-config.js";

const configUrl = new URL("../../fixtures/browser-packages.json", import.meta.url);

const browserPackageConfig = JSON.parse(await readFile(configUrl, "utf8"));
export const {
  wasmPublicFile,
  wasmDevPublicFile,
  packageSpecs,
  packageFiles,
  localPackageFiles,
  benchmarkArtifactPaths,
  generatedPublicFiles,
  packagePresets,
  defaultPackageFile,
  hostPackageFile,
  prettyPackageFile,
  leanPackageFile,
  boundaryPackageFile,
  packageFileForFixtureSource,
  validateFixturePackageCoverage,
  publicArtifactPath,
} = deriveBrowserPackageConfig(browserPackageConfig);
