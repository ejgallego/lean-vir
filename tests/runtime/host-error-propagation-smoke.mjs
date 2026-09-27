/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, join, readFile, runVirIrpkg, spawnSync } from "./shared.mjs";

const prefix = "Vir.Fixtures.HostErrorPropagation.";
const temp = await mkdtemp(join(tmpdir(), "vir-host-error-"));
try {
  const built = spawnSync("lake", ["build", "+HostErrorPropagation"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8",
  });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const path = join(temp, "host-error.irpkg");
  const generated = runVirIrpkg([
    path, join(temp, "host-error.report.md"), "--target-module", "HostErrorPropagation",
    ...[
      "newCounter", "readCounter", "failThenWork", "failureCallback",
      "invoke", "invocationCallback", "failLean",
    ].map(x => prefix + x),
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const failure = new Error("original host error");
  let hostCalls = 0;
  let shouldThrow = true;
  let catchNested = false;
  let nestedMethod = "closure";
  let callAfterCatch = false;
  let runtime;
  runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(path)],
    hostBindings: {
      "test.hostError.fail": () => { if (shouldThrow) throw failure; },
      "test.hostError.record": () => { hostCalls += 1; },
      "test.hostError.invoke": (callback) => {
        const invokeNested = () => nestedMethod === "closure"
          ? callback(undefined)
          : runtime[nestedMethod](prefix + "failThenWork", counter);
        if (!catchNested) return invokeNested();
        assert.throws(invokeNested, error => error === failure);
        if (callAfterCatch) {
          assert.equal(runtime.call(prefix + "readCounter", counter), "0");
        }
      },
    },
  });
  const counter = runtime.call(prefix + "newCounter");
  try {
    const rootedValues = runtime.hostState.resourceRoots.debugCounts().active;
    for (const method of ["call", "callTimed"]) {
      assert.throws(() => runtime[method](prefix + "failThenWork", counter), error => error === failure);
      assert.equal(runtime.call(prefix + "readCounter", counter), "0", "Lean continuation must not mutate its reference");
      assert.equal(runtime.liveCallbacks.size, 0, "later callback allocation must not run");
      assert.equal(hostCalls, 0, "later native effects must not run");
      assert.equal(runtime.hostState.callError, null);
      assert.equal(runtime.hostState.callTimings.length, 0);
      assert.equal(runtime.hostState.resourceRoots.debugCounts().active, rootedValues,
        "failed calls must release their temporary argument roots");
    }
    const callback = runtime.call(prefix + "failureCallback", counter);
    const invokeCallback = runtime.call(prefix + "invocationCallback", callback);
    const roots = runtime.liveCallbacks.size;
    const resourceRoots = runtime.hostState.resourceRoots.debugCounts().active;
    assert.throws(() => callback(undefined), error => error === failure);
    for (nestedMethod of ["call", "callTimed", "closure"]) {
      for (const [outer, invoke] of [
        ["call", () => runtime.call(prefix + "invoke", callback)],
        ["callTimed", () => runtime.callTimed(prefix + "invoke", callback)],
        ["closure", () => invokeCallback(undefined)],
      ]) {
        catchNested = false;
        assert.throws(invoke, error => error === failure,
          `${outer} must preserve an uncaught ${nestedMethod} error`);
        catchNested = true;
        for (callAfterCatch of [false, true]) {
          // Checking the outer result before any further named call is essential:
          // another call clears the C++ diagnostic left by the nested failure.
          assert.doesNotThrow(invoke,
            `${outer} must succeed after catching ${nestedMethod}; subsequent call: ${callAfterCatch}`);
          assert.equal(runtime.hostState.callError, null);
          assert.equal(runtime.hostState.callTimings.length, 0);
          assert.equal(runtime.liveCallbacks.size, roots);
          assert.equal(runtime.hostState.resourceRoots.debugCounts().active, resourceRoots,
            "nested calls must release their temporary argument roots");
          assert.equal(runtime.call(prefix + "readCounter", counter), "0");
          assert.equal(hostCalls, 0, "caught errors must still stop the failed Lean continuation");
        }
      }
    }
    for (const method of ["call", "callTimed"]) {
      assert.throws(() => runtime[method](prefix + "failLean"), /IO action failed/,
        "a null result must still report the Lean call error");
      assert.equal(runtime.call(prefix + "readCounter", counter), "0");
    }
    shouldThrow = false;
    runtime.call(prefix + "failThenWork", counter);
    assert.equal(runtime.call(prefix + "readCounter", counter), "1");
    assert.equal(hostCalls, 1, "successful imports still permit ordinary continuation");
  } finally {
    runtime.dispose();
    assert.equal(runtime.liveCallbacks.size, 0);
  }
  console.log("real-Wasm host IO errors stop Lean/host continuation; identity, nested calls and reuse PASS");
} finally {
  await rm(temp, { recursive: true, force: true });
}
