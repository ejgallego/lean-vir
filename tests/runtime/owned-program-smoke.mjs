/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { descriptorContentId, sha256Hex } from "../../web/src/resources/descriptor.js";
import { VIR_COMPATIBILITY_VERSION } from "../../web/src/runtime/versions.js";
import { replaceIrPackageManifest, readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";
import { primitiveBoundary } from "../support/interface-fixtures.mjs";

const root = new URL("../../", import.meta.url);
const runtimeEntry = process.argv[2] ?? new URL("web/src/vir-runtime-node.js", root).href;
const wasmRoot = process.argv[3] ?? new URL("web/public/", root).pathname;
const { prepareRuntime, createVirImports } = await import(runtimeEntry);
const built = spawnSync("lake", ["build", "+ModuleSetFixture.Root:vir"], { cwd: root, encoding: "utf8" });
assert.equal(built.status, 0, built.stderr || built.stdout);
const compiler = spawnSync("lean", ["--githash"], { cwd: root, encoding: "utf8" });
assert.equal(compiler.status, 0, compiler.stderr);
const descriptorPath = new URL(".lake/build/vir/module-sets/ModuleSetFixture/Root.irpkg-set.json", root);
const packageSet = JSON.parse(await readFile(descriptorPath, "utf8"));
const packages = await Promise.all(packageSet.packages.map(entry => readFile(resolve(dirname(descriptorPath.pathname), entry.path))));
const expectedExports = { "ModuleSetFixture.Root.answer": { args: [], result: primitiveBoundary("nat", "bigint"), effect: "pure" } };
const jsBytes = await readFile(new URL(runtimeEntry));
for (const file of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
  const wasmBytes = await readFile(resolve(wasmRoot, file));
  // This test is the publisher of a fixture inventory for each Wasm profile.
  // Its computed CID exercises admission, not independent artifact selection.
  // The real resource-bundle/worker gate uses the produced bundle's envelope.
  const descriptor = { schemaVersion: 2, logicalId: `test/${file}`, kind: "runtime",
    compatibility: { leanRevision: compiler.stdout.trim(), virVersion: VIR_COMPATIBILITY_VERSION },
    files: [
      { path: file, mediaType: "application/wasm", byteLength: wasmBytes.length, sha256: await sha256Hex(wasmBytes) },
      { path: "runtime.js", mediaType: "text/javascript", byteLength: jsBytes.length, sha256: await sha256Hex(jsBytes) },
    ], fileEntries: [{ role: "wasm", path: file }, { role: "runtimeModule", path: "runtime.js" }] };
  const runtimeManifest = { descriptor, contentId: await descriptorContentId(descriptor) };
  const instances = [];
  let abortDuringInstantiation = null;
  const prepared = await prepareRuntime({ wasmBytes, runtimeManifest,
    expectedRuntimeContentId: runtimeManifest.contentId,
    imports(module, hostState) {
      instances.push({ module, hostState });
      abortDuringInstantiation?.abort("inside synchronous instantiation");
      return createVirImports(module, {}, hostState);
    },
  });
  assert.deepEqual(Object.keys(prepared), ["createProgram"]);
  assert.ok(Object.isFrozen(prepared));
  assert.equal(instances.length, 0, "preparation allocates no live instance");
  const options = { irPackageSet: packages, expectedExports };
  for (const bad of [
    { ...options, expectedExports: { "ModuleSetFixture.Root.answer": { args: [], result: primitiveBoundary("string", "string"), effect: "pure" } } },
    { ...options, irPackageSet: [...packages].reverse() },
    { ...options, irPackageSet: packages.map(bytes => { const manifest = structuredClone(readIrPackageInfo(bytes).manifest); manifest.metadata.leanGithash = "wrong"; return replaceIrPackageManifest(bytes, manifest); }) },
  ]) await assert.rejects(prepared.createProgram(bad), error => error.phase === "program-validation");
  assert.equal(instances.length, 0, "contract/compiler/member failures precede reactor initialization");
  const first = await prepared.createProgram(options), second = await prepared.createProgram(options);
  const runtimes = instances.map(({hostState}) => hostState.runtime);
  try {
    assert.equal(instances[0].hostState.runtime.packageInfo.packageCount, 6);
    assert.equal(instances[0].module, instances[1].module);
    assert.notEqual(instances[0].hostState.exports.memory, instances[1].hostState.exports.memory);
    assert.equal(first.call("ModuleSetFixture.Root.answer"), 62n);
    assert.equal(first.callWith({ resultRepresentation: "json-safe-v1" }, "ModuleSetFixture.Root.answer"), "62");
    assert.throws(() => first.call("ModuleSetFixture.Shared.hidden"), /unknown program export/);
    first.dispose(); first.dispose();
    assert.equal(first.status, "disposed");
    assert.throws(() => first.call("ModuleSetFixture.Root.answer"), /disposed/);
    assert.equal(second.call("ModuleSetFixture.Root.answer"), 62n);
  } finally { first.dispose(); second.dispose(); }
  // The real prepared instantiator is synchronous, but a supplied imports hook
  // can abort reentrantly. Its returned instance must still be owned and disposed.
  abortDuringInstantiation = new AbortController();
  await assert.rejects(prepared.createProgram({ ...options, signal: abortDuringInstantiation.signal }),
    error => error.name === "AbortError" && error.phase === "runtime-creation" &&
      error.cause === "inside synchronous instantiation");
  assert.ok(runtimes.every(runtime => runtime.disposed));
  assert.ok(instances.every(({hostState}) => hostState.runtime === null));
  console.log(`owned program verified six-member call/callWith/disposal: ${file} PASS`);
}
