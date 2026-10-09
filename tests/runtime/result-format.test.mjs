/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { formatResult } from "../../web/app/pages/page-utils.js";

test("result display preserves exact nested integers and ordinary strings", () => {
  const large = (1n << 256n) + 3n;
  const value = { count: large, nested: [0n, -large, { word: 0xffffffff }], text: "00042" };
  const before = structuredClone(value);
  assert.deepEqual(JSON.parse(formatResult(value)), {
    count: large.toString(),
    nested: ["0", (-large).toString(), { word: 0xffffffff }],
    text: "00042",
  });
  assert.deepEqual(value, before, "display must not change runtime values");
});

test("scalar and byte-array result display keeps the existing presentation", () => {
  assert.equal(formatResult(42n), "42");
  assert.equal(formatResult(-42n), "-42");
  assert.equal(formatResult(0xffffffff), "4294967295");
  assert.equal(formatResult("hello"), "hello");
  assert.equal(formatResult(Uint8Array.of(0, 255)), "0, 255");
  assert.equal(formatResult(null), "null");
  assert.equal(formatResult(undefined), "undefined");
});
