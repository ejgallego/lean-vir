/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERFACE_MANIFEST_VERSION,
  validateInterfaceManifest,
} from "../../web/src/runtime/interface-manifest.js";

function manifest() {
  return {
    version: INTERFACE_MANIFEST_VERSION,
    metadata: {},
    exports: ["a", "b"].map((name, index) => ({
      entry: `${name}.entry`,
      nameKey: index === 0 ? "s61/" : "s62/",
      args: [], result: { type: "Nat", interfaceTag: 0 },
      effect: "pure", startup: false,
    })),
  };
}

function hostImport(slot, symbol) {
  return {
    slot,
    name: `Example.host${slot}`,
    nameKey: slot === 0 ? "s4578616d706c65/s686f737430/" : "s4578616d706c65/s686f737431/",
    source: "Example.lean",
    target: `test.host${slot}`,
    boundary: "hostResource",
    symbol,
    arity: 2,
    erasedPrefixArgs: 0,
    args: [{ name: "value", type: { type: "Nat", interfaceTag: 0 } }],
    result: { type: "Nat", interfaceTag: 0 },
    effect: "runtime",
  };
}

test("distinct dotted and underscored entries coexist", () => {
  const value = manifest();
  value.exports[0].entry = "Duplicate.entry";
  value.exports[1].entry = "Duplicate_entry";
  assert.equal(validateInterfaceManifest(value), value);
});

test("duplicate entries reject independently of structural identities", () => {
  const value = manifest();
  value.exports[1].entry = value.exports[0].entry;
  assert.throws(() => validateInterfaceManifest(value), /entry duplicates another interface export/);
});

for (const field of ["id", "jsName"]) {
  for (const spelling of ["legacy", "", undefined]) {
    test(`retired export ${field} rejects even when ${String(spelling)}`, () => {
      const value = manifest();
      value.exports[0][field] = spelling;
      assert.throws(() => validateInterfaceManifest(value), /is retired; use the full Lean entry name/);
    });
  }
}

test("entry names may be object property names", () => {
  for (const entry of ["constructor", "__proto__", "toString"]) {
    const value = manifest();
    value.exports[0].entry = entry;
    assert.equal(validateInterfaceManifest(value), value);
  }
});

test("host import symbols and their boxed spellings share one native namespace", () => {
  for (const symbols of [
    ["collision", "collision___boxed"],
    ["collision___boxed", "collision"],
  ]) {
    const value = manifest();
    value.hostImports = symbols.map((symbol, slot) => hostImport(slot, symbol));
    assert.throws(
      () => validateInterfaceManifest(value),
      /symbol alias "collision___boxed" belongs to more than one host import/,
    );
  }

  const distinct = manifest();
  distinct.hostImports = [hostImport(0, "native_first"), hostImport(1, "native_second")];
  for (const entry of distinct.hostImports) entry.name = "same display name";
  assert.equal(validateInterfaceManifest(distinct), distinct);
});
