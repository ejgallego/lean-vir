/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { VirRuntime } from "../../web/src/runtime/core.js";
import { validateInterfaceManifest } from "../../web/src/runtime/interface-manifest.js";

function entry(name, startup) {
  return {
    id: name,
    jsName: name,
    entry: name,
    source: "StartupRuntime.lean",
    args: [],
    result: { type: "Unit", interfaceTag: 22 },
    effect: "dom",
    startup,
  };
}

const calls = [];
const runtime = Object.create(VirRuntime.prototype);
runtime.disposed = false;
runtime.completedStartupEntries = new Set();
runtime.interfaceManifest = {
  exports: [
    entry("first", true),
    entry("ordinary", false),
    entry("second", true),
  ],
};
runtime.callEntry = (candidate, args) => {
  assert.deepEqual(args, []);
  calls.push(candidate.entry);
  return candidate.entry;
};

assert.equal(runtime.runStartupEntries(), undefined);
assert.deepEqual(calls, ["first", "second"]);
assert.equal(runtime.runStartupEntries(), undefined);
assert.deepEqual(calls, ["first", "second"]);

runtime.completedStartupEntries = new Set(["first", "second"]);
runtime.createReplacementRuntime = () => ({
  installIrPackageSetBytes() {
    throw new Error("replacement rejected");
  },
  dispose() {},
});
assert.throws(
  () => runtime.replaceIrPackageSetBytes([new Uint8Array()]),
  /replacement rejected/,
);
assert.deepEqual([...runtime.completedStartupEntries], ["first", "second"]);

runtime.completedStartupEntries = new Set();
runtime.interfaceManifest = {
  exports: [
    entry("beforeFailure", true),
    entry("failsOnce", true),
    entry("afterFailure", true),
  ],
};
let shouldFail = true;
runtime.callEntry = (candidate) => {
  calls.push(candidate.entry);
  if (candidate.entry === "failsOnce" && shouldFail) {
    shouldFail = false;
    throw new Error("startup failed");
  }
};
assert.throws(() => runtime.runStartupEntries(), /startup failed/);
assert.deepEqual([...runtime.completedStartupEntries], ["beforeFailure"]);
assert.equal(runtime.runStartupEntries(), undefined);
assert.deepEqual(
  [...runtime.completedStartupEntries],
  ["beforeFailure", "failsOnce", "afterFailure"],
);
assert.deepEqual(calls.slice(-4), [
  "beforeFailure",
  "failsOnce",
  "failsOnce",
  "afterFailure",
]);

const legacyInput = {
  version: 6,
  metadata: {},
  exports: [{ ...entry("legacy", undefined), startup: undefined }],
};
const legacyManifest = validateInterfaceManifest(legacyInput);
assert.equal(legacyManifest.exports[0].startup, false);
assert.equal(legacyInput.exports[0].startup, undefined);
assert.notEqual(legacyManifest, legacyInput);

const installCalls = [];
const invalidManifestText = JSON.stringify({
  version: 8,
  metadata: {
    packageFormatVersion: 10,
    manifestVersion: 8,
    targets: [],
  },
  exports: [entry("invalid", undefined)],
});
const invalidManifestBytes = new TextEncoder().encode(invalidManifestText);
const memory = new WebAssembly.Memory({ initial: 1 });
const manifestPtr = 4096;
new Uint8Array(memory.buffer, manifestPtr, invalidManifestBytes.length).set(
  invalidManifestBytes,
);
let prepared = false;
const invalidInstallRuntime = new VirRuntime({
  memory,
  vir_alloc_bytes: () => 1024,
  vir_free_bytes: () => {},
  vir_begin_ir_package_set: () => 1,
  vir_append_ir_package: () => {
    installCalls.push("append");
    return 1;
  },
  vir_prepare_ir_package_set: () => {
    installCalls.push("prepare");
    prepared = true;
    return 1;
  },
  vir_finish_ir_package_set: () => {
    installCalls.push("finish");
    return 1;
  },
  vir_abort_ir_package_set: () => {
    installCalls.push("abort");
    prepared = false;
  },
  vir_package_interface_manifest: () => manifestPtr,
  vir_package_interface_manifest_size: () =>
    prepared ? invalidManifestBytes.length : 0,
  vir_package_format_version: () => 10,
  vir_package_decl_count: () => 0,
});
assert.throws(
  () => invalidInstallRuntime.loadIrPackageSetBytes([Uint8Array.of(1)]),
  /exports\[0\]\.startup must be a boolean/,
);
assert.deepEqual(installCalls, ["append", "prepare", "abort"]);
assert.equal(invalidInstallRuntime.packageInfo, null);

console.log("vir startup hook runtime smoke ok");
