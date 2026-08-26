/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";
import { repositoryRoot as repoRoot } from "../../scripts/repository-paths.mjs";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";

const fixtureRoot = resolve(repoRoot, "fixtures/cross-package-one-runtime");
const descriptorPath = resolve(
  fixtureRoot,
  ".lake/build/vir/module-sets/App/Root.irpkg-set.json",
);
const wasmPath = resolve(repoRoot, "web/public/vir-upstream.wasm");

const generated = spawnSync("lake", ["build", "+App.Root:vir"], {
  cwd: fixtureRoot,
  encoding: "utf8",
});
assert.equal(generated.status, 0, generated.stderr || generated.stdout);

const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
assert.deepEqual(
  descriptor.packages.map(({ module, role }) => [module, role]),
  [
    ["Dep.Contribution", "dependency"],
    ["App.Root", "root"],
  ],
);

const packageBytes = await Promise.all(
  descriptor.packages.map(({ path }) =>
    readFile(resolve(dirname(descriptorPath), path)),
  ),
);
const rootPackage = readIrPackageInfo(packageBytes.at(-1));
const rootEntries = Object.fromEntries(
  rootPackage.manifest.exports.map(({ entry, startup }) => [entry, startup]),
);
assert.deepEqual(rootEntries, {
  "App.Root.dependencyFeature": false,
  "App.Root.startup": true,
  "App.Root.applicationFeature": false,
});
assert.equal(
  rootPackage.manifest.exports.some(({ entry }) =>
    entry.startsWith("Dep.Contribution."),
  ),
  false,
);

const wasmBytes = await readFile(wasmPath);
const factory = createVirRuntimeFactory({ wasmBytes });
let runtimeCreations = 0;
const createApplicationRuntime = async () => {
  runtimeCreations += 1;
  return factory.createRuntime({ irPackageSetBytes: packageBytes });
};

const runtime = await createApplicationRuntime();
assert.equal(runtimeCreations, 1);
assert.equal(runtime.packageInfo.packageCount, 2);
assert.equal(runtime.call("App.Root.dependencyFeature"), "40");
assert.equal(runtime.call("App.Root.applicationFeature"), "2");
assert.throws(
  () => runtime.call("Dep.Contribution.feature"),
  /interface entry not found: Dep\.Contribution\.feature/,
);

assert.equal(runtime.runStartupEntries(), undefined);
assert.equal(runtime.call("App.Root.dependencyFeature"), "41");
assert.equal(runtime.runStartupEntries(), undefined);
assert.equal(runtime.call("App.Root.dependencyFeature"), "41");

let disposals = 0;
runtime.dispose();
disposals += 1;
assert.equal(disposals, 1);

console.log("cross-package one-root one-runtime smoke ok");
