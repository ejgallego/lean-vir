/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { resolve } from "node:path";

import { sha256 } from "./bench-utils.mjs";
import { runSync } from "../../scripts/process-utils.mjs";

// Keep this conservative and explicit: every shared local module loaded by an
// environment-lookup runner belongs to its comparison identity, even when a
// module is used only by setup or by a cold runtime path.
const environmentLookupSharedHarnessPaths = [
  "package.json",
  "fixtures/browser-packages.json",
  "benchmarks/harness/bench-differential.mjs",
  "benchmarks/harness/bench-env-lookup-contract.mjs",
  "benchmarks/harness/bench-utils.mjs",
  "scripts/packages/browser-package-config.mjs",
  "scripts/packages/irpkg-format.mjs",
  "scripts/packages/package-versions.mjs",
  "scripts/process-utils.mjs",
  "web/src/host-boundary.js",
  "web/src/host/vir-dom-host-bindings.js",
  "web/src/host/vir-active-host-bindings.js",
  "web/src/host/vir-infoview-host-bindings.js",
  "web/src/host/vir-js-collection-bindings.js",
  "web/src/host/vir-js-value-bindings.js",
  "web/app/pages/browser-package-config.js",
  "web/src/react/vir-react-root.js",
  "web/src/runtime/call-timing.js",
  "web/src/runtime/callbacks.js",
  "web/src/runtime/cleanup.js",
  "web/src/runtime/core.js",
  "web/src/runtime/host-state.js",
  "web/src/runtime/interface-effects.js",
  "web/src/runtime/interface-manifest.js",
  "web/src/runtime/interface-tags.js",
  "web/src/runtime/ir-package.js",
  "web/src/runtime/module-name.js",
  "web/src/runtime/object-abi-exports.js",
  "web/src/runtime/object-abi.js",
  "web/src/runtime/object-values.js",
  "web/src/runtime/package-targets.js",
  "web/src/runtime/vir-codec.js",
  "web/src/runtime/vir-value-normalizers.js",
  "web/src/vir-host-bindings.js",
  "web/src/vir-runtime.js",
];

export const environmentLookupHarnessPaths = Object.freeze(
  [
    ...environmentLookupSharedHarnessPaths,
    "benchmarks/harness/bench-artifact-cache.mjs",
    "benchmarks/harness/bench-env-lookup.mjs",
    "scripts/file-utils.mjs",
    "scripts/wasm-build-identity.mjs",
  ].sort(),
);

export const environmentLookupPairHarnessPaths = Object.freeze(
  [
    ...environmentLookupSharedHarnessPaths,
    "benchmarks/harness/bench-env-lookup-wasm-pair.mjs",
  ].sort(),
);

export function environmentLookupPackageIdentity(packageBytes, packageInfo) {
  const sections = packageInfo.package.sections
    .map((section) => {
      const bytes = packageBytes.subarray(
        section.offset,
        section.offset + section.byteLength,
      );
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
    ignoredManifestFields: [],
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
  const status = runSync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    {
      cwd: root,
      capture: true,
      trimStdout: false,
    },
  );
  const diff = runSync("git", ["diff", "--binary", "--full-index", "HEAD"], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  return {
    commit: runSync("git", ["rev-parse", "HEAD"], { cwd: root, capture: true }),
    ref: runSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      capture: true,
    }),
    dirty: status.length !== 0,
    statusSha256: status.length === 0 ? null : sha256(Buffer.from(status)),
    trackedDiffSha256: diff.length === 0 ? null : sha256(Buffer.from(diff)),
  };
}

export function validateEnvironmentLookupOutputPaths(
  { jsonPath, cpuProfilePath },
  cwd = process.cwd(),
) {
  if (jsonPath === null || cpuProfilePath === null) return;
  if (resolve(cwd, jsonPath) === resolve(cwd, cpuProfilePath)) {
    throw new Error("--json and --cpu-profile require distinct output paths");
  }
}
