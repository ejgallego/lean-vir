/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { performance } from "node:perf_hooks";

import { median } from "./bench-utils.mjs";

function requireRoundCount(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Interleave fixed-size candidate batches and compare their numeric checksums.
 * Each available candidate supplies `run()`, which must return a finite number.
 * Warm-up results participate in stability checks, but only measured timings
 * are retained in each candidate's `samples` array and `medianMs` summary.
 */
export function sampleBenchmarkCandidates(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("benchmark sampler options are required");
  }
  if (!Array.isArray(options.candidates) || options.candidates.length === 0) {
    throw new TypeError("benchmark sampler requires candidates");
  }

  const warmupRounds = requireRoundCount(options.warmupRounds ?? 1, "warmupRounds", 0);
  const sampleRounds = requireRoundCount(options.sampleRounds ?? 7, "sampleRounds", 1);
  const now = options.now ?? (() => performance.now());
  if (typeof now !== "function") throw new TypeError("now must be a function");

  const ids = new Set();
  const entries = options.candidates.map((candidate) => {
    if (candidate === null || typeof candidate !== "object" ||
        typeof candidate.id !== "string" || candidate.id === "") {
      throw new TypeError("every benchmark candidate requires a nonempty id");
    }
    if (ids.has(candidate.id)) throw new TypeError(`duplicate benchmark candidate id ${candidate.id}`);
    ids.add(candidate.id);

    const available = candidate.available ?? true;
    if (typeof available !== "boolean") {
      throw new TypeError(`benchmark candidate ${candidate.id} availability must be boolean`);
    }
    if (available && typeof candidate.run !== "function") {
      throw new TypeError(`benchmark candidate ${candidate.id} requires run`);
    }
    return {
      candidate,
      hasChecksum: false,
      state: {
        id: candidate.id,
        label: candidate.label ?? candidate.id,
        available,
        stable: available,
        checksum: null,
        samples: [],
        medianMs: null,
        errors: [],
      },
    };
  });
  const availableEntries = entries.filter(({ state }) => state.available);

  function invoke(entry, measured) {
    const started = now();
    let checksum;
    try {
      checksum = entry.candidate.run();
      if (!Number.isFinite(checksum)) {
        throw new TypeError(`benchmark candidate ${entry.state.id} returned a non-finite checksum`);
      }
    } catch (error) {
      const message = errorMessage(error);
      if (!entry.state.errors.includes(message)) entry.state.errors.push(message);
      entry.state.stable = false;
      return;
    }

    const elapsedMs = Math.max(0, now() - started);
    if (entry.hasChecksum && entry.state.checksum !== checksum) entry.state.stable = false;
    if (!entry.hasChecksum) {
      entry.state.checksum = checksum;
      entry.hasChecksum = true;
    }
    if (measured) entry.state.samples.push(elapsedMs);
  }

  for (let round = -warmupRounds; round < sampleRounds; round += 1) {
    const measured = round >= 0;
    const rotation = measured ? round % Math.max(1, availableEntries.length) : 0;
    for (let offset = 0; offset < availableEntries.length; offset += 1) {
      invoke(availableEntries[(offset + rotation) % availableEntries.length], measured);
    }
  }

  for (const entry of entries) {
    if (entry.state.samples.length > 0) entry.state.medianMs = median(entry.state.samples);
  }

  const complete = entries.every((entry) =>
    entry.state.available && entry.hasChecksum && entry.state.errors.length === 0 &&
      entry.state.samples.length === sampleRounds,
  );
  const stable = entries.every(({ state }) => state.stable);
  const checksum = entries[0].state.checksum;
  const parity = complete && stable && entries.every(({ state }) => state.checksum === checksum);

  return {
    passed: parity,
    parity,
    candidates: Object.fromEntries(entries.map(({ state }) => [state.id, state])),
  };
}
