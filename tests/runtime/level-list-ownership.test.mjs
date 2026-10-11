/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";

for (const failAt of [0, 1, 2]) {
  test(`specialized level-list scratch preserves transfer on ${failAt ? `failure ${failAt}` : "success and growth"}`, () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const owned = new Map([[20, []], [30, []], [40, []]]);
    const allocations = [], freed = [], released = [];
    let calls = 0, next = 100;
    const release = obj => {
      if (obj === 1) return;
      assert.ok(owned.has(obj), `object ${obj} is released once`);
      const children = owned.get(obj);
      owned.delete(obj); released.push(obj);
      for (const child of children) release(child);
    };
    const runtime = Object.create(VirRuntime.prototype);
    runtime.exports = {
      memory,
      vir_obj_scalar: () => 1,
      vir_alloc_bytes: size => { allocations.push(size); return 64; },
      vir_free_bytes: ptr => freed.push(ptr),
      vir_obj_dec: release,
      vir_obj_ctor(tag, ptr, count) {
        assert.equal(tag, 1); assert.equal(count, 2);
        const view = new DataView(memory.buffer);
        const children = [view.getUint32(ptr, true), view.getUint32(ptr + 4, true)];
        calls++;
        if (calls === failAt) return 0;
        const result = next++;
        owned.set(result, children);
        if (calls === 1) memory.grow(1);
        return result;
      },
    };
    const elements = [20, 30, 40];
    let result = 0;
    try {
      if (failAt) assert.throws(() => runtime.makeObjectListFromOwnedElements(elements, "levels"), /could not be lowered/);
      else {
        result = runtime.makeObjectListFromOwnedElements(elements, "levels");
        assert.deepEqual(elements, []);
        assert.deepEqual(released, [], "success transfers every input into the result");
      }
    } finally {
      runtime.releaseOwnedObjects(elements);
      if (result) release(result);
    }
    assert.deepEqual(allocations, [8], "one pointer buffer belongs to this loop");
    assert.deepEqual(freed, [64]);
    assert.equal(owned.size, 0);
    assert.deepEqual(released.filter(obj => obj < 100).sort(), [20, 30, 40]);
  });
}
