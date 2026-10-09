/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import assert from "node:assert/strict";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime.js";

// A real Wasm module exporting one page of memory, sufficient for an unloaded
// runtime. No package, compiler, or mocked WebAssembly implementation is needed.
const wasmBytes = Uint8Array.of(
  0, 97, 115, 109, 1, 0, 0, 0,
  5, 3, 1, 0, 1,
  7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0,
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("overlapping runtimes share acquisition and compilation, not memory", async () => {
  const bytes = deferred();
  let fetches = 0;
  const factory = createVirRuntimeFactory({
    wasmUrl: "runtime.wasm",
    fetchBytes: () => { fetches++; return bytes.promise; },
    defaultHostBindings: () => ({}),
  });
  const first = factory.createRuntime();
  const second = factory.createRuntime();
  bytes.resolve(wasmBytes);
  const [a, b] = await Promise.all([first, second]);
  try {
    assert.equal(fetches, 1);
    assert.equal(a.module, b.module);
    assert.equal(await factory.module(), a.module);
    assert.notEqual(a.exports.memory, b.exports.memory);
    new Uint8Array(a.exports.memory.buffer)[0] = 37;
    assert.equal(new Uint8Array(b.exports.memory.buffer)[0], 0);
    a.dispose();
    b.requireLiveRuntime();
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("overlapping acquisition failure is shared and a later request retries", async () => {
  const bytes = deferred();
  const failure = new Error("fetch failed");
  let fetches = 0;
  const factory = createVirRuntimeFactory({
    wasmUrl: "runtime.wasm",
    fetchBytes: () => ++fetches === 1 ? bytes.promise : wasmBytes,
  });
  const first = assert.rejects(factory.module(), error => error === failure);
  const second = assert.rejects(factory.module(), error => error === failure);
  // Allow the shared fetch operation to start before failing it.
  await Promise.resolve();
  bytes.reject(failure);
  await Promise.all([first, second]);
  assert.equal(fetches, 1);
  const [a, b] = await Promise.all([factory.module(), factory.module()]);
  assert.equal(fetches, 2);
  assert.equal(a, b);
  assert.equal(await factory.module(), a);
});

test("synchronously throwing fetch can retry", async () => {
  const failure = new Error("synchronous fetch failure");
  let fetches = 0;
  const factory = createVirRuntimeFactory({
    wasmUrl: "runtime.wasm",
    fetchBytes: () => {
      if (++fetches === 1) throw failure;
      return wasmBytes;
    },
  });
  await assert.rejects(factory.module(), error => error === failure);
  assert.ok(await factory.module() instanceof WebAssembly.Module);
  assert.equal(fetches, 2);
});

test("explicit bytes and precompiled modules never fetch", async () => {
  const fetchBytes = () => { throw new Error("unexpected fetch"); };
  const bytesFactory = createVirRuntimeFactory({ wasmBytes, fetchBytes });
  const [a, b] = await Promise.all([bytesFactory.module(), bytesFactory.module()]);
  assert.equal(a, b);
  const moduleFactory = createVirRuntimeFactory({ wasmModule: a, fetchBytes });
  assert.equal(await moduleFactory.module(), a);
});

test("failed compilation retains supplied bytes and can retry after repair", async () => {
  const mutableBytes = Uint8Array.from(wasmBytes);
  mutableBytes[0] = 1;
  const factory = createVirRuntimeFactory({ wasmBytes: mutableBytes });
  await assert.rejects(factory.module(), WebAssembly.CompileError);
  mutableBytes[0] = 0;
  assert.ok(await factory.module() instanceof WebAssembly.Module);
});

test("failed compilation of fetched bytes retries acquisition", async () => {
  let fetches = 0;
  const factory = createVirRuntimeFactory({
    wasmUrl: "runtime.wasm",
    fetchBytes: () => ++fetches === 1 ? Uint8Array.of(0) : wasmBytes,
  });
  await assert.rejects(factory.module(), WebAssembly.CompileError);
  const [a, b] = await Promise.all([factory.module(), factory.module()]);
  assert.equal(fetches, 2);
  assert.equal(a, b);
});
