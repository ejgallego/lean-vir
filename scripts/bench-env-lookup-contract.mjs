/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { resolve } from "node:path";

import { sha256 } from "./bench-utils.mjs";
import { IR_PACKAGE_SECTION } from "./irpkg-format.mjs";
import { runSync } from "./process-utils.mjs";

// Keep this conservative and explicit: every shared local module loaded by an
// environment-lookup runner belongs to its comparison identity, even when a
// module is used only by setup or by a cold runtime path.
const environmentLookupSharedHarnessPaths = [
  "package.json",
  "fixtures/browser-packages.json",
  "scripts/bench-differential.mjs",
  "scripts/bench-env-lookup-contract.mjs",
  "scripts/bench-utils.mjs",
  "scripts/browser-package-config.mjs",
  "scripts/irpkg-format.mjs",
  "scripts/package-versions.mjs",
  "scripts/process-utils.mjs",
  "web/src/host-resource.js",
  "web/src/host/vir-host-resources.js",
  "web/src/host/vir-js-collection-bindings.js",
  "web/src/host/vir-js-value-bindings.js",
  "web/src/host/vir-virtual-host-bindings.js",
  "web/src/pages/browser-package-config.js",
  "web/src/react/vir-react-hooks.js",
  "web/src/react/vir-react-node.js",
  "web/src/runtime/call-timing.js",
  "web/src/runtime/callbacks.js",
  "web/src/runtime/cleanup.js",
  "web/src/runtime/core.js",
  "web/src/runtime/host-state.js",
  "web/src/runtime/interface-effects.js",
  "web/src/runtime/interface-manifest.js",
  "web/src/runtime/interface-tags.js",
  "web/src/runtime/object-abi-exports.js",
  "web/src/runtime/object-abi.js",
  "web/src/runtime/object-values.js",
  "web/src/runtime/vir-codec.js",
  "web/src/runtime/vir-value-normalizers.js",
  "web/src/vir-host-bindings.js",
  "web/src/vir-runtime.js",
];

export const environmentLookupHarnessPaths = Object.freeze([
  ...environmentLookupSharedHarnessPaths,
  "scripts/bench-artifact-cache.mjs",
  "scripts/bench-env-lookup.mjs",
  "scripts/file-utils.mjs",
  "scripts/wasm-build-identity.mjs",
].sort());

export const environmentLookupPairHarnessPaths = Object.freeze([
  ...environmentLookupSharedHarnessPaths,
  "scripts/bench-env-lookup-wasm-pair.mjs",
].sort());

export { sha256 };

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

export function environmentLookupGitIdentity(root) {
  const status = runSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  const diff = runSync("git", ["diff", "--binary", "--full-index", "HEAD"], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  return {
    commit: runSync("git", ["rev-parse", "HEAD"], { cwd: root, capture: true }),
    ref: runSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, capture: true }),
    dirty: status.length !== 0,
    statusSha256: status.length === 0 ? null : sha256(Buffer.from(status)),
    trackedDiffSha256: diff.length === 0 ? null : sha256(Buffer.from(diff)),
  };
}

export function validateEnvironmentLookupOutputPaths(
    { jsonPath, cpuProfilePath }, cwd = process.cwd()) {
  if (jsonPath === null || cpuProfilePath === null) return;
  if (resolve(cwd, jsonPath) === resolve(cwd, cpuProfilePath)) {
    throw new Error("--json and --cpu-profile require distinct output paths");
  }
}
