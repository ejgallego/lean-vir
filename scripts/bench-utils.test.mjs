/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNonnegativeInt,
  parsePositiveInt,
  summarizePairedSamples,
} from "./bench-utils.mjs";

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

test("nonnegative integer parsing accepts zero and rejects unsafe values", () => {
  assert.equal(parseNonnegativeInt("0", "--warmups"), 0);
  assert.equal(parseNonnegativeInt("42", "--warmups"), 42);
  assert.throws(
    () => parseNonnegativeInt(String(Number.MAX_SAFE_INTEGER + 1), "--warmups"),
    /safe nonnegative integer/,
  );
});

test("paired summaries retain measured order and per-round ratios", () => {
  assert.deepEqual(summarizePairedSamples([20, 40], [10, 80], 10), {
    rounds: [
      {
        round: 1,
        sequence: "control-candidate",
        controlMs: 2,
        candidateMs: 1,
        ratio: 0.5,
      },
      {
        round: 2,
        sequence: "candidate-control",
        controlMs: 4,
        candidateMs: 8,
        ratio: 2,
      },
    ],
    medianRatio: 1.25,
    geometricMeanRatio: 1,
    slowerRounds: 1,
    equalRounds: 0,
    fasterRounds: 1,
  });
});
