/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { validateInterfaceType } from "../../web/src/runtime/interface-manifest.js";
import { normalizeCustomInductive } from "../../web/src/runtime/vir-value-normalizers.js";

const scalarType = { type: "Unit", interfaceTag: INTERFACE_TAG.UNIT };
function objectField(name, index) {
  return { name, type: scalarType, layout: { kind: "object", index } };
}
const nilCtor = {
  name: "Example.nil",
  tag: 0,
  jsName: "nil",
  objectFieldCount: 0,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [],
};
const unaryCtor = {
  name: "Example.unary",
  tag: 1,
  jsName: "unary",
  objectFieldCount: 1,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [objectField("arg1", 0)],
};
const pairCtor = {
  name: "Example.pair",
  tag: 2,
  jsName: "pair",
  objectFieldCount: 2,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [
    objectField("left", 0),
    objectField("right", 1),
  ],
};
const type = Object.freeze(validateInterfaceType({
  type: "Example", kind: "customInductive", name: "Example",
  interfaceTag: INTERFACE_TAG.CUSTOM_INDUCTIVE,
  constructors: Object.freeze([nilCtor, unaryCtor, pairCtor]),
}));
const expectedShapes =
  '{ kind: "nil" } | { kind: "unary", value } | { kind: "pair", fields: { left, right } }';

assert.deepEqual(normalizeCustomInductive({ kind: "nil" }, type, "value"), {
  index: 0,
  ctor: nilCtor,
  fields: {},
});
assert.deepEqual(normalizeCustomInductive({ kind: "unary", value: 1 }, type, "value"), {
  index: 1,
  ctor: unaryCtor,
  fields: { arg1: 1 },
});
assert.deepEqual(
  normalizeCustomInductive({ kind: "pair", fields: { left: 1, right: 2 } }, type, "value"),
  { index: 2, ctor: pairCtor, fields: { left: 1, right: 2 } },
);

// Exercise repeated normalization against the same admitted descriptor.
assert.deepEqual(normalizeCustomInductive({ kind: "unary", value: 3 }, type, "repeat"), {
  index: 1,
  ctor: unaryCtor,
  fields: { arg1: 3 },
});
assert.throws(
  () => normalizeCustomInductive({ kind: "Example.unary", value: 1 }, type, "value"),
  /unknown custom inductive constructor Example\.unary/,
);

assert.throws(
  () => normalizeCustomInductive(null, type, "value"),
  new RegExp(`value must be a custom inductive object; expected ${escapeRegExp(expectedShapes)}`),
);
assert.throws(
  () => normalizeCustomInductive({}, type, "value"),
  new RegExp(`value must specify custom inductive kind; expected ${escapeRegExp(expectedShapes)}`),
);
assert.throws(
  () => normalizeCustomInductive({ kind: "missing" }, type, "value"),
  new RegExp(`value has unknown custom inductive constructor missing; expected ${escapeRegExp(expectedShapes)}`),
);
assert.throws(
  () => normalizeCustomInductive({ kind: "nil", value: null }, type, "value"),
  /value\.value is not supported for this custom inductive constructor shape; expected \{ kind: "nil" \}/,
);
assert.throws(
  () => normalizeCustomInductive({ kind: "unary" }, type, "value"),
  /value\.unary is missing value; expected \{ kind: "unary", value \}/,
);
assert.throws(
  () => normalizeCustomInductive({ kind: "pair", fields: { left: 1, extra: 2 } }, type, "value"),
  /value\.pair\.extra is not a constructor field; expected \{ kind: "pair", fields: \{ left, right \} \}/,
);
assert.throws(
  () => normalizeCustomInductive({ kind: "pair", fields: { left: 1 } }, type, "value"),
  /value\.pair\.right is missing; expected \{ kind: "pair", fields: \{ left, right \} \}/,
);

// Independently admitted descriptors have independent normalization plans.
const replacementCtor = { ...nilCtor, name: "Example.empty", jsName: "empty" };
const replacementType = Object.freeze(validateInterfaceType({
  ...type, constructors: Object.freeze([replacementCtor]),
}));
assert.equal(normalizeCustomInductive({ kind: "empty" }, replacementType, "replacement").ctor, replacementCtor);
assert.throws(
  () => normalizeCustomInductive({ kind: "nil" }, replacementType, "replacement"),
  /replacement has unknown custom inductive constructor nil; expected \{ kind: "empty" \}/,
);
assert.equal(normalizeCustomInductive({ kind: "nil" }, type, "original").ctor, nilCtor);

// Malformed metadata is rejected at admission, before any value conversion.
const malformed = structuredClone(type);
malformed.constructors[2].fields[0].layout.index = 5;
assert.throws(() => validateInterfaceType(malformed), /outside objectFieldCount/);

console.log("custom inductive normalization smoke ok");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
