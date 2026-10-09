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
import {
  constructorTemplate,
  defaultValueForType,
  interfaceInputTag,
} from "../../web/app/pages/interface-inputs.js";
import {
  enumBoundary,
  nativeDescriptor,
  nativeField,
  objectBoundary,
  objectConstructor,
} from "../support/interface-fixtures.mjs";

const color = enumBoundary("Example.Color", ["red", "constructor"]);

test("enum values use the chosen JavaScript spelling in both directions", () => {
  for (const [index, value] of ["red", "constructor"].entries()) {
    assert.equal(normalizeEnum(value, color, "value"), index);
    assert.equal(enumValue(color, index), value);
  }
  for (const value of ["Example.Color.red", "Example.Color.constructor", "0", "1"]) {
    assert.throws(() => normalizeEnum(value, color, "value"), /unknown enum constructor/);
  }
});

test("enum lifting requires an ordinal in the admitted constructor table", () => {
  for (const index of [-1, 2, 0.5, NaN, "0", "constructor", "map"]) {
    assert.throws(() => enumValue(color, index), /enum.*out of range/);
  }
});

const string = nativeDescriptor("string");
const taggedChoice = objectBoundary(
  "Example.Choice",
  [objectConstructor("Example.Choice.left", {
    objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
  }, [nativeField("payload", string, { tag: "object", index: 0 })])],
  { tag: "variant", cases: [
    { kind: "left", payload: "value", value: { tag: "string" } },
  ] },
);

test("runner defaults follow the chosen constructor spelling and payload", () => {
  assert.equal(interfaceInputTag(color), "SELECT");
  const enumDefault = defaultValueForType(color);
  assert.equal(enumDefault, "red");
  assert.equal(normalizeEnum(enumDefault, color, "input"), 0);

  assert.equal(interfaceInputTag(taggedChoice), "TEXTAREA");
  assert.deepEqual(constructorTemplate(taggedChoice, 0), {
    kind: "left", value: "",
  });
  assert.equal(defaultValueForType(taggedChoice).kind, "left");
});

test("runner templates use constructor order and explicit record mappings", () => {
  const ctors = [
    { name: "Example.Tree.empty", representation: "immediate", fields: [] },
    { name: "Example.Tree.leaf", representation: "object",
      storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
      fields: [nativeField("payload", string, { tag: "object", index: 0 })] },
    { name: "Example.Tree.branch", representation: "object",
      storage: { objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0 },
      fields: [
        nativeField("left", string, { tag: "object", index: 0 }),
        nativeField("right", string, { tag: "object", index: 1 }),
      ] },
  ];
  const tree = objectBoundary("Example.Tree", ctors, {
    tag: "variant",
    cases: [
      { kind: "empty", payload: "none" },
      { kind: "leaf", payload: "value", value: { tag: "string" } },
      { kind: "branch", payload: "fields", fields: [
        { key: "left", path: [0], value: { tag: "string" } },
        { key: "right", path: [1], value: { tag: "string" } },
      ] },
    ],
  });
  const before = structuredClone(tree);
  assert.deepEqual(defaultValueForType(tree), { kind: "empty" });
  assert.deepEqual(constructorTemplate(tree, 0), { kind: "empty" });
  assert.deepEqual(constructorTemplate(tree, 1), { kind: "leaf", value: "" });
  assert.deepEqual(constructorTemplate(tree, 2), {
    kind: "branch", fields: { left: "", right: "" },
  });
  assert.deepEqual(tree, before);
});
