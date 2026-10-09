/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { collectCleanupError, throwCollectedErrors, throwWithCleanup } from "../../web/src/runtime/cleanup.js";

test("cleanup preserves raw exceptions without inspecting them", () => {
  let inspections = 0;
  const raw = new Proxy({}, {
    getPrototypeOf() { inspections++; throw new Error("unexpected inspection"); },
    get() { inspections++; throw new Error("unexpected property access"); },
  });
  let cleanups = 0;
  assert.throws(() => throwWithCleanup(raw, () => { cleanups++; }, "cleanup"),
    error => error === raw);
  assert.equal(cleanups, 1);
  const errors = [];
  collectCleanupError(errors, () => { throw raw; });
  assert.equal(errors[0], raw);
  assert.equal(inspections, 0);
});

test("cleanup aggregation preserves each raw failure and its order", () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.throws(() => throwWithCleanup(proxy, () => { throw null; }, "two failures"),
    error => error instanceof AggregateError && error.errors.length === 2 &&
      error.errors[0] === proxy && error.errors[1] === null);
  const errors = [];
  collectCleanupError(errors, () => { throw undefined; });
  assert.equal(errors.length, 1);
  let caught = false;
  try { throwCollectedErrors(errors); } catch (error) {
    caught = true;
    assert.equal(error, undefined);
  }
  assert.equal(caught, true);
});
