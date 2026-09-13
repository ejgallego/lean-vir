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
    ...["newCounter", "readCounter", "failThenWork", "failureCallback", "invoke"].map(x => prefix + x),
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const failure = new Error("original host error");
  let hostCalls = 0;
  let shouldThrow = true;
  let catchNested = false;
  let runtime;
  runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(path)],
    hostBindings: {
      "test.hostError.fail": () => { if (shouldThrow) throw failure; },
      "test.hostError.record": () => { hostCalls += 1; },
      "test.hostError.invoke": (callback) => {
        if (!catchNested) return callback(undefined);
        assert.throws(() => callback(undefined), error => error === failure);
        // A host can catch a completed nested JS call's error and reenter.
        assert.equal(runtime.call(prefix + "readCounter", counter), "0");
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
    const roots = runtime.liveCallbacks.size;
    assert.throws(() => callback(undefined), error => error === failure);
    assert.throws(() => runtime.call(prefix + "invoke", callback), error => error === failure);
    catchNested = true;
    runtime.call(prefix + "invoke", callback);
    assert.equal(runtime.liveCallbacks.size, roots);
    assert.equal(runtime.call(prefix + "readCounter", counter), "0");
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
