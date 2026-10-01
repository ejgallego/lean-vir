/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import {
  VirRuntimeFactory,
  VIR_HOST_DISPOSE,
} from "../../web/src/runtime/factory.js";
import { readRuntimeArtifacts } from "./shared.mjs";
import { collectUntil } from "./generation-gc-cases.js";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const module = await WebAssembly.compile(wasmBytes);
assert(
  !WebAssembly.Module.imports(module).some(({ name }) =>
    ["vir_resource_root", "vir_resource_get", "vir_resource_release"].includes(
      name,
    ),
  ),
);
assert(
  !WebAssembly.Module.exports(module).some(({ kind }) => kind === "table"),
);
const create = () =>
  createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] });
const runtime = await create();
const other = await create();
const counts = () => runtime.hostState.resourceRootCounts();
try {
  const objects = Array.from({ length: 257 }, (_, i) =>
    runtime.exports.vir_obj_resource({ i }),
  );
  assert(objects.every(Boolean));
  assert.equal(counts().active, objects.length);
  objects.forEach((object, i) =>
    assert.deepEqual(runtime.exports.vir_obj_resource_externref(object), { i }),
  );
  const capacity = counts().capacity;
  objects.forEach((object) => runtime.exports.vir_obj_dec(object));
  assert.equal(counts().active, 0);
  for (let i = 0; i < 1000; ++i)
    runtime.exports.vir_obj_dec(runtime.exports.vir_obj_resource(i));
  assert.equal(counts().capacity, capacity);

  const value = Promise.resolve("identity");
  const box = other.exports.vir_obj_resource(value);
  assert.equal(other.exports.vir_obj_resource_externref(box), value);
  const weak = pinPayload(runtime);
  assert.equal(counts().active, 1);
  // Existing trap-regression entry: malformed byte input, not a forged Lean object.
  assert.throws(
    () => runtime.exports.vir_obj_nat(0xfffffff0, 32),
    WebAssembly.RuntimeError,
  );
  assert(runtime.failure);
  assert.equal(runtime.exports.vir_resource_roots_active(), 1);
  assert.throws(
    () => runtime.exports.vir_obj_resource("retired"),
    /fresh runtime/,
  );
  runtime.dispose();
  runtime.dispose();
  assert.equal(runtime.exports.vir_resource_roots_active(), 0);
  assert.equal(runtime.exports.vir_resource_roots_reusable(), 0);
  await collectUntil(
    () => weak.deref() === undefined,
    "retired table payload drops while runtime stays owned",
  );
  assert.equal(other.exports.vir_obj_resource_externref(box), value);
  other.exports.vir_obj_dec(box);
} finally {
  runtime.dispose();
  other.dispose();
}
// Fresh-provider cleanup failure must not prevent terminal table clearing,
// including after a real trap has disabled interpreter/Lean-heap cleanup.
for (const fatal of [false, true]) {
  const cleanup = new Error("provider cleanup sentinel");
  let disposals = 0;
  const owned = await new VirRuntimeFactory({
    wasmModule: module,
    defaultHostBindings: () => ({
      [VIR_HOST_DISPOSE]() {
        disposals++;
        throw cleanup;
      },
    }),
  }).instantiate();
  const state = owned.hostState;
  const weak = pinPayload(owned);
  assert.equal(state.resourceRootCounts().active, 1);
  if (fatal) {
    assert.throws(
      () => owned.exports.vir_obj_nat(0xfffffff0, 32),
      WebAssembly.RuntimeError,
    );
    assert(owned.failure);
  }
  assert.throws(
    () => owned.dispose(),
    (error) => error === cleanup,
  );
  assert.equal(owned.exports.vir_resource_roots_active(), 0);
  assert.equal(state.defaultBindings, null);
  assert.equal(state.userBindings, null);
  owned.dispose();
  assert.equal(disposals, 1);
  await collectUntil(
    () => weak.deref() === undefined,
    `provider failure clears payload (fatal=${fatal})`,
  );
}
console.log(
  "integrated Wasm roots: ownership/churn, Promise, independent instances and real trap retirement PASS",
);

function pinPayload(runtime) {
  const value = { detached: true };
  assert(runtime.exports.vir_obj_resource(value));
  return new WeakRef(value);
}
