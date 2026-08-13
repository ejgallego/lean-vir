/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  environmentLookupHarnessPaths,
  environmentLookupPairHarnessPaths,
  environmentLookupHarnessIdentity,
  environmentLookupPackageIdentity,
  validateEnvironmentLookupOutputPaths,
} from "./bench-env-lookup-contract.mjs";
import { assertComparableBenchmarkReportIdentities } from "./bench-utils.mjs";
import { INTERFACE_MANIFEST_VERSION } from "./package-versions.mjs";

test("environment lookup identity covers package content but ignores generation time", () => {
  const packageInfo = (generatedAt) => ({
    package: {
      version: 10,
      declarationCount: 1,
      sections: [
        { kind: 1, name: "declarations", offset: 0, byteLength: 4 },
        { kind: 5, name: "interfaceManifest", offset: 4, byteLength: 8 },
      ],
    },
    manifest: {
      version: INTERFACE_MANIFEST_VERSION,
      artifact: "lean-vir-ir-package",
      metadata: { generatedAt, generator: "test" },
      exports: [],
      hostImports: [],
      diagnostics: [],
    },
  });
  const identity = environmentLookupPackageIdentity(
    Buffer.from("declmanifest"),
    packageInfo("2026-08-05T10:00:00Z"),
  );
  assert.equal(identity.packageFormatVersion, 10);
  assert.match(identity.contentSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(identity.ignoredManifestFields, ["metadata.generatedAt"]);
  assert.deepEqual(
    identity,
    environmentLookupPackageIdentity(
      Buffer.from("declmanifest"),
      packageInfo("2026-08-05T11:00:00Z"),
    ),
  );
  const changedMetadata = packageInfo("2026-08-05T10:00:00Z");
  changedMetadata.manifest.metadata.generator = "different-generator";
  assert.notDeepEqual(
    identity,
    environmentLookupPackageIdentity(Buffer.from("declmanifest"), changedMetadata),
  );

  const report = (packageIdentity) => ({
    report: { comparisonIdentity: { workload: "environment-lookup-v2", package: packageIdentity } },
  });
  assert.throws(() => assertComparableBenchmarkReportIdentities([
    { label: "before", report: report(identity) },
    {
      label: "after",
      report: report(environmentLookupPackageIdentity(
        Buffer.from("diffmanifest"),
        packageInfo("2026-08-05T10:00:00Z"),
      )),
    },
  ]), /comparison identity mismatch/);
  assert.notDeepEqual(
    identity,
    environmentLookupPackageIdentity(Buffer.from("declmanifest"), {
      ...packageInfo("2026-08-05T10:00:00Z"),
      package: { ...packageInfo("2026-08-05T10:00:00Z").package, version: 11 },
    }),
  );
});

test("environment lookup harness identity covers every named source", () => {
  const original = environmentLookupHarnessIdentity([
    { path: "scripts/bench-env-lookup.mjs", bytes: Buffer.from("main") },
    { path: "scripts/bench-differential.mjs", bytes: Buffer.from("sampler") },
  ]);
  const reordered = environmentLookupHarnessIdentity([
    { path: "scripts/bench-differential.mjs", bytes: Buffer.from("sampler") },
    { path: "scripts/bench-env-lookup.mjs", bytes: Buffer.from("main") },
  ]);
  const changedSampler = environmentLookupHarnessIdentity([
    { path: "scripts/bench-env-lookup.mjs", bytes: Buffer.from("main") },
    { path: "scripts/bench-differential.mjs", bytes: Buffer.from("changed") },
  ]);

  assert.deepEqual(original, reordered);
  assert.notEqual(original.sha256, changedSampler.sha256);
});

test("environment lookup harness identity covers the loaded runtime source closure", async () => {
  const runtimeDirectories = ["web/src/host", "web/src/react", "web/src/runtime"];
  const expectedRuntimeSources = (await Promise.all(runtimeDirectories.map(async (directory) =>
    (await readdir(new URL(`../${directory}`, import.meta.url)))
      .filter((path) => path.endsWith(".js"))
      .map((path) => `${directory}/${path}`),
  ))).flat().sort();
  const declaredRuntimeSources = environmentLookupHarnessPaths
    .filter((path) => runtimeDirectories.some((directory) => path.startsWith(`${directory}/`)))
    .sort();
  assert.deepEqual(declaredRuntimeSources, expectedRuntimeSources);
  for (const required of [
    "scripts/bench-utils.mjs",
    "web/src/host-resource.js",
    "web/src/pages/browser-package-config.js",
    "web/src/runtime/core.js",
    "web/src/runtime/object-values.js",
    "web/src/vir-host-bindings.js",
    "web/src/vir-runtime.js",
  ]) {
    assert.ok(environmentLookupHarnessPaths.includes(required), `missing harness source ${required}`);
  }
  assert.equal(new Set(environmentLookupHarnessPaths).size, environmentLookupHarnessPaths.length);
  assert.ok(environmentLookupPairHarnessPaths.includes("scripts/bench-env-lookup-wasm-pair.mjs"));
  assert.equal(
    new Set(environmentLookupPairHarnessPaths).size,
    environmentLookupPairHarnessPaths.length,
  );

  const files = await Promise.all(environmentLookupHarnessPaths.map(async (path) => ({
    path,
    bytes: await readFile(new URL(`../${path}`, import.meta.url)),
  })));
  const original = environmentLookupHarnessIdentity(files);
  const changedRuntime = environmentLookupHarnessIdentity(files.map((file) =>
    file.path === "web/src/runtime/core.js"
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from("\n// changed")]) }
      : file,
  ));
  assert.notEqual(original.sha256, changedRuntime.sha256);
});

test("environment lookup outputs must resolve to distinct paths", () => {
  assert.doesNotThrow(() => validateEnvironmentLookupOutputPaths({
    jsonPath: "reports/result.json",
    cpuProfilePath: "reports/result.cpuprofile",
  }, "/tmp/vir-bench"));
  assert.throws(() => validateEnvironmentLookupOutputPaths({
    jsonPath: "reports/result.json",
    cpuProfilePath: "reports/../reports/result.json",
  }, "/tmp/vir-bench"), /distinct output paths/);
});
