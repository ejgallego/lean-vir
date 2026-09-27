/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";

for (const kind of ["named", "closure"]) {
  test(`${kind} transfers arguments before a trap and never reenters Wasm for cleanup`, () => {
    const hostState = new VirHostState({ defaultHostBindings: {} });
    const failure = new Error("original exception");
    let cleanups = 0;
    let entries = 0;
    const fail = () => {
      entries++;
      hostState.recordCallError(failure);
      throw new WebAssembly.RuntimeError("trap");
    };
    const runtime = new VirRuntime({
      memory: new WebAssembly.Memory({ initial: 1 }),
      vir_alloc_bytes: () => 32,
      vir_free_bytes: () => cleanups++,
      vir_obj_dec: () => cleanups++,
      vir_closure_release: () => cleanups++,
      vir_abort_ir_package_set: () => cleanups++,
      vir_call_resolved_objects: fail,
      vir_closure_call_objects: fail,
    }, { hostState });
    runtime.resolveCallSlot = () => 1;
    const args = [100, 200];
    assert.throws(() => kind === "named"
      ? runtime.callResolvedObjects({ entry: "test" }, {}, args, () => {})
      : runtime.callClosureObjects(1, {}, args), error => error === failure);
    assert.deepEqual(args, [], "ownership has left JavaScript even when entry throws");
    assert.equal(runtime.failure, failure);
    assert.equal(hostState.callError, null);
    assert.throws(() => runtime.requireLiveRuntime(), /fresh runtime/);
    assert.throws(() => runtime.exports.vir_call_resolved_objects(1, 0, 0), /fresh runtime/);
    runtime.releaseOwnedObjects([100]);
    runtime.releaseClosure(1);
    runtime.exports.vir_abort_ir_package_set();
    runtime.dispose();
    runtime.dispose();
    assert.equal(entries, 1);
    assert.equal(cleanups, 0, "abandoned Wasm stack and allocator must not be touched");
    assert.equal(hostState.disposed, true);
  });
}

test("a trap outside interpreter entry also retires the instance", () => {
  const trap = new WebAssembly.RuntimeError("allocation trap");
  const runtime = new VirRuntime({ memory: new WebAssembly.Memory({ initial: 1 }),
    vir_alloc_bytes() { throw trap; } });
  assert.throws(() => runtime.allocBytes(new Uint8Array(1)), error => error === trap);
  assert.equal(runtime.failure, trap);
  assert.throws(() => runtime.allocBytes(new Uint8Array(1)), /fresh runtime/);
  runtime.dispose();
});
