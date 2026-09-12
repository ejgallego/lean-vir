/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsonValueHostBindings } from "../../web/src/host/vir-json-value-bindings.js";

const bindings = createJsonValueHostBindings();
const check = bindings["jsonValue.check"];
const inspect = bindings["jsonValue.inspect"];
const build = bindings["jsonValue.build"];

test("JSON values accept ordinary nested data and repeated aliases without mutation", () => {
  const shared = Object.freeze({ count: 7 });
  const value = Object.freeze({
    text: "λ😀", empty: "", nil: null, flag: false,
    limits: Object.freeze([-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]),
    first: shared, second: shared,
    dictionary: Object.assign(Object.create(null), { x: 0 }),
  });
  assert.deepEqual(check(value), { kind: "ok", value: null });
  assert.equal(value.first, value.second);
  assert.deepEqual(inspect(shared), {
    kind: "object", value: [{ fst: "count", snd: 7 }],
  });
});

test("JSON numbers reject values outside the exact integer domain", () => {
  for (const value of [NaN, Infinity, -Infinity, -0, 0.5, 2 ** 53, -(2 ** 53)]) {
    assert.equal(check(value).kind, "error");
  }
  for (const value of [0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    assert.equal(build(inspect(value)), value);
  }
  assert.throws(() => build({ kind: "integer", value: 9007199254740992n }), RangeError);
});

test("unsupported values are errors rather than omitted or coerced", () => {
  const values = [undefined, () => 0, Symbol("x"), 1n, new Date(), new Map(),
    new Number(1), new Uint8Array([1]), Object.create({ inherited: 1 })];
  for (const value of values) {
    const result = check({ nested: value });
    assert.equal(result.kind, "error");
    assert.match(result.value, /^\$\["nested"\]:/);
  }
});

test("JSON inspection rejects accessors without invoking them", () => {
  let reads = 0;
  const value = { get bad() { reads++; throw new Error("must not run"); } };
  assert.equal(check(value).kind, "error");
  assert.equal(reads, 0);
  assert.equal(check(Object.defineProperty({}, "hidden", { value: 1 })).kind, "error");
  assert.equal(check({ [Symbol("key")]: 1 }).kind, "error");
});

test("array holes and extra properties cannot silently disappear", () => {
  assert.equal(check(Array(2)).kind, "error");
  assert.equal(check(Object.assign([1], { extra: 2 })).kind, "error");
  assert.equal(check(Object.assign([1], { "01": 2 })).kind, "error");
  assert.equal(check(Object.setPrototypeOf([], null)).kind, "error");
});

test("cycles and reserved RPC reference shapes are excluded", () => {
  const cycle = { child: [] };
  cycle.child.push(cycle);
  assert.match(check(cycle).value, /cyclic/);
  assert.match(check({ nested: { __rpcref: "7" } }).value, /reserved RPC/);
  assert.match(check({ p: "7" }).value, /legacy RPC/);
  assert.equal(check({ p: 7 }).kind, "ok");
  assert.equal(check({ p: "7", ordinary: true }).kind, "ok");
});

test("invalid UTF-16 cannot be silently replaced during Lean string lowering", () => {
  for (const value of ["\ud800", "\udfff", { "\ud800": true }]) {
    assert.match(check(value).value, /UTF-16/);
  }
});

test("inspection exceptions do not inspect or stringify an external thrown value", () => {
  const thrown = new Proxy({}, { get() { throw new Error("coercion"); } });
  for (const error of [thrown, null, undefined, 4, "error"]) {
    const value = new Proxy({}, { getPrototypeOf() { throw error; } });
    assert.deepEqual(check(value), { kind: "error", value: "$: object inspection failed" });
  }
});

test("object construction treats __proto__ as an own data field", () => {
  const result = build({ kind: "object", value: [{ fst: "__proto__", snd: 7 }] });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result, "__proto__").value, 7);
});
