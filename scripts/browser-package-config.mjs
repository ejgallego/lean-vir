/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

const configUrl = new URL("../fixtures/browser-packages.json", import.meta.url);

export const browserPackageConfig = JSON.parse(await readFile(configUrl, "utf8"));
export const packageSpecs = browserPackageConfig.packages ?? [];
export const localPackagePresets = browserPackageConfig.localPackages ?? [];
export const packageById = new Map(packageSpecs.map((spec) => [spec.id, spec]));
export const packageFiles = packageSpecs.map((spec) => spec.file);
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

export const defaultPackageFile =
  packageById.get(browserPackageConfig.defaultPackage)?.file ?? "fixtures-basic.irpkg";
export const hostPackageFile =
  packageById.get(browserPackageConfig.hostPackage)?.file ?? "demo-host.irpkg";

export function packageFileForFixtureSource(source) {
  return packageFileByFixtureSource.get(source) ?? defaultPackageFile;
}
