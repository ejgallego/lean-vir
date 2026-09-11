/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";
import { createInfoviewHostBindings } from "../../web/src/host/vir-infoview-host-bindings.js";

const { "js.nat": ofNat, "js.nat.value": toNat } = createJsValueHostBindings();
const { "infoview.documentPosition": documentPosition } = createInfoviewHostBindings();
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

test("documentPosition converts safe bigint coordinates to exact JSON numbers", () => {
  for (const [line, character] of [[0n, maxSafe], [maxSafe, 3n]]) {
    const position = documentPosition("file:///test.lean", "test.lean",
      ofNat(line), ofNat(character), "location");
    assert.deepEqual(position, {
      uri: "file:///test.lean", fileName: "test.lean",
      line: Number(line), character: Number(character), label: "location",
    });
    assert.equal(BigInt(position.line), line);
    assert.equal(BigInt(position.character), character);
    assert.deepEqual(JSON.parse(JSON.stringify(position)), position);
  }
});

test("documentPosition rejects unsafe coordinates in either field", () => {
  for (const value of [-1n, maxSafe + 1n, maxSafe + 2n,
    -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    for (const [line, character] of [[value, 0n], [0n, value]]) {
      assert.throws(() => documentPosition("file:///test.lean", "test.lean",
        line, character, "location"), /non-negative safe-integer coordinates/u);
    }
  }
});
