/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function deriveBrowserPackageConfig(browserPackageConfig) {
  const packageSpecs = browserPackageConfig.packages ?? [];
  const localPackagePresets = browserPackageConfig.localPackages ?? [];
  const packageById = new Map(packageSpecs.map((spec) => [spec.id, spec]));
  const packageFiles = packageSpecs.map((spec) => spec.file);
  const packagePresets = [
    ...packageSpecs.map((spec) => ({
      file: spec.file,
      label: spec.label ?? spec.id,
    })),
    ...localPackagePresets,
  ];
  const packageLabels = new Map(packagePresets.map((preset) => [preset.file, preset.label ?? preset.file]));
  const packageFileByFixtureSource = new Map();

  for (const spec of packageSpecs) {
    for (const source of spec.fixtureSources ?? []) {
      packageFileByFixtureSource.set(source, spec.file);
    }
  }

  const defaultPackageFile =
    packageById.get(browserPackageConfig.defaultPackage)?.file ?? "fixtures-basic.irpkg";
  const hostPackageFile =
    packageById.get(browserPackageConfig.hostPackage)?.file ?? "demo-host.irpkg";

  function packageFileForFixtureSource(source) {
    return packageFileByFixtureSource.get(source) ?? defaultPackageFile;
  }

  return {
    browserPackageConfig,
    packageSpecs,
    localPackagePresets,
    packageById,
    packageFiles,
    packagePresets,
    packageLabels,
    packageFileByFixtureSource,
    defaultPackageFile,
    hostPackageFile,
    packageFileForFixtureSource,
  };
}
