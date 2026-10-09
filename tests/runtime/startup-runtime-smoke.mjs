/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { VirRuntime } from "../../web/src/runtime/core.js";
import { INTERFACE_MANIFEST_VERSION } from "../../web/src/runtime/interface-manifest.js";

function entry(name, startup) {
  return {
    entry: name,
    nameKey: `s${Buffer.from(name).toString("hex")}/`,
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
runtime.startupState = "pending";
runtime.startupError = null;
runtime.interfaceManifest = null;
assert.throws(() => runtime.runStartupEntries(), /before loading an IR package/);
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
  assert.equal(runtime.runStartupEntries(), undefined);
  return candidate.entry;
};

assert.equal(runtime.runStartupEntries(), undefined);
assert.deepEqual(calls, ["first", "second"]);
assert.equal(runtime.runStartupEntries(), undefined);
assert.deepEqual(calls, ["first", "second"]);

const failedRuntime = new VirRuntime({ memory: new WebAssembly.Memory({ initial: 1 }) });
failedRuntime.interfaceManifest = {
  exports: [
    entry("beforeFailure", true),
    entry("failsOnce", true),
    entry("afterFailure", true),
    entry("ordinary", false),
  ],
};
let shouldFail = true;
const startupFailure = new Error("startup failed");
failedRuntime.callEntry = (candidate) => {
  calls.push(candidate.entry);
  if (candidate.entry === "failsOnce" && shouldFail) {
    shouldFail = false;
    throw startupFailure;
  }
};
assert.throws(() => failedRuntime.runStartupEntries(), error => error === startupFailure);
assert.throws(() => failedRuntime.runStartupEntries(), error => error === startupFailure);
assert.throws(() => failedRuntime.runStartupEntries(), error => error === startupFailure);
assert.deepEqual(calls, [
  "first",
  "second",
  "beforeFailure",
  "failsOnce",
]);
// A recoverable startup error does not turn ordinary calls into fatal errors.
assert.equal(failedRuntime.failure, null);
failedRuntime.rebuildManifestExports();
assert.equal(failedRuntime.call("ordinary"), undefined);
assert.equal(calls.at(-1), "ordinary");

const freshRuntime = new VirRuntime({ memory: new WebAssembly.Memory({ initial: 1 }) });
freshRuntime.interfaceManifest = failedRuntime.interfaceManifest;
freshRuntime.callEntry = failedRuntime.callEntry;
freshRuntime.runStartupEntries();
assert.deepEqual(calls.slice(-3), ["beforeFailure", "failsOnce", "afterFailure"]);
freshRuntime.runStartupEntries();
assert.equal(calls.length, 8);

const installCalls = [];
const invalidManifestText = JSON.stringify({
  version: INTERFACE_MANIFEST_VERSION,
  metadata: {
    packageFormatVersion: 11,
    manifestVersion: INTERFACE_MANIFEST_VERSION,
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
  vir_package_format_version: () => 11,
  vir_package_decl_count: () => 0,
});
assert.throws(
  () => invalidInstallRuntime.installIrPackageSetBytes([Uint8Array.of(1)]),
  /exports\[0\]\.startup must be a boolean/,
);
assert.deepEqual(installCalls, ["append", "prepare", "abort"]);
assert.equal(invalidInstallRuntime.packageInfo, null);

// A schema-valid but binary-inconsistent manifest is rejected at the same
// pre-initializer boundary, before it can configure host imports.
const validManifest = JSON.parse(invalidManifestText);
validManifest.exports[0].startup = false;
const validManifestBytes = new TextEncoder().encode(
  JSON.stringify(validManifest),
);
new Uint8Array(memory.buffer, manifestPtr, validManifestBytes.length).set(
  validManifestBytes,
);
invalidInstallRuntime.exports.vir_package_interface_manifest_size = () =>
  prepared ? validManifestBytes.length : 0;
invalidInstallRuntime.exports.vir_validate_package_contract = () => {
  installCalls.push("validate contract");
  return 0;
};
invalidInstallRuntime.lastPackageError = () => "test contract mismatch";
invalidInstallRuntime.hostState = {
  setManifest: (manifest) => {
    if (manifest !== null) installCalls.push("install host");
  },
};
installCalls.length = 0;
assert.throws(
  () => invalidInstallRuntime.installIrPackageSetBytes([Uint8Array.of(1)]),
  /test contract mismatch/,
);
assert.deepEqual(installCalls, [
  "append",
  "prepare",
  "validate contract",
  "abort",
]);
assert.equal(invalidInstallRuntime.packageInfo, null);

console.log("vir startup hook runtime smoke ok");
