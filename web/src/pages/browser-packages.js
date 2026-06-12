/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import browserPackages from "../../../fixtures/browser-packages.json";

export const packageSpecs = browserPackages.packages ?? [];
export const localPackagePresets = browserPackages.localPackages ?? [];
export const packageById = new Map(packageSpecs.map((spec) => [spec.id, spec]));
export const defaultPackageFile = packageById.get(browserPackages.defaultPackage)?.file ?? "fixtures-basic.irpkg";
export const hostPackageFile = packageById.get(browserPackages.hostPackage)?.file ?? "demo-host.irpkg";

export const packagePresets = [
  ...packageSpecs.map((spec) => ({
    file: spec.file,
    label: spec.label ?? spec.id,
  })),
  ...localPackagePresets,
];

export const packageLabels = new Map(packagePresets.map((preset) => [preset.file, preset.label ?? preset.file]));

export const packageFileByFixtureSource = new Map();
for (const spec of packageSpecs) {
  for (const source of spec.fixtureSources ?? []) {
    packageFileByFixtureSource.set(source, spec.file);
  }
}
