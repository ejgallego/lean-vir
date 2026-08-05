/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { parsePositiveInt } from "./bench-utils.mjs";

test("positive integer parsing rejects values outside the safe integer range", () => {
  assert.equal(parsePositiveInt("42", "--iterations"), 42);
  assert.throws(
    () => parsePositiveInt(String(Number.MAX_SAFE_INTEGER + 1), "--iterations"),
    /safe positive integer/,
  );
  assert.throws(
    () => parsePositiveInt("9".repeat(400), "--iterations"),
    /safe positive integer/,
  );
});
