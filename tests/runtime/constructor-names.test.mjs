/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  enumValue,
  normalizeEnum,
} from "../../web/src/runtime/vir-value-normalizers.js";

const type = {
  constructors: [
    { name: "Example.Color.red", jsName: "red", tag: 0 },
    { name: "Example.Color.constructor", jsName: "constructor", tag: 1 },
  ],
};

test("enum values use the JS spelling in both directions", () => {
  for (const [index, value] of ["red", "constructor"].entries()) {
    assert.equal(normalizeEnum(value, type, "value"), index);
    assert.equal(enumValue(type, index), value);
  }
  for (const value of ["Example.Color.red", "Example.Color.constructor", "0", "1"]) {
    assert.throws(() => normalizeEnum(value, type, "value"), /unknown enum constructor/);
  }
});

test("enum metadata cannot substitute the Lean name or ordinal for jsName", () => {
  for (const ctor of [
    { name: "Example.Color.red", tag: 0 },
    { tag: 0 },
    { name: "Example.Color.red", jsName: null, tag: 0 },
    { name: "Example.Color.red", jsName: 42, tag: 0 },
  ]) {
    const incomplete = { constructors: [ctor] };
    assert.throws(
      () => normalizeEnum("Example.Color.red", incomplete, "value"),
      /invalid manifest enum constructor/,
    );
    assert.throws(() => enumValue(incomplete, 0), /invalid manifest enum constructor/);
  }
});

test("enum conversion requires a nonempty constructor table", () => {
  for (const incomplete of [{}, { constructors: [] }]) {
    assert.throws(() => normalizeEnum("red", incomplete, "value"), /missing manifest enum constructors/);
    assert.throws(() => enumValue(incomplete, 0), /missing manifest enum constructors/);
  }
});

test("enum lifting requires a numeric constructor ordinal in range", () => {
  for (const index of [-1, 2, 0.5, NaN, "0", "constructor", "map"]) {
    assert.throws(() => enumValue(type, index), /enum.*index.*out of range/);
  }
});
