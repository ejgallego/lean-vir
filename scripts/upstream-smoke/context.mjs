/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import {
  defaultPackageFile,
  hostPackageFile,
  packageFileForFixtureSource,
  packageSpecs,
} from "../browser-package-config.mjs";

export async function createUpstreamSmokeContext() {
  const wasmBytes = await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url));
  const fixtureManifest = JSON.parse(await readFile(
    new URL("../../fixtures/manifest.json", import.meta.url),
    "utf8",
  ));
  const packageBytesByFile = new Map();
  for (const spec of packageSpecs) {
    packageBytesByFile.set(
      spec.file,
      await readFile(new URL(`../../web/public/${spec.file}`, import.meta.url)),
    );
  }

  const defaultPackageBytes = packageBytesByFile.get(defaultPackageFile);
  const hostPackageBytes = packageBytesByFile.get(hostPackageFile);
  if (!defaultPackageBytes) {
    throw new Error(`default package is missing from smoke inputs: ${defaultPackageFile}`);
  }
  if (!hostPackageBytes) {
    throw new Error(`host package is missing from smoke inputs: ${hostPackageFile}`);
  }

  return {
    wasmBytes,
    wasmModule: new WebAssembly.Module(wasmBytes),
    fixtureManifest,
    packageBytesByFile,
    defaultPackageBytes,
    hostPackageBytes,
  };
}

export function packageForFixture(context, fixture) {
  const packageFile = packageFileForFixtureSource(fixture.source);
  const packageBytes = context.packageBytesByFile.get(packageFile);
  if (!packageBytes) {
    throw new Error(`${fixture.id}: package ${packageFile} is not loaded`);
  }
  return packageBytes;
}
