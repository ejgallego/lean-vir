/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  IR_PACKAGE_SECTION,
  readIrPackageInfo,
} from "../../scripts/packages/irpkg-format.mjs";
import {
  createVirRuntime,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
} from "../../web/src/vir-runtime-node.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
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
    ["ModuleSetFixture.Root", "root"],
  ],
);

const packageBytes = await Promise.all(descriptor.packages.map((entry) =>
  readFile(resolve(dirname(descriptorPath), entry.path))));
const packageInfoByModule = new Map(descriptor.packages.map((entry, index) => [
  entry.module,
  readIrPackageInfo(packageBytes[index]),
]));
assert.ok(initSectionSize(packageInfoByModule.get("ModuleSetFixture.Shared")) > 4);
assert.ok(initSectionSize(packageInfoByModule.get("ModuleSetFixture.Right")) > 4);
assert.equal(initSectionSize(packageInfoByModule.get("ModuleSetFixture.Root")), 4);
const wasmBytes = await readFile(wasmPath);

const runtime = await createVirRuntime({ wasmBytes, irPackageSetBytes: packageBytes });
assert.equal(runtime.packageInfo.packageCount, 4);
assert.equal(runtime.packageInfo.count, 10);
assert.equal(runtime.packageMetadata.targets[0].mode, "markedModules");
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), "42");
assert.throws(
  () => runtime.loadIrPackageSetBytes([packageBytes[0], packageBytes[0], packageBytes[1]]),
  /duplicate IR declaration `ModuleSetFixture\./,
);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), "42");
runtime.loadIrPackageSetBytes(packageBytes);
assert.equal(runtime.call("ModuleSetFixture.Root.answer"), "42");
runtime.dispose();

const urlRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetUrl: pathToFileURL(descriptorPath),
  fetchBytes: (path) => readFile(path),
});
assert.equal(urlRuntime.call("ModuleSetFixture.Root.answer"), "42");
urlRuntime.dispose();

console.log("module package-set smoke ok");

function initSectionSize(info) {
  return info.package.sections.find((section) =>
    section.kind === IR_PACKAGE_SECTION.INIT_GLOBALS)?.byteLength;
}
