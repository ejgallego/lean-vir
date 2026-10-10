/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { functionBoundary, primitiveBoundary, unitBoundary } from "../support/interface-fixtures.mjs";

for (const kind of ["named", "closure"]) {
  test(`${kind} transfers arguments before a trap and never reenters Wasm for cleanup`, () => {
    const hostState = new VirHostState({ defaultHostBindings: {} });
    const failure = new Error("original exception");
    let cleanups = 0;
    let rootClears = 0;
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
      vir_abort_ir_package_set: () => cleanups++,
      vir_resource_roots_clear: () => rootClears++,
      vir_call_resolved_objects: fail,
      vir_closure_apply_objects: fail,
    }, { hostState });
    runtime.resolveCallSlot = () => 1;
    runtime.makeObjectValue = (_type, value) => value;
    const args = [100, 200];
    assert.throws(() => kind === "named"
      ? runtime.callResolvedObjects({ entry: "test" }, {}, args, () => {})
      : runtime.callClosure({ runtime, object: 1, live: true,
        callType: functionBoundary([primitiveBoundary("int", "bigint"), primitiveBoundary("int", "bigint")], unitBoundary()) }, args), error => error === failure);
    assert.deepEqual(args, kind === "named" ? [] : [100, 200], "callbacks own their lowered array, not the caller inputs");
    assert.equal(runtime.failure, failure);
    assert.equal(hostState.callError, null);
    assert.throws(() => runtime.requireLiveRuntime(), /fresh runtime/);
    assert.throws(() => runtime.exports.vir_call_resolved_objects(1, 0, 0), /fresh runtime/);
    runtime.releaseOwnedObjects([100]);
    runtime.exports.vir_abort_ir_package_set();
    runtime.dispose();
    runtime.dispose();
    assert.equal(entries, 1);
    assert.equal(cleanups, 0, "abandoned Wasm stack and allocator must not be touched");
    assert.equal(rootClears, 1, "terminal table clearing is allowed after failure and disposal is idempotent");
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

// A real Wasm frame invoking the production import wrapper, followed by the
// unreachable used by pure host trampolines when dispatch returns no value.
function boundaryModule() {
  const name = value => [value.length, ...new TextEncoder().encode(value)];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  return new WebAssembly.Module(Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 1, 0x7f]),
    ...section(2, [1, ...name("env"), ...name("vir_js_call_objects"), 0, 0]),
    ...section(3, [1, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, [2, ...name("run"), 0, 1, ...name("memory"), 2, 0]),
    ...section(10, [1, 6, 0, 0x10, 0, 0x1a, 0, 0x0b]),
  ]));
}

const { createVirImports } = await import("../../web/src/runtime/factory.js");
for (const throughHostWrapper of [false, true]) {
  for (const kind of ["error", "non-stringifiable", "proxy", "revoked proxy"]) {
    test(`real Wasm failure latches ${kind}, host wrapper=${throughHostWrapper}`, () => {
      let runtime;
      const inspections = [];
      const hostState = new VirHostState({ defaultHostBindings: {} });
      let thrown = new Error("ordinary control");
      if (kind === "non-stringifiable") {
        thrown = { [Symbol.toPrimitive]() { throw this; } };
      } else if (kind === "proxy") {
        thrown = new Proxy({}, { getPrototypeOf() {
          inspections.push(throughHostWrapper ? hostState.callError !== null : runtime.failure !== null);
          throw thrown;
        } });
      } else if (kind === "revoked proxy") {
        const revocable = Proxy.revocable({}, {});
        revocable.revoke();
        thrown = revocable.proxy;
      }
      let calls = 0, cleanups = 0;
      const fail = () => { calls++; throw thrown; };
      const module = boundaryModule();
      hostState.callObjects = fail;
      const imports = throughHostWrapper ? createVirImports(module, {}, hostState)
        : { env: { vir_js_call_objects: fail } };
      const instance = new WebAssembly.Instance(module, imports);
      runtime = new VirRuntime({ ...instance.exports,
        vir_obj_dec: () => cleanups++, vir_free_bytes: () => cleanups++,
        vir_abort_ir_package_set: () => cleanups++,
      }, { hostState });
      let failure;
      try { runtime.exports.run(); assert.fail("expected exceptional unwind"); }
      catch (error) { failure = error; }
      assert.equal(runtime.failure, failure);
      if (kind === "error") assert.equal(failure, thrown);
      else assert.equal(failure.cause, thrown);
      if (kind === "proxy") {
        assert.ok(inspections.length > 0);
        assert.ok(inspections.every(Boolean), "failure is committed before inspecting the proxy");
      }
      assert.equal(Object.hasOwn(runtime, "wasmBoundary"), false);
      runtime.wasmBoundary = { failure: null }; // Cannot reset the private latch.
      assert.equal(runtime.failure, failure);
      assert.throws(() => runtime.exports.run(), /fresh runtime/);
      runtime.exports.vir_obj_dec(10);
      runtime.exports.vir_free_bytes(10);
      runtime.exports.vir_abort_ir_package_set();
      runtime.dispose();
      assert.equal(calls, 1);
      assert.equal(cleanups, 0);
    });
  }
}

test("failure subscriptions notify once, after the stack, including late subscribers", async () => {
  const failure = new Error("subscription failure");
  const runtime = new VirRuntime({ memory: new WebAssembly.Memory({ initial: 1 }),
    trap() { throw failure; } });
  const seen = [];
  const unsubscribe = runtime.onFailure(error => seen.push(error));
  const cancel = runtime.onFailure(() => assert.fail("unsubscribed listener ran"));
  cancel(); cancel();
  const originalConsoleError = console.error;
  const diagnostics = [];
  console.error = (...args) => diagnostics.push(args);
  try {
    runtime.onFailure(() => { throw new Error("listener failure"); });
    assert.throws(() => runtime.exports.trap(), error => error === failure);
    assert.deepEqual(seen, [], "listeners cannot run on the active Wasm stack");
    runtime.onFailure(error => seen.push(error));
    const cancelLate = runtime.onFailure(() => assert.fail("cancelled late listener ran"));
    cancelLate();
    await Promise.resolve();
    assert.deepEqual(seen, [failure, failure]);
    assert.equal(diagnostics.length, 1);
    assert.throws(() => runtime.exports.trap(), /fresh runtime/);
    await Promise.resolve();
    assert.deepEqual(seen, [failure, failure]);
    assert.equal(runtime.failure, failure);
  } finally {
    console.error = originalConsoleError;
    unsubscribe();
    runtime.dispose();
  }
});
