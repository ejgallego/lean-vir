/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { scriptSafeJson } from "../../scripts/report-render-utils.mjs";

test("scriptSafeJson prevents inline script termination and preserves JSON data", () => {
  const value = {
    markup: "</script><script>alert('unexpected')</script>",
    separators: "before\u2028middle\u2029after",
  };
  const encoded = scriptSafeJson(value);

  assert.equal(encoded.includes("<"), false);
  assert.equal(encoded.includes("\u2028"), false);
  assert.equal(encoded.includes("\u2029"), false);
  assert.match(encoded, /\\u003c\/script>/);
  assert.match(encoded, /\\u2028/);
  assert.match(encoded, /\\u2029/);
  assert.deepEqual(JSON.parse(encoded), value);
});
