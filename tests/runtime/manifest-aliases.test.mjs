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
      entry: `${name}.entry`, id: `${name}Id`, jsName: `${name}Js`,
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

for (const first of ["entry", "id", "jsName"]) {
  for (const second of ["entry", "id", "jsName"]) {
    test(`export aliases cannot collide across ${first} and ${second}`, () => {
      const value = manifest();
      value.exports[0][first] = "Collision";
      value.exports[1][second] = "Collision";
      assert.throws(() => validateInterfaceManifest(value), /duplicates another interface export alias "Collision"/);
      value.exports.reverse();
      assert.throws(() => validateInterfaceManifest(value), /duplicates another interface export alias "Collision"/);
    });
  }
}

test("aliases for the same export may share a spelling, including object property names", () => {
  for (const alias of ["shared", "constructor", "__proto__", "toString"]) {
    const value = manifest();
    Object.assign(value.exports[0], { entry: alias, id: alias, jsName: alias });
    assert.equal(validateInterfaceManifest(value), value);
  }
});

test("absent and empty optional aliases do not reserve callable names", () => {
  const value = manifest();
  for (const entry of value.exports) {
    delete entry.id;
    entry.jsName = "";
  }
  assert.equal(validateInterfaceManifest(value), value);
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
