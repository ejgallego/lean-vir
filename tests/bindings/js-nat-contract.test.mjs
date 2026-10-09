/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";

const { "js.nat": ofNat, "js.nat.value": toNat } = createJsValueHostBindings();
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

test("Nat providers preserve zero and arbitrary-precision nonnegative bigints", () => {
  for (const value of [0n, 3n, maxSafe + 2n, 2n ** 256n + 123n]) {
    const encoded = ofNat(value);
    assert.equal(typeof encoded, "bigint");
    assert.equal(encoded, value);
    assert.equal(toNat(encoded), value);
  }
});

test("Nat decoding rejects JavaScript numbers and negative bigints", () => {
  for (const value of [0, 3, Number.MAX_SAFE_INTEGER, -1n]) {
    assert.throws(() => toNat(value), /js\.nat\.value expects/u);
  }
});

test("Nat bigint resources are not raw JSON wire numbers", () => {
  for (const value of [0n, 3n, maxSafe + 2n]) {
    assert.throws(() => JSON.stringify({ line: ofNat(value) }), TypeError);
  }
});
