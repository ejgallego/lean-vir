/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repoRoot, "fixtures", "client-native-extern");
const manifestPath = join(fixtureRoot, "lean-vir-native-externs.json");
const wrapperTool = join(
  repoRoot,
  ".lake",
  "build",
  "bin",
  "vir_native_wrappers",
);
const packageTool = join(repoRoot, ".lake", "build", "bin", "vir_irpkg");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runManifest(path, outputs) {
  return spawnSync(
    "lake",
    ["-d", fixtureRoot, "env", wrapperTool, "--manifest", path, ...outputs],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

async function expectManifestFailure(tempRoot, name, manifest, pattern) {
  const path = join(tempRoot, `${name}.json`);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const outputs = [
    "wrappers.cpp",
    "registry.inc",
    "sources.txt",
    "symbols.tsv",
  ].map((file) => join(tempRoot, `${name}-${file}`));
  const result = runManifest(path, outputs);
  assert.notEqual(result.status, 0, `${name} unexpectedly succeeded`);
  assert.match(result.stderr || result.stdout, pattern);
}

run("lake", ["build", "Vir", "vir_native_wrappers", "vir_irpkg"]);
run("lake", ["-d", fixtureRoot, "build"]);

const tempRoot = await mkdtemp(join(tmpdir(), "vir-client-native-extern-"));
try {
  const wrapperPath = join(tempRoot, "wrappers.cpp");
  const registryPath = join(tempRoot, "registry.inc");
  const sourcesPath = join(tempRoot, "sources.txt");
  const symbolsPath = join(tempRoot, "symbols.tsv");
  const generated = runManifest(manifestPath, [
    wrapperPath,
    registryPath,
    sourcesPath,
    symbolsPath,
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  assert.match(
    await readFile(wrapperPath, "utf8"),
    /vir_client_native_increment/,
  );
  assert.match(
    await readFile(registryPath, "utf8"),
    /ClientNativeFixture\.increment.*vir_client_native_increment/,
  );
  assert.equal(
    (await readFile(sourcesPath, "utf8")).trim(),
    join(fixtureRoot, "client_native_fixture.c"),
  );
  assert.equal(
    (await readFile(symbolsPath, "utf8")).trim(),
    "ClientNativeFixture.increment\tvir_client_native_increment",
  );

  const packagePath = join(tempRoot, "fixture.irpkg");
  const reportPath = join(tempRoot, "fixture.report.md");
  run(
    "lake",
    [
      "-d",
      fixtureRoot,
      "env",
      packageTool,
      packagePath,
      reportPath,
      "--target-marked",
      join(fixtureRoot, "ClientNativeFixture.lean"),
    ],
    {
      env: { ...process.env, VIR_NATIVE_EXTERN_MANIFEST: manifestPath },
    },
  );
  const report = await readFile(reportPath, "utf8");
  assert.match(
    report,
    /`ClientNativeFixture\.increment` -> `vir_client_native_increment`/,
  );
  assert.doesNotMatch(
    report,
    /Lean reference body for `ClientNativeFixture\.increment`/,
  );

  const baseManifest = {
    format: "lean-vir-client-native-externs",
    version: 1,
    modules: ["ClientNativeFixture"],
    externs: ["ClientNativeFixture.increment"],
    providerSources: ["client_native_fixture.c"],
  };
  await copyFile(
    join(fixtureRoot, "client_native_fixture.c"),
    join(tempRoot, "client_native_fixture.c"),
  );
  await expectManifestFailure(
    tempRoot,
    "duplicate-extern",
    {
      ...baseManifest,
      externs: [baseManifest.externs[0], baseManifest.externs[0]],
    },
    /duplicate `ClientNativeFixture\.increment`/,
  );
  await expectManifestFailure(
    tempRoot,
    "builtin-collision",
    { ...baseManifest, externs: ["Nat.add"] },
    /collides with the built-in native extern catalog/,
  );
  await expectManifestFailure(
    tempRoot,
    "unknown-extern",
    { ...baseManifest, externs: ["ClientNativeFixture.missing"] },
    /no Lean IR declaration found/,
  );
  await expectManifestFailure(
    tempRoot,
    "incompatible-shared-stem",
    {
      ...baseManifest,
      externs: [
        "ClientNativeFixture.increment",
        "ClientNativeFixture.incompatibleIncrement",
      ],
    },
    /share lookup stem `vir_client_native_increment` with incompatible boxed ABIs/,
  );
  await expectManifestFailure(
    tempRoot,
    "unknown-field",
    { ...baseManifest, nativeLookup: "dynamic" },
    /unknown field `nativeLookup`/,
  );
  await expectManifestFailure(
    tempRoot,
    "empty-modules",
    { ...baseManifest, modules: [] },
    /field `modules` must not be empty/,
  );
  await expectManifestFailure(
    tempRoot,
    "absolute-provider",
    {
      ...baseManifest,
      providerSources: [join(tempRoot, "client_native_fixture.c")],
    },
    /must be relative to the manifest/,
  );
  await expectManifestFailure(
    tempRoot,
    "parent-provider",
    { ...baseManifest, providerSources: ["../client_native_fixture.c"] },
    /must be a normalized relative path/,
  );
  await expectManifestFailure(
    tempRoot,
    "missing-provider",
    { ...baseManifest, providerSources: ["missing.c"] },
    /provider source `missing\.c` does not exist/,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("client-native extern manifest smoke ok");
