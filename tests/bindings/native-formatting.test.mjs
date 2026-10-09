/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import test from "node:test";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

const bindings = createJsValueHostBindings();

test("native formatting keeps Number/BigInt domains and radix errors", () => {
  for (const value of [-0, NaN, Infinity, -Infinity, 0.1, 123]) {
    assert.equal(bindings["js.number.toString"](value, undefined), value.toString());
    assert.equal(bindings["js.number.toString"](value, 16), value.toString(16));
  }
  const large = 2n ** 256n + 17n;
  assert.equal(bindings["js.nat.toString"](large, undefined), large.toString());
  assert.equal(bindings["js.nat.toString"](large, 16), large.toString(16));
  for (const [target, value] of [["js.number.toString", 12], ["js.nat.toString", 12n]])
    for (const radix of [1, 37]) assert.throws(() => bindings[target](value, radix), RangeError);
});

test("template interpolation uses ToString, not String's Symbol exception", () => {
  const interpolate = bindings["js.string.interpolate"];
  for (const value of [undefined, null, false, -0, NaN, Infinity, 2n ** 256n, "\ud800"])
    assert.equal(interpolate("prefix:", value), `prefix:${value}`);
  let calls = 0;
  const value = { [Symbol.toPrimitive](hint) { calls++; assert.equal(hint, "string"); return "exact"; } };
  assert.equal(interpolate("prefix:", value), "prefix:exact");
  assert.equal(calls, 1);
  assert.throws(() => interpolate("", Symbol("s")), TypeError);
  const failure = new Error("conversion");
  assert.throws(() => interpolate("", { toString() { throw failure; } }), error => error === failure);
});

test("numeric formatting agrees with pinned TypeScript declarations", () => {
  assert.deepEqual(typeScriptDiagnostics(`
    export const numberString = (value: number, radix: number | undefined): string => value.toString(radix);
    export const bigintString = (value: bigint, radix: number | undefined): string => value.toString(radix);
  `), []);
  assert.ok(typeScriptDiagnostics(`export const bad = (value: bigint): string => value.toString(16n);`).length > 0);
});
