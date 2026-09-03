/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { rpcJsonFromValue } from "../../web/src/rpc-json.js";

test("ordinary RPC JSON maps to the recursive Lean ABI", () => {
  assert.deepEqual(rpcJsonFromValue(null), { kind: "null" });
  assert.deepEqual(rpcJsonFromValue(true), { kind: "bool", value: true });
  assert.deepEqual(rpcJsonFromValue(["a", false]), {
    kind: "array",
    value: [
      { kind: "string", value: "a" },
      { kind: "bool", value: false },
    ],
  });
  assert.deepEqual(rpcJsonFromValue({ title: "typed", count: 2 }), {
    kind: "object",
    value: [
      { fst: "title", snd: { kind: "string", value: "typed" } },
      {
        fst: "count",
        snd: {
          kind: "number",
          fields: { mantissa: "2", exponent: 0 },
        },
      },
    ],
  });
});

test("RPC JSON conversion preserves finite decimal numbers", () => {
  for (const [value, expected] of [
    [1.25, { mantissa: "125", exponent: 2 }],
    [1e21, { mantissa: "1000000000000000000000", exponent: 0 }],
    [1e-7, { mantissa: "1", exponent: 7 }],
    [-0, { mantissa: "0", exponent: 0 }],
  ]) {
    assert.deepEqual(rpcJsonFromValue(value), {
      kind: "number",
      fields: expected,
    });
  }
});

test("RPC JSON conversion rejects values outside JSON", () => {
  assert.throws(() => rpcJsonFromValue(Number.NaN), /non-finite number/);
  assert.throws(
    () => rpcJsonFromValue({ nested: undefined }),
    /RPC result\.nested contains unsupported undefined/,
  );
});
