/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { sampleBenchmarkCandidates } from "./bench-differential.mjs";

function fakeClock() {
  let current = 0;
  return {
    advance: (milliseconds) => {
      current += milliseconds;
    },
    now: () => current,
  };
}

test("rotates measured candidate order and excludes warm-up timings", () => {
  const clock = fakeClock();
  const order = [];
  const calls = { left: 0, right: 0 };
  const run = (id, measuredMs, warmupMs) => () => {
    order.push(id);
    clock.advance(calls[id]++ === 0 ? warmupMs : measuredMs);
    return 7;
  };

  const result = sampleBenchmarkCandidates({
    candidates: [
      { id: "left", run: run("left", 1, 100) },
      { id: "right", run: run("right", 2, 200) },
    ],
    warmupRounds: 1,
    sampleRounds: 3,
    now: clock.now,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(order, [
    "left", "right",
    "left", "right",
    "right", "left",
    "left", "right",
  ]);
  assert.deepEqual(result.candidates.left.samples, [1, 1, 1]);
  assert.deepEqual(result.candidates.right.samples, [2, 2, 2]);
  assert.equal(result.candidates.left.medianMs, 1);
  assert.equal(result.candidates.right.medianMs, 2);
});

test("rejects stable checksum disagreement", () => {
  const result = sampleBenchmarkCandidates({
    candidates: [
      { id: "left", run: () => 1 },
      { id: "right", run: () => 2 },
    ],
    warmupRounds: 0,
    sampleRounds: 2,
  });

  assert.equal(result.passed, false);
  assert.equal(result.parity, false);
  assert.equal(result.candidates.left.stable, true);
  assert.equal(result.candidates.right.stable, true);
});

test("rejects checksum instability, including a warm-up disagreement", () => {
  let leftCalls = 0;
  const result = sampleBenchmarkCandidates({
    candidates: [
      { id: "left", run: () => ++leftCalls },
      { id: "right", run: () => 1 },
    ],
    warmupRounds: 1,
    sampleRounds: 1,
  });

  assert.equal(result.passed, false);
  assert.equal(result.candidates.left.stable, false);
  assert.equal(result.candidates.right.stable, true);
});

test("records candidate errors and cannot pass", () => {
  const result = sampleBenchmarkCandidates({
    candidates: [
      { id: "good", run: () => 1 },
      { id: "broken", run: () => { throw new RangeError("synthetic overflow"); } },
    ],
    warmupRounds: 0,
    sampleRounds: 2,
  });

  assert.equal(result.passed, false);
  assert.equal(result.candidates.broken.stable, false);
  assert.deepEqual(result.candidates.broken.errors, ["RangeError: synthetic overflow"]);
  assert.deepEqual(result.candidates.broken.samples, []);
});

test("does not run unavailable candidates and cannot pass", () => {
  let unavailableCalls = 0;
  const result = sampleBenchmarkCandidates({
    candidates: [
      { id: "ready", run: () => 1 },
      { id: "missing", available: false, run: () => { unavailableCalls += 1; } },
    ],
    warmupRounds: 1,
    sampleRounds: 2,
  });

  assert.equal(result.passed, false);
  assert.equal(result.candidates.missing.available, false);
  assert.equal(result.candidates.missing.stable, false);
  assert.deepEqual(result.candidates.missing.samples, []);
  assert.equal(unavailableCalls, 0);
});

test("validates sampler configuration and finite checksums", () => {
  const invalidCases = [
    [
      { candidates: [{ id: "only", run: () => 1 }], warmupRounds: -1 },
      /warmupRounds must be an integer >= 0/,
    ],
    [
      { candidates: [{ id: "only", run: () => 1 }], sampleRounds: 0 },
      /sampleRounds must be an integer >= 1/,
    ],
    [
      { candidates: [{ id: "same", run: () => 1 }, { id: "same", run: () => 1 }] },
      /duplicate benchmark candidate id same/,
    ],
    [
      { candidates: [{ id: "missing" }] },
      /benchmark candidate missing requires run/,
    ],
    [
      { candidates: [{ id: "invalid", available: "yes", run: () => 1 }] },
      /benchmark candidate invalid availability must be boolean/,
    ],
  ];
  for (const [options, expected] of invalidCases) {
    assert.throws(() => sampleBenchmarkCandidates(options), expected);
  }

  const nonFinite = sampleBenchmarkCandidates({
    candidates: [
      { id: "finite", run: () => 1 },
      { id: "infinite", run: () => Number.POSITIVE_INFINITY },
    ],
    warmupRounds: 0,
    sampleRounds: 1,
  });
  assert.equal(nonFinite.passed, false);
  assert.deepEqual(nonFinite.candidates.infinite.errors, [
    "TypeError: benchmark candidate infinite returned a non-finite checksum",
  ]);
});
