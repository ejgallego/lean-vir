/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function deriveBrowserPackageConfig(browserPackageConfig) {
  const wasmPublicFile = "vir-upstream.wasm";
  const wasmDevPublicFile = "vir-upstream.dev.wasm";
  const packageSpecs = browserPackageConfig.packages ?? [];
  const localPackagePresets = browserPackageConfig.localPackages ?? [];
  const packageFileById = new Map(packageSpecs.map((spec) => [spec.id, spec.file]));
  const packageFiles = packageSpecs.map((spec) => spec.file);
  const localPackageFiles = localPackagePresets.map((preset) => preset.file);
  const packagePresets = [
    ...packageSpecs.map((spec) => ({
      file: spec.file,
      label: spec.label ?? spec.id,
    })),
    ...localPackagePresets,
  ];
  const packageFileByFixtureSource = new Map();

  for (const spec of packageSpecs) {
    for (const source of spec.fixtureSources ?? []) {
      packageFileByFixtureSource.set(source, spec.file);
    }
  }

  const defaultPackageFile =
    packageFileById.get(browserPackageConfig.defaultPackage) ?? "fixtures-basic.irpkg";
  const hostPackageFile =
    packageFileById.get(browserPackageConfig.hostPackage) ?? "demo-host.irpkg";
  const prettyPackageFile = packageFileById.get("pretty-printer") ?? "pretty-printer.irpkg";
  const leanPackageFile = packageFileById.get("fixtures-lean") ?? "fixtures-lean.irpkg";
  const boundaryPackageFile = packageFileById.get("fixtures-boundary") ?? "fixtures-boundary.irpkg";
  const benchmarkPublicFiles = [wasmPublicFile, defaultPackageFile, hostPackageFile];
  const generatedPublicFiles = [
    wasmPublicFile,
    wasmDevPublicFile,
    ...packageFiles,
    ...localPackageFiles,
  ];

  function packageFileForFixtureSource(source) {
    return packageFileByFixtureSource.get(source) ?? defaultPackageFile;
  }

  function publicArtifactPath(file) {
    return `web/public/${file}`;
  }

  return {
    browserPackageConfig,
    wasmPublicFile,
    wasmDevPublicFile,
    packageSpecs,
    packageFiles,
    localPackageFiles,
    benchmarkArtifactPaths: benchmarkPublicFiles.map(publicArtifactPath),
    generatedPublicFiles,
    packagePresets,
    packageFileByFixtureSource,
    defaultPackageFile,
    hostPackageFile,
    prettyPackageFile,
    leanPackageFile,
    boundaryPackageFile,
    packageFileForFixtureSource,
    publicArtifactPath,
  };
}
