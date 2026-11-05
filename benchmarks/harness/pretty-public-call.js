/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0 (see LICENSE). */
// Browser workload adapter. The caller supplies the actual client formatter,
// two loader-owned programs and the existing differential sampler.
export async function screenPrettyPublicCalls({
  corpus, programs, format, sample, repeats = null, targetMs = 20,
  warmups = 2, rounds = 8, reverse = false, now = () => performance.now(),
}) {
  if (!Array.isArray(corpus) || corpus.length === 0) throw new Error("native corpus is empty");
  if (!Number.isInteger(warmups) || warmups < 0 || !Number.isInteger(rounds) || rounds < 2 || rounds % 2) {
    throw new Error("use nonnegative warmups and an even number of measured rounds >= 2");
  }
  if (repeats !== null && (!Number.isInteger(repeats) || repeats < 1 || repeats > 512)) {
    throw new Error("repeats must be 1..512");
  }
  if (!Number.isFinite(targetMs) || targetMs <= 0) throw new Error("targetMs must be positive");
  const observations = [];
  const candidates = ["control", "candidate"].map(id => ({ id, program: programs[id] }));
  if (reverse) candidates.reverse();
  const expected = corpus.map(c => c.result.segments.map(({ text, tags }) => ({ text, tags: tags.map(BigInt) })));
  const projected = segments => segments.map(({ text, tags }) => ({
    text,
    tags: tags.map(tag => {
      if (typeof tag !== "bigint") throw new Error("formatter tags must be BigInts");
      return tag.toString();
    }),
  }));
  function checkSegments(segments, index) {
    const wanted = expected[index];
    if (segments.length !== wanted.length || segments.some((segment, i) =>
      segment.text !== wanted[i].text || segment.tags.length !== wanted[i].tags.length ||
      segment.tags.some((tag, j) => tag !== wanted[i].tags[j]))) {
      const error = new Error("PrettyM output differs from the native oracle");
      error.actual = projected(segments);
      throw error;
    }
  }
  function check(outputs) {
    outputs.forEach(checkSegments);
    return outputs.map(projected);
  }
  const callCorpus = program => corpus.map(c => format(program, c.format, c.width, c.indent));
  let checkedOutputs = {};
  function batch(candidate, count, phase) {
    const record = { side: candidate.id, phase, repeats: count, calls: 0, elapsedMs: null, ok: false };
    observations.push(record);
    const outputs = new Array(corpus.length);
    let checksum = 0;
    const started = now();
    try {
      for (let pass = 0; pass < count; pass++) {
        for (let i = 0; i < corpus.length; i++) {
          const c = corpus[i];
          const segments = format(candidate.program, c.format, c.width, c.indent);
          outputs[i] = segments; // Only the last corpus is retained, not every result.
          record.calls++;
          checkSegments(segments, i); // Exact comparison cost is inside the clock.
          for (const segment of segments) {
            checksum = (Math.imul(checksum, 31) + segment.text.length + segment.tags.length) >>> 0;
          }
        }
      }
    } finally {
      record.elapsedMs = now() - started;
    }
    // Every result was checked above; reporting/serialization is outside the clock.
    checkedOutputs[candidate.id] = outputs.map(projected);
    if (!(record.elapsedMs > 0)) throw new Error("timing resolution is insufficient");
    record.ok = true;
    record.checksum = checksum;
    return { ok: true, value: checksum, timings: { totalMs: record.elapsedMs } };
  }
  let failure = null;
  let sampled = null;
  let calibration = null;
  try {
    for (const candidate of candidates) checkedOutputs[candidate.id] = check(callCorpus(candidate.program));
    if (repeats === null) {
      // Exercise both actual call paths before control-only batch calibration.
      for (const candidate of candidates) batch(candidate, 1, "prewarmup");
      repeats = 1;
      for (let attempt = 0; attempt < 4; attempt++) {
        const observation = batch(candidates.find(c => c.id === "control"), repeats, "calibration");
        calibration = { repeats, elapsedMs: observation.timings.totalMs, targetMs,
          targetMet: observation.timings.totalMs >= targetMs };
        if (calibration.targetMet || repeats === 512 || attempt === 3) break;
        repeats = Math.min(512, Math.max(repeats + 1,
          Math.ceil(repeats * targetMs / observation.timings.totalMs)));
      }
    }
    let invocation = 0;
    sampled = await sample({
      candidates, scenarios: [{}], warmup: warmups, samples: rounds,
      batchTargetMs: 0, maxBatchIterations: 1, batchMemoryBudgetBytes: 0,
      invoke: (_scenario, candidate) => {
        const phase = invocation++ < warmups * candidates.length ? "warmup" : "measured";
        return batch(candidate, repeats, phase);
      },
      canonicalize: value => value,
      measureOutput: value => value,
      buildScenario: (_scenario, _index, results, _output, parity) => ({ results, parity }),
    });
    for (const candidate of candidates) checkedOutputs[candidate.id] = check(callCorpus(candidate.program));
  } catch (error) {
    failure = { name: error?.name ?? "Error", message: String(error?.message ?? error),
      stack: error?.stack, actual: error?.actual };
  }
  return {
    passed: failure === null && sampled?.scenarios[0].parity === true,
    error: failure, repeats, callsPerPass: corpus.length, warmups, rounds, calibration,
    order: candidates.map(c => c.id), observations, checkedOutputs,
    scope: "A/A public formatting calls plus exact result checks; not startup, DOM or pure interpreter time",
  };
}
