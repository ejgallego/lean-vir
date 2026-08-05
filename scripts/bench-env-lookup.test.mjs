/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  environmentLookupHarnessIdentity,
  environmentLookupPackageIdentity,
  validateEnvironmentLookupOutputPaths,
} from "./bench-env-lookup-contract.mjs";
import { assertComparableBenchmarkReportIdentities } from "./bench-utils.mjs";

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
      version: 7,
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
    report: { comparisonIdentity: { workload: "environment-lookup-v1", package: packageIdentity } },
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
