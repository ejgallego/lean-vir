/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  enumValue,
  normalizeCustomInductive,
  normalizeEnum,
  normalizeTaggedUnion,
} from "../../web/src/runtime/vir-value-normalizers.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import {
  customInductiveConstructorAt,
  taggedUnionConstructorAt,
} from "../../web/src/runtime/vir-codec.js";
import {
  constructorTemplate,
  defaultValueForType,
  interfaceInputTag,
} from "../../web/app/pages/interface-inputs.js";

const type = {
  type: "Example.Color",
  interfaceTag: INTERFACE_TAG.SIMPLE_ENUM,
  kind: "simpleEnum",
  constructors: [
    { name: "Example.Color.red", jsName: "red", tag: 0 },
    { name: "Example.Color.constructor", jsName: "constructor", tag: 1 },
  ],
};

const stringType = { type: "String", interfaceTag: INTERFACE_TAG.STRING };
const taggedType = {
  type: "Example.Choice",
  name: "Example.Choice",
  interfaceTag: INTERFACE_TAG.TAGGED_UNION,
  kind: "taggedUnion",
  constructors: [{
    name: "Example.Choice.left", jsName: "left", tag: 0,
    type: stringType,
    objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
    layout: { kind: "object", index: 0 },
  }],
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

test("enum lifting requires a numeric constructor ordinal in range", () => {
  for (const index of [-1, 2, 0.5, NaN, "0", "constructor", "map"]) {
    assert.throws(() => enumValue(type, index), /enum.*index.*out of range/);
  }
});

test("tagged-union kinds use JS spelling without Lean-name aliases", () => {
  const value = { kind: "left", value: "payload" };
  assert.deepEqual(normalizeTaggedUnion(value, taggedType, "value"), {
    index: 0, ctor: taggedType.constructors[0], payload: "payload",
  });
  assert.throws(
    () => normalizeTaggedUnion({ ...value, kind: "Example.Choice.left" }, taggedType, "value"),
    /unknown tagged-union constructor/,
  );
});

test("constructor result ordinals remain numeric and within the admitted table", () => {
  const customType = {
    type: "Example.Empty", name: "Example.Empty", kind: "customInductive",
    interfaceTag: INTERFACE_TAG.CUSTOM_INDUCTIVE,
    constructors: [{ name: "Example.Empty.empty", jsName: "empty", tag: 0,
      objectFieldCount: 0, usizeFieldCount: 0, scalarByteSize: 0, fields: [] }],
  };
  for (const [lookup, descriptor] of [
    [taggedUnionConstructorAt, taggedType],
    [customInductiveConstructorAt, customType],
  ]) {
    assert.equal(lookup(descriptor, 0, "result"), descriptor.constructors[0]);
    for (const ordinal of [-1, 1, 0.5, NaN, "0"]) {
      assert.throws(() => lookup(descriptor, ordinal, "result"), /constructor index is out of range/);
    }
  }
});

test("browser input defaults use the same constructor names as normalization", () => {
  assert.equal(interfaceInputTag(type), "SELECT");
  const enumDefault = defaultValueForType(type);
  assert.equal(enumDefault, "red");
  assert.equal(normalizeEnum(enumDefault, type, "input"), 0);

  const taggedDefault = defaultValueForType(taggedType);
  assert.deepEqual(taggedDefault, { kind: "left", value: "" });
  assert.equal(normalizeTaggedUnion(taggedDefault, taggedType, "input").index, 0);

  const customType = {
    type: "Example.Tree", name: "Example.Tree",
    interfaceTag: INTERFACE_TAG.CUSTOM_INDUCTIVE, kind: "customInductive",
    constructors: [{
      name: "Example.Tree.empty", jsName: "empty", tag: 0,
      objectFieldCount: 0, usizeFieldCount: 0, scalarByteSize: 0, fields: [],
    }],
  };
  const customDefault = defaultValueForType(customType);
  assert.deepEqual(customDefault, { kind: "empty" });
  assert.equal(normalizeCustomInductive(customDefault, customType, "input").index, 0);
});

test("selected custom constructors produce canonical editable templates", () => {
  const field = (name, index) => ({
    name, type: stringType, layout: { kind: "object", index },
  });
  const ctors = [
    { name: "Example.Tree.empty", jsName: "empty", tag: 0, fields: [] },
    { name: "Example.Tree.leaf", jsName: "leaf", tag: 1, fields: [field("payload", 0)] },
    { name: "Example.Tree.branch", jsName: "branch", tag: 2, fields: [field("left", 0), field("right", 1)] },
  ].map((ctor) => ({ ...ctor,
    objectFieldCount: ctor.fields.length, usizeFieldCount: 0, scalarByteSize: 0,
  }));
  const custom = {
    type: "Example.Tree", name: "Example.Tree",
    interfaceTag: INTERFACE_TAG.CUSTOM_INDUCTIVE, kind: "customInductive",
    constructors: ctors,
  };
  const before = structuredClone(custom);
  const expected = [
    { kind: "empty" }, { kind: "leaf", value: "" },
    { kind: "branch", fields: { left: "", right: "" } },
  ];
  for (const [index, ctor] of ctors.entries()) {
    const value = constructorTemplate(custom, ctor);
    assert.deepEqual(value, expected[index]);
    assert.equal(normalizeCustomInductive(value, custom, "input").index, index);
  }
  assert.deepEqual(custom, before);
});
