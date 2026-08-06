/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { normalizeCustomInductive } from "../../web/src/runtime/vir-value-normalizers.js";

const scalarType = { type: "Unit", interfaceTag: 0 };
const nilCtor = {
  name: "Example.nil",
  jsName: "nil",
  objectFieldCount: 0,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [],
};
const unaryCtor = {
  name: "Example.unary",
  jsName: "unary",
  objectFieldCount: 1,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [{ name: "arg1", type: scalarType, layout: { kind: "object", index: 0 } }],
};
const pairCtor = {
  name: "Example.pair",
  jsName: "pair",
  objectFieldCount: 2,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [
    { name: "left", type: scalarType, layout: { kind: "object", index: 0 } },
    { name: "right", type: scalarType, layout: { kind: "object", index: 1 } },
  ],
};
const type = { constructors: [nilCtor, unaryCtor, pairCtor] };
const expectedShapes =
  '{ kind: "nil" } | { kind: "unary", value } | { kind: "pair", fields: { left, right } }';

assert.deepEqual(normalizeCustomInductive({ kind: "nil" }, type, "value"), {
  index: 0,
  ctor: nilCtor,
  fields: {},
});
assert.deepEqual(normalizeCustomInductive({ kind: "Example.unary", value: 1 }, type, "value"), {
  index: 1,
  ctor: unaryCtor,
  fields: { arg1: 1 },
});
assert.deepEqual(
  normalizeCustomInductive({ kind: "pair", fields: { left: 1, right: 2 } }, type, "value"),
  { index: 2, ctor: pairCtor, fields: { left: 1, right: 2 } },
);

// Exercise the cached path independently of the first plan construction.
assert.deepEqual(normalizeCustomInductive({ kind: "unary", value: 3 }, type, "repeat"), {
  index: 1,
  ctor: unaryCtor,
  fields: { arg1: 3 },
});

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

// Replacing the constructor array invalidates the plan without retaining the
// old constructor lookup.
const replacementCtor = { ...nilCtor, name: "Example.empty", jsName: "empty" };
type.constructors = [replacementCtor];
assert.equal(normalizeCustomInductive({ kind: "empty" }, type, "replacement").ctor, replacementCtor);
assert.throws(
  () => normalizeCustomInductive({ kind: "nil" }, type, "replacement"),
  /replacement has unknown custom inductive constructor nil; expected \{ kind: "empty" \}/,
);

console.log("custom inductive normalization smoke ok");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
