/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime, createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  assert,
  createRuntimeModuleProject,
  join,
  readFile,
  runVirIrpkg,
  spawnSync,
} from "./shared.mjs";

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
      "invoke", "invocationCallback", "failLean", "makeIoFailureCallback",
    ].map(x => prefix + x),
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  let failure = new Error("original host error");
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
          assert.equal(runtime.call(prefix + "readCounter", counter), 0n);
        }
      },
    },
  });
  const counter = runtime.call(prefix + "newCounter");
  try {
    const rootedValues = runtime.hostState.resourceRootCounts().active;
    for (const method of ["call", "callTimed"]) {
      assert.throws(() => runtime[method](prefix + "failThenWork", counter), error => error === failure);
      assert.equal(runtime.call(prefix + "readCounter", counter), 0n, "Lean continuation must not mutate its reference");
      assert.equal(runtime.liveCallbackCount(), 0, "later callback allocation must not run");
      assert.equal(hostCalls, 0, "later native effects must not run");
      assert.equal(runtime.hostState.callError, null);
      assert.equal(runtime.hostState.callTimings.length, 0);
      assert.equal(runtime.hostState.resourceRootCounts().active, rootedValues,
        "failed calls must release their temporary argument roots");
    }
    const callback = runtime.call(prefix + "failureCallback", counter);
    const invokeCallback = runtime.call(prefix + "invocationCallback", callback);
    const roots = runtime.liveCallbackCount();
    const resourceRoots = runtime.hostState.resourceRootCounts().active;
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
          assert.equal(runtime.liveCallbackCount(), roots);
          assert.equal(runtime.hostState.resourceRootCounts().active, resourceRoots,
            "nested calls must release their temporary argument roots");
          assert.equal(runtime.call(prefix + "readCounter", counter), 0n);
          assert.equal(hostCalls, 0, "caught errors must still stop the failed Lean continuation");
        }
      }
    }
    for (const method of ["call", "callTimed"]) {
      assert.throws(() => runtime[method](prefix + "failLean"), /IO action failed:.*Lean IO failure/,
        "a null result must still report the Lean call error");
      assert.equal(runtime.call(prefix + "readCounter", counter), 0n);
    }
    const ioFailureCallback = runtime.call(prefix + "makeIoFailureCallback");
    assert.throws(
      () => ioFailureCallback(0),
      /IO callback failed:.*Lean IO callback failure/,
      "closure IO errors should retain the Lean IO.Error text",
    );
    // Exercise the complete dispatcher, including transactional cleanup. The
    // proxy's diagnostic inspection tries to perform a real nested Lean/host effect.
    const inspections = [];
    const nestedFailures = [];
    let nestedSuccesses = 0;
    const thrownProxy = new Proxy({}, {
      getPrototypeOf() {
        inspections.push(runtime.hostState.callError !== null);
        shouldThrow = false;
        try {
          runtime.call(prefix + "failThenWork", counter);
          nestedSuccesses++;
        } catch (error) { nestedFailures.push(error === runtime.hostState.callError); }
        return Object.prototype;
      },
    });
    failure = thrownProxy;
    for (const method of ["call", "callTimed"]) {
      inspections.length = 0;
      nestedFailures.length = 0;
      shouldThrow = true;
      assert.throws(() => runtime[method](prefix + "failThenWork", counter),
        error => error.cause === thrownProxy);
      assert.ok(inspections.length > 0, "the owning boundary inspects the proxy");
      assert.ok(inspections.every(Boolean), "inspection must follow host-error quarantine");
      assert.equal(nestedSuccesses, 0, "diagnostic inspection cannot complete a nested Lean call");
      assert.equal(nestedFailures.length, inspections.length);
      assert.ok(nestedFailures.every(Boolean), "nested calls reject with the active quarantine error");
      assert.equal(hostCalls, 0, "diagnostic inspection cannot perform host effects");
      assert.equal(runtime.call(prefix + "readCounter", counter), 0n);
      assert.equal(runtime.failure, null, "an effectful exception without Wasm unwind stays recoverable");
    }
    shouldThrow = false;
    runtime.call(prefix + "failThenWork", counter);
    assert.equal(runtime.call(prefix + "readCounter", counter), 1n);
    assert.equal(hostCalls, 1, "successful imports still permit ordinary continuation");
  } finally {
    runtime.dispose();
    assert.equal(runtime.liveCallbackCount(), 0);
  }

  // The host error is caught by Lean inside this one exported IO action. The
  // call-wide diagnostic must still quarantine subsequent imports: the second
  // effect must not run, and reaching a pure import with the poisoned result
  // must retire this interpreter instead of presenting a successful value.
  const quarantineProject = await createRuntimeModuleProject(
    join(temp, "quarantine-modules"),
    {
      HostErrorQuarantine: `module
meta import Vir.Attributes
public import Vir.Js
public section
open Lean.Vir
namespace HostErrorQuarantine
@[vir_js "test.quarantine.fail"] opaque failHost : RuntimeM Unit
@[vir_js "test.quarantine.effect"] opaque laterEffect (value : Js String) : RuntimeM Unit
@[vir_js "test.quarantine.pure"] opaque pureProbe (value : Js String) : Js String := value
@[vir_export] def catchThenEffect (value : Js String) : IO Unit := do
  try failHost.run catch _ => pure ()
  try (laterEffect value).run catch _ => pure ()
@[vir_export] def catchThenContinue (value : Js String) : IO (Js String) := do
  catchThenEffect value
  pure (pureProbe value)
end HostErrorQuarantine`,
    },
  );
  const quarantineBuilt = quarantineProject.build();
  assert.equal(quarantineBuilt.status, 0,
    `${quarantineBuilt.stderr}\n${quarantineBuilt.stdout}`);
  const quarantinePath = join(temp, "host-error-quarantine.irpkg");
  const quarantineGenerated = quarantineProject.runVirIrpkg([
    quarantinePath,
    join(temp, "host-error-quarantine.report.md"),
    "--target-marked-module",
    "HostErrorQuarantine",
  ]);
  assert.equal(quarantineGenerated.status, 0,
    `${quarantineGenerated.stderr}\n${quarantineGenerated.stdout}`);
  const quarantineFailure = new Error("caught effectful host error");
  let laterEffects = 0;
  let pureCalls = 0;
  const quarantineRuntime = await createVirRuntimeFactory({
    wasmBytes: await readFile(
      new URL("../../web/public/vir-upstream.wasm", import.meta.url),
    ),
    hostBindings: {
      "test.quarantine.fail": () => { throw quarantineFailure; },
      "test.quarantine.effect": () => { laterEffects += 1; },
      "test.quarantine.pure": value => { pureCalls += 1; return value; },
    },
  }).createRuntime({ irPackageSet: [await readFile(quarantinePath)] });
  try {
    assert.throws(() => quarantineRuntime.call("HostErrorQuarantine.catchThenEffect", "blocked"),
      error => error === quarantineFailure);
    assert.equal(quarantineRuntime.failure, null,
      "blocked effectful imports abort the invocation without retiring the instance");
    assert.equal(laterEffects, 0);
    assert.throws(
      () => quarantineRuntime.call("HostErrorQuarantine.catchThenContinue", "blocked"),
      error => error === quarantineFailure || error?.cause === quarantineFailure,
    );
    assert.equal(laterEffects, 0,
      "a caught host exception must block the next effectful import in the same Lean action");
    assert.equal(pureCalls, 0,
      "a pure import must not run after the effectful exception poisoned the call");
    assert.ok(quarantineRuntime.failure instanceof Error,
      "continuing into a pure import after swallowing an effect error must retire the interpreter");
    assert.throws(
      () => quarantineRuntime.call("HostErrorQuarantine.catchThenContinue"),
      /fresh runtime/,
    );
  } finally {
    quarantineRuntime.dispose();
  }

  console.log("real-Wasm host IO errors stop Lean/host continuation; identity, nested calls and reuse PASS");
} finally {
  await rm(temp, { recursive: true, force: true });
}
