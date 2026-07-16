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
    source: "EntryRuntime.lean",
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
  exports: [entry("first", true), entry("ordinary", false), entry("second", true)],
};
runtime.callEntry = (candidate, args) => {
  assert.deepEqual(args, []);
  calls.push(candidate.entry);
  return candidate.entry;
};

assert.equal(runtime.runEntries(), undefined);
assert.deepEqual(calls, ["first", "second"]);
assert.equal(runtime.runEntries(), undefined);
assert.deepEqual(calls, ["first", "second"]);

runtime.completedStartupEntries = new Set(["first", "second"]);
runtime.createReplacementRuntime = () => ({
  installIrPackageBytes() {
    throw new Error("replacement rejected");
  },
  dispose() {},
});
assert.throws(() => runtime.replaceIrPackageBytes(new Uint8Array()), /replacement rejected/);
assert.deepEqual([...runtime.completedStartupEntries], ["first", "second"]);

runtime.completedStartupEntries = new Set();
runtime.interfaceManifest = {
  exports: [entry("beforeFailure", true), entry("failsOnce", true), entry("afterFailure", true)],
};
let shouldFail = true;
runtime.callEntry = (candidate) => {
  calls.push(candidate.entry);
  if (candidate.entry === "failsOnce" && shouldFail) {
    shouldFail = false;
    throw new Error("startup failed");
  }
};
assert.throws(() => runtime.runEntries(), /startup failed/);
assert.deepEqual([...runtime.completedStartupEntries], ["beforeFailure"]);
assert.equal(runtime.runEntries(), undefined);
assert.deepEqual([...runtime.completedStartupEntries], ["beforeFailure", "failsOnce", "afterFailure"]);
assert.deepEqual(calls.slice(-4), ["beforeFailure", "failsOnce", "failsOnce", "afterFailure"]);

const legacyManifest = validateInterfaceManifest({
  version: 6,
  metadata: {},
  exports: [{ ...entry("legacy", undefined), startup: undefined }],
});
assert.equal(legacyManifest.exports[0].startup, false);

console.log("vir startup entry runtime smoke ok");
