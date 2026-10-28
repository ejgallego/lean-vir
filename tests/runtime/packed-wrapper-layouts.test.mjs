/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { validateBoundaryInterface } from "../../web/src/runtime/value-interfaces.js";
import { objectArgumentSupported, objectResultSupported } from "../../web/src/runtime/object-abi.js";
import {
  booleanBoundary, identityConstructor, nativeField, objectBoundary,
  objectConstructor, primitiveBoundary,
} from "../support/interface-fixtures.mjs";

const wrapped = pair => objectBoundary("Wrapper", [
  identityConstructor("Wrapper.mk", { name: "value", type: pair.native }),
], { tag: "record", fields: [{ key: "value", path: [0], value: pair.value }] });

function container(pair, location) {
  return objectBoundary("Container", [objectConstructor("Container.mk", {
    objectFieldCount: 1, usizeFieldCount: location.tag === "usize" ? 1 : 0,
    scalarByteSize: location.tag === "scalar" ? location.size : 0,
  }, [
    nativeField("label", primitiveBoundary("string", "string").native, { tag: "object", index: 0 }),
    nativeField("wrapped", pair.native, location),
  ])], { tag: "record", fields: [
    { key: "label", path: [0], value: { tag: "string" } },
    { key: "wrapped", path: [1], value: pair.value },
  ] });
}

for (const [name, inner, location] of [
  ["UInt32", primitiveBoundary("unsigned", "number", { width: 32 }), { tag: "scalar", offset: 0, size: 4 }],
  ["Bool", booleanBoundary(), { tag: "scalar", offset: 0, size: 1 }],
  ["USize", primitiveBoundary("unsigned", "number", { width: "usize" }), { tag: "usize", index: 0 }],
]) {
  test(`${name} identity wrappers retain packed conversion operations`, () => {
    for (const wrapper of [wrapped(inner), wrapped(wrapped(inner))]) {
      const pair = container(wrapper, location);
      assert.equal(validateBoundaryInterface(pair), pair);
      assert.equal(objectArgumentSupported(pair), true);
      assert.equal(objectResultSupported(pair), true);
      assert.equal(objectArgumentSupported(wrapper), true, "standalone identity wrappers still convert");
    }
    const direct = validateBoundaryInterface(container(inner, location));
    assert.equal(objectArgumentSupported(direct), true);
    assert.equal(objectResultSupported(direct), true);
  });
}

test("identity storage admission still rejects mismatched widths and non-scalar payloads", () => {
  const scalar = wrapped(primitiveBoundary("unsigned", "number", { width: 32 }));
  assert.throws(() => validateBoundaryInterface(container(scalar, { tag: "scalar", offset: 0, size: 8 })), /does not support this scalar layout/);
  assert.throws(() => validateBoundaryInterface(container(scalar, { tag: "usize", index: 0 })), /must be USize/);
  const nat = wrapped(primitiveBoundary("nat", "bigint"));
  assert.throws(() => validateBoundaryInterface(container(nat, { tag: "scalar", offset: 0, size: 4 })), /does not support this scalar layout/);
});

test("flattening a wrapper mapping does not imply packed conversion capability", () => {
  const pair = container(wrapped(primitiveBoundary("unsigned", "number", { width: 32 })), { tag: "scalar", offset: 0, size: 4 });
  pair.value.fields[1] = { key: "wrapped", path: [1, 0], value: { tag: "number" } };
  validateBoundaryInterface(pair);
  assert.equal(objectArgumentSupported(pair), false);
  assert.equal(objectResultSupported(pair), false);
});
