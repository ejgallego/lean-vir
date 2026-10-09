/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { compileConstructorValueInterface } from "../../benchmarks/harness/constructor-value-interface-prototype.mjs";

const objectType = (declaration, constructors) => ({
  type: { tag: "leanObject" }, metadata: { declaration, constructors },
});
const unit = objectType("Unit", [
  { name: "Unit.unit", representation: "immediate", fields: [] },
]);
const native = objectType("Option", [
  { name: "Option.none", representation: "immediate", fields: [] },
  { name: "Option.some", representation: "object",
    storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
    fields: [{ name: "val", type: unit, location: { tag: "object", index: 0 } }] },
]);
const view = (absent, present) => ({ tag: "variant", cases: [
  { kind: absent, payload: "none" }, { kind: present, payload: "value", value: { tag: "unit" } },
] });

test("one native descriptor binds distinct strict constructor views", () => {
  const standard = compileConstructorValueInterface(native, view("none", "some"));
  const alternate = compileConstructorValueInterface(native, view("absent", "present"));
  assert.equal(standard.select({ kind: "some", value: undefined }), 1);
  assert.equal(alternate.select({ kind: "present", value: undefined }), 1);
  assert.throws(() => standard.select({ kind: "present", value: undefined }), /unknown/);
  assert.throws(() => alternate.select({ kind: "some", value: undefined }), /unknown/);
  assert.deepEqual(standard.build(1, undefined), { kind: "some", value: undefined });
  assert.deepEqual(alternate.build(0), { kind: "absent" });
});

test("some Unit requires the value property and stays distinct from none", () => {
  const plan = compileConstructorValueInterface(native, view("none", "some"));
  assert.throws(() => plan.cases[1].read({ kind: "some" }, "argument"), /missing value/);
  assert.equal(plan.cases[1].read({ kind: "some", value: undefined }, "argument"), undefined);
  assert.throws(() => plan.cases[0].read({ kind: "none", value: null }, "argument"), /not supported/);
  assert.throws(() => plan.build(-1), /out of range/);
});

test("bound spellings remain stable after a caller edits the view", () => {
  const specification = view("none", "some");
  const plan = compileConstructorValueInterface(native, specification);
  specification.cases[1].kind = "changed";
  assert.equal(plan.select({ kind: "some", value: undefined }), 1);
  assert.deepEqual(plan.build(1, undefined), { kind: "some", value: undefined });
});

test("binding rejects incomplete constructor or field mappings", () => {
  assert.throws(() => compileConstructorValueInterface(native, { tag: "variant", cases: [] }), /every native constructor/);
  assert.throws(() => compileConstructorValueInterface(native, view("same", "same")), /unique/);
  assert.throws(() => compileConstructorValueInterface(native, { tag: "variant", cases: [
    { kind: "none", payload: "none" }, { kind: "some", payload: "fields", fields: [] },
  ] }), /every native field/);
});

test("field mappings choose keys independently of native names", () => {
  const descriptor = objectType("Pair", [{
    name: "Pair.mk", representation: "object",
    storage: { objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0 },
    fields: [
      { name: "a", type: { type: { tag: "nat" } }, location: { tag: "object", index: 0 } },
      { name: "b", type: { type: { tag: "nat" } }, location: { tag: "object", index: 1 } },
    ],
  }]);
  const plan = compileConstructorValueInterface(descriptor, { tag: "variant", cases: [{
    kind: "pair", payload: "fields", fields: [
      { key: "__proto__", path: [1], value: { tag: "bigint" } },
      { key: "first", path: [0], value: { tag: "bigint" } },
    ],
  }] });
  const result = plan.build(0, [42n, 43n]);
  assert.equal(Object.getPrototypeOf(result.fields), Object.prototype);
  assert.equal(Object.hasOwn(result.fields, "__proto__"), true);
  assert.equal(result.fields.__proto__, 43n);
  assert.equal(result.fields.first, 42n);
  assert.equal(plan.cases[0].read(result, "argument"), result.fields);
});
