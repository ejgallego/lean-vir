/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  IR_PACKAGE_SECTION,
  readIrPackageInfo,
  replaceIrPackageManifest,
} from "../../scripts/packages/irpkg-format.mjs";
import { repositoryRoot as repoRoot } from "../../scripts/repository-paths.mjs";
import {
  createVirRuntime,
  createVirRuntimeFactory,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
} from "../../web/src/vir-runtime-node.js";

const descriptorPath = resolve(
  repoRoot,
  ".lake/build/vir/module-sets/ModuleSetFixture/Root.irpkg-set.json",
);
const wasmPath = resolve(repoRoot, "web/public/vir-upstream.wasm");

const generated = spawnSync("lake", ["build", "+ModuleSetFixture.Root:vir"], {
  cwd: repoRoot,
  encoding: "utf8",
});
assert.equal(generated.status, 0, generated.stderr || generated.stdout);

const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
assert.equal(descriptor.format, IR_PACKAGE_SET_FORMAT);
assert.equal(descriptor.version, IR_PACKAGE_SET_VERSION);
assert.deepEqual(
  descriptor.packages.map(({ module, role }) => [module, role]),
  [
    ["ModuleSetFixture.Shared", "dependency"],
    ["ModuleSetFixture.Left", "dependency"],
    ["ModuleSetFixture.Right", "dependency"],
    ["ModuleSetFixture.InternalBase", "dependency"],
    ["ModuleSetFixture.Facade", "dependency"],
    ["ModuleSetFixture.Root", "root"],
  ],
);

const packageBytes = await Promise.all(
  descriptor.packages.map((entry) =>
    readFile(resolve(dirname(descriptorPath), entry.path)),
  ),
);
const packageInfoByModule = new Map(
  descriptor.packages.map((entry, index) => [
    entry.module,
    readIrPackageInfo(packageBytes[index]),
  ]),
);
for (const [index, descriptorMember] of descriptor.packages.entries()) {
  const manifest = packageInfoByModule.get(descriptorMember.module).manifest;
  assert.deepEqual(manifest.metadata.packageSetMember, {
    module: descriptorMember.module,
    role: descriptorMember.role,
  });
  if (descriptorMember.role === "dependency") {
    assert.deepEqual(manifest.metadata.targets, []);
    assert.deepEqual(manifest.exports, []);
  } else {
    assert.deepEqual(manifest.metadata.targets, [
      {
        module: "ModuleSetFixture.Root",
        mode: "markedModule",
        roots: [],
        resolvedRoots: ["ModuleSetFixture.Root.answer"],
      },
    ]);
    assert.equal(manifest.exports[0].source, "module ModuleSetFixture.Root");
  }
  assert.doesNotMatch(JSON.stringify(manifest), /\.lake|\/drivers\//);
  assert.equal(
    descriptorMember.path,
    index < 5 ? `Root.parts/${index}.irpkg` : "Root.irpkg",
  );
}
for (const moduleName of [
  "ModuleSetFixture.Shared",
  "ModuleSetFixture.Right",
  "ModuleSetFixture.InternalBase",
  "ModuleSetFixture.Facade",
]) {
  assert.ok(initSectionSize(packageInfoByModule.get(moduleName)) > 4);
}
assert.ok(
  initSectionSize(packageInfoByModule.get("ModuleSetFixture.Root")) > 4,
);
const wasmBytes = await readFile(wasmPath);
const expectedAnswer = "62";

const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: packageBytes,
});
assert.equal(runtime.packageInfo.packageCount, 6);
assert.equal(
  runtime.packageInfo.count,
  [...packageInfoByModule.values()].reduce(
    (count, info) => count + info.package.declarationCount,
    0,
  ),
);
assert.equal(runtime.packageMetadata.targets[0].mode, "markedModule");
assert.equal(runtime.packageInfo.packageSet, null);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), expectedAnswer);
assert.throws(
  () =>
    runtime.loadIrPackageSetBytes([
      packageBytes[0],
      packageBytes[0],
      ...packageBytes.slice(1),
    ]),
  /duplicates embedded module "ModuleSetFixture\.Shared"/,
);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), expectedAnswer);
assert.throws(
  () =>
    runtime.loadIrPackageSetBytes([
      packageBytes.at(-1),
      ...packageBytes.slice(0, -1),
    ]),
  /member 1 embeds role "root"; expected "dependency"/,
);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), expectedAnswer);
const mismatchedToolchainManifest = structuredClone(
  packageInfoByModule.get("ModuleSetFixture.Left").manifest,
);
mismatchedToolchainManifest.metadata.leanGithash = "different-checkpoint";
assert.throws(
  () =>
    runtime.loadIrPackageSetBytes([
      packageBytes[0],
      replaceIrPackageManifest(packageBytes[1], mismatchedToolchainManifest),
      ...packageBytes.slice(2),
    ]),
  /mixes metadata\.leanGithash/,
);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), expectedAnswer);
runtime.loadIrPackageSetBytes(packageBytes);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), expectedAnswer);
runtime.dispose();

const urlRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSet: pathToFileURL(descriptorPath),
  fetchBytes: (path) => readFile(path),
});
assert.equal(urlRuntime.call("ModuleSetFixture.Root.answer"), expectedAnswer);
assert.deepEqual(
  urlRuntime.packageInfo.packageSet.members.map(({ module, role, path }) => ({
    module,
    role,
    path,
  })),
  descriptor.packages.map(({ module, role, path }) => ({ module, role, path })),
);
assert.equal(
  Object.hasOwn(urlRuntime.packageInfo.packageSet.members[0], "bytes"),
  false,
);
urlRuntime.dispose();

const structuredFactory = createVirRuntimeFactory({
  wasmBytes,
  fetchBytes: (path) => readFile(path),
});
const descriptorUrl = pathToFileURL(descriptorPath);
const descriptorClaimMismatch = structuredClone(descriptor);
descriptorClaimMismatch.packages[0].module = "Claimed.Dependency";
descriptorClaimMismatch.packages.at(-1).module = "Claimed.Root";
const mismatchFactory = createVirRuntimeFactory({
  wasmBytes: new Uint8Array(),
  fetchBytes: (path) =>
    String(path) === descriptorUrl.href
      ? new TextEncoder().encode(JSON.stringify(descriptorClaimMismatch))
      : readFile(path),
});
await assert.rejects(
  () => mismatchFactory.createRuntime({ irPackageSet: descriptorUrl }),
  /member 1 embeds module "ModuleSetFixture\.Shared"; descriptor claims "Claimed\.Dependency"/,
);
const fetchedPackageSet =
  await structuredFactory.fetchIrPackageSet(descriptorUrl);
assert.deepEqual(
  fetchedPackageSet.members.map(({ module, role }) => [module, role]),
  descriptor.packages.map(({ module, role }) => [module, role]),
);
fetchedPackageSet.members[0].bytes[0] ^= 1;
await assert.rejects(
  () => structuredFactory.createRuntime({ irPackageSet: fetchedPackageSet }),
  /no longer matches its integrity metadata/,
);
const verifiedPackageSet =
  await structuredFactory.fetchIrPackageSet(descriptorUrl);
const structuredRuntime = await structuredFactory.createRuntime({
  irPackageSet: verifiedPackageSet,
});
assert.equal(
  structuredRuntime.call("ModuleSetFixture.Root.answer"),
  expectedAnswer,
);
assert.equal(
  structuredRuntime.packageInfo.packageSet.descriptorUrl,
  descriptorUrl.href,
);
structuredRuntime.dispose();

console.log("module package-set smoke ok");

function initSectionSize(info) {
  return info.package.sections.find(
    (section) => section.kind === IR_PACKAGE_SECTION.INIT_GLOBALS,
  )?.byteLength;
}
