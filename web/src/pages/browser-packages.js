/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import browserPackages from "../../../fixtures/browser-packages.json";

import { deriveBrowserPackageConfig } from "./browser-package-config.js";

export const {
  packageSpecs,
  localPackagePresets,
  packageById,
  packageFiles,
  localPackageFiles,
  generatedPublicFiles,
  defaultPackageFile,
  hostPackageFile,
  packagePresets,
  packageLabels,
  packageFileByFixtureSource,
} = deriveBrowserPackageConfig(browserPackages);
