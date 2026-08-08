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

function normalizeCandidateResult(result, candidateId) {
  if (Number.isFinite(result)) {
    return { checksum: result, phases: {} };
  }
  if (result === null || typeof result !== "object" || Array.isArray(result) ||
      !Number.isFinite(result.checksum)) {
    throw new TypeError(`benchmark candidate ${candidateId} returned a non-finite checksum`);
  }
  if (result.phases === undefined) {
    return { checksum: result.checksum, phases: {} };
  }
  if (result.phases === null || typeof result.phases !== "object" ||
      Array.isArray(result.phases)) {
    throw new TypeError(`benchmark candidate ${candidateId} phases must be an object`);
  }
  const phases = {};
  for (const [name, value] of Object.entries(result.phases)) {
    if (name === "") {
      throw new TypeError(`benchmark candidate ${candidateId} phase names must be nonempty`);
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(
        `benchmark candidate ${candidateId} phase ${name} must be finite and nonnegative`,
      );
    }
    phases[name] = value;
  }
  return { checksum: result.checksum, phases };
}

/**
 * Interleave fixed-size candidate batches and compare their numeric checksums.
 * Each available candidate supplies `run(context)`, which returns either a
 * finite numeric checksum or `{ checksum, phases }`, where every named phase
 * is finite and nonnegative. The sampler adds its independently measured wall
 * time as `totalMs` when the candidate omits that phase. Optional `setup()` and
 * `teardown(context)` calls run outside the timed window. Warm-up results
 * participate in checksum and phase-schema stability checks, but only measured
 * timings are retained. The legacy wall timings remain in `samples` and
 * `medianMs`; named timings are in `phaseSamples` and `phaseMedians`.
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
    if (candidate.setup !== undefined && typeof candidate.setup !== "function") {
      throw new TypeError(`benchmark candidate ${candidate.id} setup must be a function`);
    }
    if (candidate.teardown !== undefined && typeof candidate.teardown !== "function") {
      throw new TypeError(`benchmark candidate ${candidate.id} teardown must be a function`);
    }
    return {
      candidate,
      hasChecksum: false,
      phaseNames: null,
      state: {
        id: candidate.id,
        label: candidate.label ?? candidate.id,
        available,
        stable: available,
        checksum: null,
        samples: [],
        medianMs: null,
        phaseSamples: [],
        phaseMedians: {},
        errors: [],
      },
    };
  });
  const availableEntries = entries.filter(({ state }) => state.available);

  function invoke(entry, measured) {
    let context;
    try {
      context = entry.candidate.setup?.();
    } catch (error) {
      const message = errorMessage(error);
      if (!entry.state.errors.includes(message)) entry.state.errors.push(message);
      entry.state.stable = false;
      return;
    }

    const started = now();
    let observation;
    let elapsedMs;
    try {
      observation = normalizeCandidateResult(entry.candidate.run(context), entry.state.id);
    } catch (error) {
      const message = errorMessage(error);
      if (!entry.state.errors.includes(message)) entry.state.errors.push(message);
      entry.state.stable = false;
    } finally {
      elapsedMs = Math.max(0, now() - started);
      try {
        entry.candidate.teardown?.(context);
      } catch (error) {
        const message = errorMessage(error);
        if (!entry.state.errors.includes(message)) entry.state.errors.push(message);
        entry.state.stable = false;
      }
    }

    if (entry.state.errors.length !== 0) return;
    const phases = { ...observation.phases };
    phases.totalMs ??= elapsedMs;
    const phaseNames = Object.keys(phases).sort();
    if (entry.phaseNames !== null &&
        (phaseNames.length !== entry.phaseNames.length ||
          phaseNames.some((name, index) => name !== entry.phaseNames[index]))) {
      const message = `benchmark candidate ${entry.state.id} changed phase names from ` +
        `${entry.phaseNames.join(", ")} to ${phaseNames.join(", ")}`;
      if (!entry.state.errors.includes(message)) entry.state.errors.push(message);
      entry.state.stable = false;
      return;
    }
    entry.phaseNames ??= phaseNames;
    const checksum = observation.checksum;
    if (entry.hasChecksum && entry.state.checksum !== checksum) entry.state.stable = false;
    if (!entry.hasChecksum) {
      entry.state.checksum = checksum;
      entry.hasChecksum = true;
    }
    if (measured) {
      entry.state.samples.push(elapsedMs);
      entry.state.phaseSamples.push(phases);
    }
  }

  for (let round = -warmupRounds; round < sampleRounds; round += 1) {
    const measured = round >= 0;
    const rotation = measured ? round % Math.max(1, availableEntries.length) : 0;
    for (let offset = 0; offset < availableEntries.length; offset += 1) {
      invoke(availableEntries[(offset + rotation) % availableEntries.length], measured);
    }
  }

  for (const entry of entries) {
    if (entry.state.samples.length > 0) {
      entry.state.medianMs = median(entry.state.samples);
      entry.state.phaseMedians = Object.fromEntries(entry.phaseNames.map((name) => [
        name,
        median(entry.state.phaseSamples.map((sample) => sample[name])),
      ]));
    }
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
