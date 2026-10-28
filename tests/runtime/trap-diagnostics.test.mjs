/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirRuntimeFactory } from "../../web/src/runtime/factory.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";

// Exports memory and `_initialize`, which calls the imported `env.init`.
function reactorModule() {
  const name = value => [value.length, ...new TextEncoder().encode(value)];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  return new WebAssembly.Module(Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(2, [1, ...name("env"), ...name("init"), 0, 0]),
    ...section(3, [1, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, [2, ...name("memory"), 2, 0, ...name("_initialize"), 0, 1]),
    ...section(10, [1, 4, 0, 0x10, 0, 0x0b]),
  ]));
}

test("the factory runs reactor initialization once per instance", () => {
  let initializations = 0;
  const factory = new VirRuntimeFactory({
    wasmModule: reactorModule(),
    imports: { env: { init: () => { initializations++; } } },
  });
  const first = factory.instantiateModule(factory.wasmModule);
  assert.equal(initializations, 1);
  const second = factory.instantiateModule(factory.wasmModule);
  assert.equal(initializations, 2);
  first.dispose();
  second.dispose();
});

// Fake exports whose memory holds `message` at the trap-diagnostic address.
function trappingRuntime(message, hostState = null) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const bytes = new TextEncoder().encode(message);
  new Uint8Array(memory.buffer, 64, bytes.length).set(bytes);
  const trap = new WebAssembly.RuntimeError("unreachable");
  let fail = () => { throw trap; };
  const runtime = new VirRuntime({
    memory,
    vir_alloc_bytes: () => fail(),
    vir_last_trap_message: () => 64,
    vir_last_trap_message_size: () => bytes.length,
  }, hostState === null ? {} : { hostState });
  return { runtime, trap, setFail: replacement => { fail = replacement; } };
}

test("a recorded Lean exception becomes the retirement failure", () => {
  const message = "(interpreter) unknown declaration 'Missing.decl'";
  const { runtime, trap } = trappingRuntime(message);
  assert.throws(() => runtime.allocBytes(new Uint8Array(1)), error =>
    error === runtime.failure &&
    error.message === `Lean runtime error: ${message}` &&
    error.cause === trap);
  // The diagnostics only read fixed storage and stay callable after retirement.
  assert.equal(runtime.exports.vir_last_trap_message_size(), message.length);
  assert.throws(() => runtime.allocBytes(new Uint8Array(1)), /fresh runtime/);
  runtime.dispose();
});

test("a JavaScript host exception still explains the trap it caused", () => {
  const hostState = new VirHostState({ defaultHostBindings: {} });
  const hostError = new Error("host binding failed");
  const { runtime, setFail } = trappingRuntime("unrelated text", hostState);
  setFail(() => {
    hostState.recordCallError(hostError);
    throw new WebAssembly.RuntimeError("unreachable");
  });
  assert.throws(() => runtime.allocBytes(new Uint8Array(1)), error => error === hostError);
  assert.equal(runtime.failure, hostError);
  runtime.dispose();
});

test("a trap without a recorded exception keeps the original error", () => {
  const { runtime, trap } = trappingRuntime("");
  assert.throws(() => runtime.allocBytes(new Uint8Array(1)), error => error === trap);
  assert.equal(runtime.failure, trap);
  runtime.dispose();
});
