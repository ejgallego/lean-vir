/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { IR_PACKAGE_SECTION } from "./irpkg-format.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function environmentLookupPackageIdentity(packageBytes, packageInfo) {
  const { generatedAt: _generatedAt, ...stableMetadata } = packageInfo.manifest.metadata ?? {};
  const stableManifest = {
    ...packageInfo.manifest,
    metadata: stableMetadata,
  };
  const sections = packageInfo.package.sections
    .map((section) => {
      const bytes = section.kind === IR_PACKAGE_SECTION.INTERFACE_MANIFEST
        ? Buffer.from(JSON.stringify(stableManifest))
        : packageBytes.subarray(section.offset, section.offset + section.byteLength);
      return {
        kind: section.kind,
        name: section.name,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    })
    .sort((left, right) => left.kind - right.kind);
  const content = {
    packageFormatVersion: packageInfo.package.version,
    declarationCount: packageInfo.package.declarationCount,
    sections,
  };
  return {
    ...content,
    contentSha256: sha256(Buffer.from(JSON.stringify(content))),
    ignoredManifestFields: ["metadata.generatedAt"],
  };
}

export function environmentLookupHarnessIdentity(files) {
  const sources = files
    .map(({ path, bytes }) => ({ path, sha256: sha256(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    sources,
    sha256: sha256(Buffer.from(JSON.stringify(sources))),
  };
}

export function validateEnvironmentLookupOutputPaths(
    { jsonPath, cpuProfilePath }, cwd = process.cwd()) {
  if (jsonPath === null || cpuProfilePath === null) return;
  if (resolve(cwd, jsonPath) === resolve(cwd, cpuProfilePath)) {
    throw new Error("--json and --cpu-profile require distinct output paths");
  }
}
