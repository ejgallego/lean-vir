/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import { countLiveCallbacks } from "../support/lean-ownership.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { createCommonHostBindings } from "../../web/src/host/vir-common-host-bindings.js";
import { VIR_HOST_DISPOSE } from "../../web/src/host-boundary.js";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-shared-ownership-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    SharedLeanOwnership: await readFile(new URL("../../fixtures/runtime/SharedLeanOwnership.lean", import.meta.url), "utf8"),
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const packagePath = join(directory, "shared-ownership.irpkg");
  const generated = project.runVirIrpkg([
    packagePath, join(directory, "shared-ownership.report.md"),
    "--target-marked-module", "SharedLeanOwnership",
  ]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);
  const irPackageSet = [await readFile(packagePath)];
  const hostPackageBytes = await readFile(new URL("../../web/public/demo-host.irpkg", import.meta.url));

  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const wasmBytes = await readFile(new URL(`../../web/public/${profile}`, import.meta.url));
    let onReenter = () => {};
    const fresh = () => createVirRuntime({ wasmBytes, irPackageSet,
      hostBindings: { "test.sharedOwnership.reenter": () => onReenter() } });
    const runtime = await fresh();
    let other;
    try {
      const pure = runtime.call("pureCallback", 20);
      const first = runtime.leanCallbackCell(pure, "pure callback");
      const independent = runtime.liftObjectFunction(first.callType, first.object, "independent callback");
      assert.notEqual(independent, pure);
      assert.equal(runtime.leanCallbackCell(independent, "independent").object, first.object);
      assert.equal(pure(5), 195n);
      runtime.releaseLeanObjectHandleCell(first);
      assert.throws(() => pure(5), /disposed runtime/);
      assert.equal(independent(5), 195n, "another owner still retains the same closure");

      const state = runtime.call("heldState", 20);
      const effectful = runtime.call("callbackFromHeld", state);
      const cell = runtime.leanCallbackCell(effectful, "effectful callback");
      runtime.releaseLeanObjectHandleCell(runtime.leanObjectHandleCell(state, "state"));
      assert.equal(runtime.hostState.leanObjectHandleCells.size, 2,
        "captured Lean state needs no independently retained JS carrier");
      let nested;
      onReenter = () => {
        nested = runtime.call("pureCallback", 10);
        assert.equal(nested(1), 46n);
        assert.equal(runtime.releaseLeanObjectHandleCell(cell), true);
        assert.equal(runtime.releaseLeanObjectHandleCell(cell), false);
      };
      assert.equal(effectful(5), 195n,
        "invocation reference survives reentrant owner release and nested allocation");
      assert.throws(() => effectful(5), /disposed runtime/);
      assert.equal(nested(2), 47n);
      other = await fresh();
      assert.throws(() => other.callClosure(runtime.leanCallbackCell(nested, "nested"), [0]),
        /live Lean object handle/);
      assert.equal(other.failure, null, "foreign cell rejects before native entry");

      // Native application consumes rejected argv, while its function is borrowed.
      const callable = runtime.leanCallbackCell(independent, "independent");
      const argument = runtime.makeObjectString("owned rejected argument", "argument");
      const argv = runtime.allocByteLength(4, "argv");
      try {
        runtime.exports.vir_obj_inc(argument);
        const refs = () => new DataView(runtime.exports.memory.buffer).getUint32(argument, true);
        assert.equal(refs(), 2);
        runtime.writePointerArray(argv, [argument]);
        assert.equal(runtime.exports.vir_closure_apply_objects(callable.object, 0, 0, 1), 0);
        assert.match(runtime.lastClosureCallError(), /argv pointer is null/);
        assert.equal(refs(), 2, "a null argv was not accepted or consumed");
        assert.equal(independent(5), 195n, "rejection does not release the borrowed function");
        assert.equal(runtime.exports.vir_closure_apply_objects(0, 0, argv, 1), 0);
        assert.match(runtime.lastClosureCallError(), /closure object is null/);
        assert.equal(refs(), 1, "accepted rejected argv releases its owned reference");
      } finally {
        runtime.freeBytes(argv);
        runtime.exports.vir_obj_dec(argument);
      }
      const wasm = runtime.exports;
      const host = runtime.hostState;
      assert.equal(countLiveCallbacks(runtime.hostState), 2);
      runtime.dispose(); runtime.dispose();
      assert.equal(host.leanObjectHandleCells.size, 0);
      assert.equal(countLiveCallbacks(host), 0);
      assert.equal(wasm.vir_resource_roots_active(), 0);
      assert.throws(() => independent(1), /disposed runtime/);
      assert.throws(() => nested(1), /disposed runtime/);
      console.log(`${profile}: shared JSL/callback ownership, reentry and consuming application PASS`);
    } finally {
      runtime.dispose(); other?.dispose();
    }

    for (const throws of [false, true]) {
      const sentinel = new Error("provider cleanup sentinel");
      let disposingRuntime, cleanupResult, retained;
      disposingRuntime = await createVirRuntime({
        wasmBytes, irPackageSet: [hostPackageBytes],
        hostBindings: {
          "test.callNatCallback": (input, callback) => {
            if (disposingRuntime.hostState.disposing) retained = callback;
            return callback(input);
          },
        },
        defaultHostBindings: () => ({
          ...createCommonHostBindings(),
          [VIR_HOST_DISPOSE]() {
            assert.equal(disposingRuntime.disposing, true);
            assert.equal(disposingRuntime.hostState.disposing, true);
            cleanupResult = disposingRuntime.call("HostInterop.callbackRoundTrip", 3);
            if (throws) throw sentinel;
          },
        }),
      });
      const state = disposingRuntime.hostState;
      const wasm = disposingRuntime.exports;
      try {
        assert.equal(disposingRuntime.call("HostInterop.callbackRoundTrip", 3), 10n);
        if (throws) assert.throws(() => disposingRuntime.dispose(), error => error === sentinel);
        else disposingRuntime.dispose();
        assert.equal(cleanupResult, 10n, "fresh callback conversion completes the provider cleanup effect");
        assert.equal(disposingRuntime.disposed, true);
        assert.equal(disposingRuntime.failure, null);
        assert.equal(state.leanObjectHandleCells.size, 0);
        assert.equal(countLiveCallbacks(state), 0);
        assert.equal(wasm.vir_resource_roots_active(), 0);
        assert.throws(() => retained(3), /disposed runtime/);
      } finally {
        disposingRuntime.dispose();
      }
    }
    console.log(`${profile}: provider cleanup creates and terminally retires fresh callbacks PASS`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
