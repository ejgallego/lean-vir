/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVirImports } from "../../web/src/vir-runtime-node.js";

const module = await WebAssembly.compile(await readFile(process.argv[2]));
assert(
  !WebAssembly.Module.imports(module).some(({ name }) =>
    name.startsWith("vir_"),
  ),
);
assert(
  !WebAssembly.Module.exports(module).some(({ kind }) => kind === "table"),
);
const e = new WebAssembly.Instance(module, createVirImports(module)).exports;
e._initialize();
const counts = () => ({
  active: e.vir_resource_roots_active(),
  capacity: e.vir_resource_roots_capacity(),
  reusable: e.vir_resource_roots_reusable(),
});

e.test_fail_metadata(1);
assert.equal(e.vir_resource_root({ failed: "metadata" }), 0);
assert.deepEqual(counts(), { active: 0, capacity: 0, reusable: 0 });
e.test_fail_metadata(0);
e.test_fail_growth(1);
assert.equal(e.vir_resource_root({ failed: "table" }), 0);
assert.deepEqual(counts(), { active: 0, capacity: 0, reusable: 0 });
e.test_fail_growth(0);
const values = [
  null,
  undefined,
  NaN,
  -0,
  42n,
  "text",
  {},
  [],
  () => 42,
  Symbol("root"),
  Promise.resolve(42),
];
const ids = values.map((value) => e.vir_resource_root(value));
values.forEach((value, index) =>
  assert(Object.is(e.vir_resource_get(ids[index]), value)),
);

const remaining = counts().reusable;
const filler = Array.from({ length: remaining }, () =>
  e.vir_resource_root("filler"),
);
const full = counts();
e.test_fail_metadata(1);
assert.equal(e.vir_resource_root("failed metadata growth"), 0);
assert.deepEqual(counts(), full);
e.test_fail_metadata(0);
e.test_fail_growth(1);
assert.equal(e.vir_resource_root("failed table growth"), 0);
assert.deepEqual(counts(), full);
values.forEach((value, index) =>
  assert(Object.is(e.vir_resource_get(ids[index]), value)),
);
e.test_fail_growth(0);
const extra = e.vir_resource_root("retry");
assert.notEqual(extra, 0);
assert.equal(e.vir_resource_get(extra), "retry");

const beforeRelease = counts().active;
e.vir_resource_release(ids[0]);
e.vir_resource_release(ids[0]);
e.vir_resource_release(0);
e.vir_resource_release(0xffffffff);
assert.equal(counts().active, beforeRelease - 1);
const reused = e.vir_resource_root("reused");
assert.equal(reused, ids[0]);
e.vir_resource_release(reused);
for (const id of [...ids.slice(1), ...filler, extra])
  e.vir_resource_release(id);
assert.equal(counts().active, 0);
const capacity = counts().capacity;
for (let i = 0; i < 1000; ++i) {
  const id = e.vir_resource_root(i);
  assert.equal(e.vir_resource_get(id), i);
  e.vir_resource_release(id);
}
assert.equal(counts().capacity, capacity);
e.vir_resource_root({ abandoned: true });
assert.throws(() => e.test_trap(), WebAssembly.RuntimeError);
assert.equal(counts().active, 1);
e.vir_resource_roots_clear();
e.vir_resource_roots_clear();
assert.deepEqual(counts(), { active: 0, capacity, reusable: 0 });
assert.equal(e.vir_resource_root("closed"), 0);
assert.equal(e.vir_resource_get(ids[1]), null);
e.vir_resource_release(ids[1]);
assert.equal(counts().active, 0);
console.log(
  "actual Wasm root allocator: identity, failure rollback/retry, reuse, churn and terminal trap clear PASS",
);
