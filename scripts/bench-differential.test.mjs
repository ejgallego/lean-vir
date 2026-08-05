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

test("keeps candidate setup and teardown outside the timed window", () => {
  const clock = fakeClock();
  const events = [];
  const result = sampleBenchmarkCandidates({
    candidates: [{
      id: "phased",
      setup: () => {
        events.push("setup");
        clock.advance(100);
        return 41;
      },
      run: (context) => {
        events.push(`run:${context}`);
        clock.advance(3);
        return context + 1;
      },
      teardown: (context) => {
        events.push(`teardown:${context}`);
        clock.advance(200);
      },
    }],
    warmupRounds: 0,
    sampleRounds: 2,
    now: clock.now,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.candidates.phased.samples, [3, 3]);
  assert.deepEqual(events, [
    "setup", "run:41", "teardown:41",
    "setup", "run:41", "teardown:41",
  ]);
});

test("tears down failed candidates and reports setup or teardown errors", () => {
  let teardownCalls = 0;
  const runFailure = sampleBenchmarkCandidates({
    candidates: [{
      id: "run-failure",
      setup: () => "context",
      run: () => { throw new Error("run failed"); },
      teardown: () => { teardownCalls += 1; },
    }],
    warmupRounds: 0,
    sampleRounds: 1,
  });
  assert.equal(runFailure.passed, false);
  assert.equal(teardownCalls, 1);
  assert.deepEqual(runFailure.candidates["run-failure"].errors, ["Error: run failed"]);

  const setupFailure = sampleBenchmarkCandidates({
    candidates: [{
      id: "setup-failure",
      setup: () => { throw new Error("setup failed"); },
      run: () => 1,
    }],
    warmupRounds: 0,
    sampleRounds: 1,
  });
  assert.deepEqual(setupFailure.candidates["setup-failure"].errors, ["Error: setup failed"]);

  const teardownFailure = sampleBenchmarkCandidates({
    candidates: [{
      id: "teardown-failure",
      run: () => 1,
      teardown: () => { throw new Error("teardown failed"); },
    }],
    warmupRounds: 0,
    sampleRounds: 1,
  });
  assert.deepEqual(teardownFailure.candidates["teardown-failure"].errors, ["Error: teardown failed"]);
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
    [
      { candidates: [{ id: "invalid-setup", run: () => 1, setup: true }] },
      /benchmark candidate invalid-setup setup must be a function/,
    ],
    [
      { candidates: [{ id: "invalid-teardown", run: () => 1, teardown: true }] },
      /benchmark candidate invalid-teardown teardown must be a function/,
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
