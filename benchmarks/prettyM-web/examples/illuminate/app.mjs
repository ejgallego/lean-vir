// @ts-check

const artifactBase = globalThis.__benchmarkExampleContext?.artifactBaseUrl;
if (!(artifactBase instanceof URL)) {
  throw new Error("Illuminate requires the benchmark example context");
}
const typedVirEntry = "Illuminate.Animation.Vir.replayTraceTyped";
const backendColors = {
  js: "#74a9ff",
  vir: "#f0a35e",
  native: "#d879c6",
};
const phaseDefinitions = [
  { id: "totalMs", label: "Total" },
  { id: "prepareMs", label: "Prepare" },
  { id: "executeMs", label: "Execute" },
  { id: "decodeMs", label: "Decode" },
];

const stateEl = /** @type {HTMLElement} */ (
  document.querySelector("#app-state")
);
const progressEl = /** @type {HTMLElement} */ (
  document.querySelector("#app-progress")
);
const backendList = /** @type {HTMLElement} */ (
  document.querySelector("#backend-list")
);
const reportList = /** @type {HTMLElement} */ (
  document.querySelector("#report-list")
);
const studyButtons = Array.from(document.querySelectorAll("[data-study]"));
const openDashboard = /** @type {HTMLButtonElement} */ (
  document.querySelector("#open-dashboard")
);
const downloadResults = /** @type {HTMLButtonElement} */ (
  document.querySelector("#download-results")
);
const loadResults = /** @type {HTMLButtonElement} */ (
  document.querySelector("#load-results")
);
const loadInput = /** @type {HTMLInputElement} */ (
  document.querySelector("#load-results-input")
);
const clearResults = /** @type {HTMLButtonElement} */ (
  document.querySelector("#clear-results")
);

/** @type {{ id: string, label: string, status: string, invoke?: (animation: *, events: *[]) => * }[]} */
const backends = [
  { id: "js", label: "JavaScript oracle", status: "ready" },
  { id: "vir", label: "Lean · VIR typed", status: "loading" },
  { id: "native", label: "Lean · FIR native", status: "loading" },
];

let latestReport = null;
let running = false;
let artifactProvenance = null;
let examples = [];

function renderBuildNotes(receipt) {
  const notes = /** @type {HTMLElement} */ (
    document.querySelector("#build-notes")
  );
  const native = receipt.inputs.selection ?? receipt.inputs.native;
  const vir = receipt.inputs.vir;
  const source = receipt.source;
  notes.replaceChildren();
  [
    `Illuminate ${source.commit.slice(0, 8)}${
      source.dirty ? " + local changes" : ""
    }`,
    `VIR ${vir.sourceCommit.slice(0, 8)}${
      vir.sourceDirty ? " · manifest records dirty" : ""
    }`,
    `FIR${receipt.inputs.selection ? " selection" : ""} ${native.fir.commit.slice(0, 8)} · ${
      native.browserAdapter.apiVersion
    } · ${native.wasm.byteLength.toLocaleString()} Wasm bytes`,
  ].forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    notes.appendChild(item);
  });
}

function renderArtifactSetNotes(manifest) {
  const notes = /** @type {HTMLElement} */ (
    document.querySelector("#build-notes")
  );
  notes.replaceChildren();
  const values = [
    `Artifact set ${manifest.setId}`,
    ...Object.entries(manifest.components ?? {}).map(
      ([id, component]) =>
        `${id} · Lean ${component.lean?.version ?? "not recorded"}`,
    ),
  ];
  values.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    notes.appendChild(item);
  });
}

async function loadArtifactProvenance() {
  const setResponse = await fetch(new URL("ARTIFACT_SET.json", artifactBase));
  if (setResponse.ok) {
    const manifest = await setResponse.json();
    if (
      manifest.schemaVersion !== 2 ||
      manifest.kind !== "browser-benchmarks/artifact-set" ||
      manifest.example?.id !== "illuminate"
    ) {
      throw new Error("unsupported Illuminate artifact-set manifest");
    }
    return manifest;
  }
  const rehearsalResponse = await fetch(
    new URL("REHEARSAL.json", artifactBase),
  );
  if (!rehearsalResponse.ok) {
    throw new Error("failed to load Illuminate artifact provenance");
  }
  return rehearsalResponse.json();
}

function setState(label, state, detail) {
  stateEl.textContent = label;
  stateEl.dataset.state = state;
  progressEl.textContent = detail;
}

function backend(id) {
  const selected = backends.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`unknown Illuminate backend ${id}`);
  return selected;
}

function selectedBackendIds() {
  return Array.from(
    backendList.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((input) => /** @type {HTMLInputElement} */ (input).value);
}

function renderBackends() {
  const previous = new Set(selectedBackendIds());
  backendList.replaceChildren();
  backends.forEach((candidate) => {
    const label = document.createElement("label");
    label.className = "backend-card";
    label.dataset.backend = candidate.id;
    label.style.setProperty(
      "--backend-color",
      backendColors[candidate.id] || "#86b5e8",
    );
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = candidate.id;
    input.checked = previous.size === 0 || previous.has(candidate.id);
    input.disabled = running || candidate.status !== "ready";
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = candidate.label;
    const id = document.createElement("code");
    id.textContent = candidate.id;
    const capability = document.createElement("small");
    capability.textContent =
      "PlayerAnimation × events → normalized frame actions";
    const status = document.createElement("em");
    status.textContent = candidate.status;
    status.dataset.state = candidate.status;
    text.append(name, id, capability);
    label.append(input, text, status);
    backendList.appendChild(label);
  });
}

function readCount(id, minimum, maximum) {
  const input = /** @type {HTMLInputElement} */ (
    document.querySelector(`#${id}`)
  );
  const value = Number(input.value);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${id} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function signature(value) {
  return JSON.stringify(canonicalize(value));
}

function quantile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function distribution(values) {
  const median = quantile(values, 0.5);
  return {
    median,
    mad: quantile(
      values.map((value) => Math.abs(value - median)),
      0.5,
    ),
    p95: quantile(values, 0.95),
    minimum: values.length === 0 ? 0 : Math.min(...values),
    maximum: values.length === 0 ? 0 : Math.max(...values),
    samples: values.length,
  };
}

function summarizeTimings(samples) {
  return Object.fromEntries(
    phaseDefinitions.map((phase) => [
      phase.id,
      distribution(samples.map((sample) => Number(sample[phase.id] || 0))),
    ]),
  );
}

function makeEvents(animation, count) {
  if (count === 0) return [];
  return [
    {
      kind: "playTo",
      frame: animation.totalFrames - 1,
      loopAfter: true,
    },
    ...Array.from({ length: count - 1 }, (_, index) => ({
      kind: "tick",
      timestamp: 0.125 + index * (1000 / 60),
    })),
  ];
}

function materializeSelectionAction(animation, action) {
  const segment = animation.segments[action.segment];
  if (!segment) {
    throw new Error(`FIR selected unknown segment ${action.segment}`);
  }
  const values = segment.params[action.localFrame] ?? [];
  return {
    ...action,
    updates: segment.pmap.flatMap((binding, index) =>
      values[index] === undefined
        ? []
        : [{ e: binding.e, a: binding.a, v: values[index] }],
    ),
  };
}

function replaySelectionTrace(adapter, animation, events) {
  const created = adapter.createPlayer(animation);
  if (!created.ok) return created;
  const actions = [materializeSelectionAction(animation, created.action)];
  const dispatches = [];
  try {
    for (const event of events) {
      const dispatched =
        event.kind === "tick"
          ? adapter.dispatchTick(created.player, event.timestamp)
          : adapter.dispatch(created.player, event);
      dispatches.push(dispatched);
      if (!dispatched.ok) return dispatched;
      actions.push(materializeSelectionAction(animation, dispatched.action));
    }
    return {
      ok: true,
      actions,
      timings: {
        creation: created.timings,
        dispatches: dispatches.map((dispatch) => dispatch.timings),
      },
    };
  } finally {
    adapter.disposePlayer(created.player);
  }
}

// Adapted from Illuminate's Apache-2.0 `scripts/test-player-traces.mjs` oracle.
class LegacyPlayerOracle {
  constructor(data) {
    this.data = data;
    this.frame = 0;
    this.currentStep = 0;
    this.startTime = null;
    this.pauseFrame = 0;
    this.playing = false;
    this.waitingForClick = false;
    this.advancePending = false;
    this.finished = false;
    this.currentSegment = -1;
    this.targetFrame = null;
    this.loopAfterTarget = false;
  }

  playback() {
    if (this.waitingForClick) return "waiting";
    if (this.finished) return "finished";
    if (!this.playing) return "paused";
    if (this.advancePending) return "finishingLoop";
    if (this.targetFrame !== null) return "playing";
    if (this.data.steps[this.currentStep]?.loop) return "looping";
    return "playing";
  }

  action() {
    this.frame = globalThis.animClampFrame(this.frame, this.data.totalFrames);
    const segmentValue = globalThis.animFindSegment(
      this.data.segments,
      this.frame,
    );
    const segment = this.data.segments.indexOf(segmentValue);
    const localFrame = this.frame - segmentValue.sf;
    const segmentChanged = segment !== this.currentSegment;
    this.currentSegment = segment;
    const values = segmentValue.params[localFrame] ?? [];
    const updates = segmentValue.pmap.flatMap((binding, index) =>
      values[index] === undefined
        ? []
        : [{ e: binding.e, a: binding.a, v: values[index] }],
    );
    return {
      frame: this.frame,
      step: this.currentStep,
      segment,
      localFrame,
      segmentChanged,
      updates,
      playback: this.playback(),
    };
  }

  advance() {
    if (this.waitingForClick) {
      this.waitingForClick = false;
      this.startTime = null;
      this.playing = true;
      this.finished = false;
      this.targetFrame = null;
      this.loopAfterTarget = false;
      return;
    }
    if (this.playing) {
      const step = this.data.steps[this.currentStep];
      if (step?.loop && this.currentStep + 1 < this.data.steps.length) {
        this.advancePending = true;
      } else {
        this.playing = false;
        this.pauseFrame = this.frame;
        this.targetFrame = null;
        this.loopAfterTarget = false;
      }
      return;
    }
    if (this.pauseFrame >= this.data.totalFrames - 1) {
      this.pauseFrame = 0;
      this.currentStep = 0;
      this.frame = 0;
    }
    this.playing = true;
    this.startTime = null;
    this.finished = false;
    this.targetFrame = null;
    this.loopAfterTarget = false;
  }

  pause() {
    this.startTime = null;
    this.pauseFrame = this.frame;
    this.playing = false;
    this.waitingForClick = false;
    this.advancePending = false;
    this.finished = false;
    this.targetFrame = null;
    this.loopAfterTarget = false;
  }

  seek(requested) {
    this.playing = false;
    this.waitingForClick = false;
    this.advancePending = false;
    this.frame = globalThis.animClampFrame(requested, this.data.totalFrames);
    this.pauseFrame = this.frame;
    this.currentStep = globalThis.animFindCurrentStep(
      this.data.steps,
      this.frame,
    );
    this.finished = this.frame === this.data.totalFrames - 1;
    this.targetFrame = null;
    this.loopAfterTarget = false;
  }

  loopAt(requested) {
    const frame = globalThis.animClampFrame(requested, this.data.totalFrames);
    const step = globalThis.animFindCurrentStep(this.data.steps, frame);
    const stepInfo = this.data.steps[step];
    if (!stepInfo?.loop) {
      this.seek(frame);
      return;
    }
    this.frame = stepInfo.frame;
    this.currentStep = step;
    this.startTime = null;
    this.pauseFrame = stepInfo.frame;
    this.playing = true;
    this.waitingForClick = false;
    this.advancePending = false;
    this.finished = false;
    this.targetFrame = null;
    this.loopAfterTarget = false;
  }

  playTo(requested, loopAfter) {
    const target = globalThis.animClampFrame(requested, this.data.totalFrames);
    if (target === this.frame) {
      if (loopAfter) this.loopAt(target);
      else this.pause();
      return;
    }
    this.currentStep = globalThis.animFindCurrentStep(
      this.data.steps,
      this.frame,
    );
    this.startTime = null;
    this.pauseFrame = this.frame;
    this.playing = true;
    this.waitingForClick = false;
    this.advancePending = false;
    this.finished = false;
    this.targetFrame = target;
    this.loopAfterTarget = loopAfter;
  }

  tick(timestamp) {
    if (!this.playing || this.waitingForClick) return;
    if (this.targetFrame !== null) {
      if (this.startTime === null) this.startTime = timestamp;
      const elapsed = globalThis.animComputeFrame(
        this.startTime,
        timestamp,
        this.data.fps,
        0,
      );
      const target = this.targetFrame;
      const forward = target >= this.pauseFrame;
      this.frame = forward
        ? Math.min(target, this.pauseFrame + elapsed)
        : this.pauseFrame - Math.min(elapsed, this.pauseFrame - target);
      this.currentStep = globalThis.animFindCurrentStep(
        this.data.steps,
        this.frame,
      );
      if (this.frame === target) {
        const loopAfter = this.loopAfterTarget;
        this.startTime = null;
        this.pauseFrame = this.frame;
        this.playing = false;
        this.targetFrame = null;
        this.loopAfterTarget = false;
        if (loopAfter) this.loopAt(this.frame);
      }
      return;
    }
    if (this.startTime === null) this.startTime = timestamp;
    let frame = globalThis.animComputeFrame(
      this.startTime,
      timestamp,
      this.data.fps,
      this.pauseFrame,
    );
    const stepInfo = this.data.steps[this.currentStep];
    let isLooping = Boolean(stepInfo?.loop);
    if (isLooping) {
      const stepStart = stepInfo.frame;
      const stepEnd = globalThis.animFindStepEnd(
        this.data.steps,
        this.currentStep,
        this.data.totalFrames,
      );
      const loop = globalThis.animWrapLoop(frame, stepStart, stepEnd);
      if (loop.didCycle) {
        if (this.advancePending) {
          this.advancePending = false;
          if (this.currentStep + 1 < this.data.steps.length) {
            this.currentStep += 1;
            frame = this.data.steps[this.currentStep].frame;
            this.pauseFrame = frame;
            this.startTime = null;
            isLooping = false;
          }
        } else {
          frame = loop.wrapped;
          this.startTime = timestamp;
          this.pauseFrame = stepStart;
        }
      }
    }
    if (frame >= this.data.totalFrames) {
      frame = this.data.totalFrames - 1;
      this.pauseFrame = frame;
      this.playing = false;
      this.finished = true;
    }
    if (!isLooping) {
      const pause = globalThis.animCheckPauseSteps(
        this.data.steps,
        this.currentStep,
        frame,
      );
      if (pause !== null) {
        frame = pause.pauseAtFrame;
        this.pauseFrame = frame;
        this.waitingForClick = true;
        this.currentStep = pause.pauseAtStep;
        this.frame = frame;
        return;
      }
      this.currentStep = globalThis.animFindCurrentStep(this.data.steps, frame);
    }
    this.frame = frame;
  }

  dispatch(event) {
    if (event.kind === "advance") this.advance();
    else if (event.kind === "pause") this.pause();
    else if (event.kind === "seek") this.seek(event.frame);
    else if (event.kind === "playTo") this.playTo(event.frame, event.loopAfter);
    else if (event.kind === "loopAt") this.loopAt(event.frame);
    else if (event.kind === "tick") this.tick(event.timestamp);
    else throw new Error(`unknown oracle event: ${event.kind}`);
    return this.action();
  }
}

function invokeJavaScript(animation, events) {
  const totalStarted = performance.now();
  const prepareStarted = performance.now();
  const oracle = new LegacyPlayerOracle(animation);
  const prepareMs = performance.now() - prepareStarted;
  const executeStarted = performance.now();
  const actions = [
    oracle.action(),
    ...events.map((event) => oracle.dispatch(event)),
  ];
  const executeMs = performance.now() - executeStarted;
  return {
    value: { ok: true, actions },
    timings: {
      prepareMs,
      executeMs,
      decodeMs: 0,
      totalMs: performance.now() - totalStarted,
    },
    rawTimings: { prepareMs, executeMs },
  };
}

function normalizeNativeTimings(result, totalMs) {
  if (result.timings?.creation) {
    const creation = result.timings.creation;
    const dispatches = result.timings.dispatches || [];
    return {
      prepareMs:
        Number(creation.instantiateMs || 0) +
        Number(creation.projectMs || 0) +
        Number(creation.animationEncodeMs || creation.selectionEncodeMs || 0) +
        Number(creation.stateSlotMs || 0) +
        dispatches.reduce(
          (sum, timing) => sum + Number(timing.encodeMs || 0),
          0,
        ),
      executeMs:
        Number(creation.executeMs || 0) +
        dispatches.reduce(
          (sum, timing) => sum + Number(timing.executeMs || 0),
          0,
        ),
      decodeMs:
        Number(creation.decodeMs || 0) +
        dispatches.reduce(
          (sum, timing) => sum + Number(timing.decodeMs || 0),
          0,
        ),
      totalMs,
    };
  }
  return {
    prepareMs: Number(result.timings?.prepareMs || 0),
    executeMs: Number(result.timings?.executeMs || 0),
    decodeMs: Number(result.timings?.decodeMs || 0),
    totalMs,
  };
}

function trend(points, backendId, phase) {
  const values = points
    .map((point) => ({
      size: Number(point.size),
      time: Number(point.backends[backendId]?.summary[phase]?.median),
    }))
    .filter((sample) => sample.size > 0 && sample.time > 0);
  if (values.length < 2) return { growth: null, logLogSlope: null };
  const first = values[0];
  const last = values[values.length - 1];
  return {
    growth: last.time / first.time,
    logLogSlope:
      Math.log(last.time / first.time) / Math.log(last.size / first.size),
  };
}

async function samplePoint(
  workload,
  eventCount,
  selected,
  warmup,
  samples,
  pointIndex,
) {
  const events = makeEvents(workload.animation, eventCount);
  const results = Object.fromEntries(
    selected.map((candidate) => [
      candidate.id,
      { timings: [], rawTimings: [], signature: null, value: null, errors: [] },
    ]),
  );
  for (let round = -warmup; round < samples; round += 1) {
    for (let offset = 0; offset < selected.length; offset += 1) {
      const candidate =
        selected[(offset + pointIndex + Math.max(0, round)) % selected.length];
      const result = results[candidate.id];
      try {
        const observation = candidate.invoke(workload.animation, events);
        const currentSignature = signature(observation.value);
        if (
          result.signature !== null &&
          result.signature !== currentSignature
        ) {
          throw new Error("backend result changed between samples");
        }
        result.signature = currentSignature;
        result.value = observation.value;
        if (round >= 0) {
          result.timings.push(observation.timings);
          result.rawTimings.push(observation.rawTimings);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!result.errors.includes(message)) result.errors.push(message);
      }
    }
  }
  const signatures = selected.map(
    (candidate) => results[candidate.id].signature,
  );
  const parity =
    signatures.every((value) => value !== null && value === signatures[0]) &&
    selected.every((candidate) => results[candidate.id].errors.length === 0);
  const actionCount =
    results[selected[0].id].value?.ok === true
      ? results[selected[0].id].value.actions.length
      : 0;
  return {
    workloadId: workload.id,
    workloadLabel: workload.title,
    size: eventCount,
    sizeLabel: String(eventCount),
    parity,
    input: {
      eventCount,
      totalFrames: workload.animation.totalFrames,
      segmentCount: workload.animation.segments.length,
      stepCount: workload.animation.steps.length,
      jsonBytes: new TextEncoder().encode(JSON.stringify(workload.animation))
        .byteLength,
    },
    output: { actionCount },
    table: {
      events: eventCount,
      frames: workload.animation.totalFrames,
      segments: workload.animation.segments.length,
      actions: actionCount,
    },
    backends: Object.fromEntries(
      selected.map((candidate) => {
        const result = results[candidate.id];
        return [
          candidate.id,
          {
            signature: result.signature,
            errors: result.errors,
            timings: result.timings,
            rawTimings: result.rawTimings,
            summary: summarizeTimings(result.timings),
            batchIterations: 1,
            batchLimitReason: null,
          },
        ];
      }),
    ),
  };
}

async function runComparison(kind, options = {}) {
  const selectedIds = Array.isArray(options.backends)
    ? options.backends.slice()
    : selectedBackendIds();
  if (selectedIds.length < 2) {
    throw new Error("select at least two ready backends for comparison");
  }
  const selected = selectedIds.map(backend);
  const warmup = readCount("warmup", 0, 20);
  const samples = readCount("samples", 1, 100);
  const workloadSpecs = Array.isArray(options.data?.workloads)
    ? options.data.workloads
    : [
    {
      id: "small",
      title: "Pause-driven slide show",
      eventCounts: kind === "quick" ? [0, 1, 10] : [0, 1, 10, 30, 60, 120],
    },
    {
      id: "parameter-heavy",
      title: "Morphing arrows and final loop",
      eventCounts: kind === "quick" ? [0, 1, 10] : [0, 1, 10, 30],
    },
      ];
  const workloads = workloadSpecs.map((spec) => {
    const example = examples.find(
      (candidate) => candidate.title === spec.title,
    );
    if (!example) throw new Error(`missing Illuminate example ${spec.title}`);
    return { ...spec, animation: example.data };
  });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let completed = 0;
  const total = workloads.reduce(
    (sum, workload) => sum + workload.eventCounts.length,
    0,
  );
  const dimensions = [];
  let pointIndex = 0;
  for (const workload of workloads) {
    const points = [];
    for (const eventCount of workload.eventCounts) {
      progressEl.textContent = `${workload.title} · ${eventCount} events · ${completed}/${total}`;
      points.push(
        await samplePoint(
          workload,
          eventCount,
          selected,
          warmup,
          samples,
          pointIndex,
        ),
      );
      pointIndex += 1;
      completed += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const phaseTrends = Object.fromEntries(
      phaseDefinitions.map((phase) => [
        phase.id,
        Object.fromEntries(
          selected.map((candidate) => [
            candidate.id,
            trend(points, candidate.id, phase.id),
          ]),
        ),
      ]),
    );
    dimensions.push({
      id: workload.id,
      label: workload.title,
      points,
      trends: phaseTrends.executeMs,
      phaseTrends,
    });
  }
  const allPoints = dimensions.flatMap((dimension) => dimension.points);
  const mismatches = allPoints.filter((point) => !point.parity);
  const benchmarkMs = performance.now() - started;
  return {
    schemaVersion: 1,
    kind: "scaling",
    workload: {
      id: "illuminate-player",
      contract: "illuminate-player/replay-trace/v1",
      input: "PlayerAnimation × List PlayerEvent",
      output: "Except String (Array FrameAction)",
    },
    presentation: {
      title: "Illuminate player trace scaling report",
      ariaLabel: "Illuminate player trace scaling report",
      pointNoun: "trace points",
      defaultPhase: "totalMs",
      note: "Charts show interleaved warmed medians. Total is independently measured browser wall time; prepare, execute, and decode retain each backend's real boundary. This local rehearsal is not an accepted performance record.",
      pointColumns: [
        { key: "events", label: "Events" },
        { key: "frames", label: "Frames" },
        { key: "segments", label: "Segments" },
        { key: "actions", label: "Actions" },
      ],
    },
    startedAt,
    generatedAt: new Date().toISOString(),
    benchmarkMs,
    durationMs: benchmarkMs,
    warmup,
    samples,
    batchTargetMs: 0,
    batchMemoryBudgetBytes: 0,
    timingPhases: phaseDefinitions,
    backendIds: selectedIds,
    scenarioCount: allPoints.length,
    parityCount: allPoints.length - mismatches.length,
    passed: mismatches.length === 0,
    unavailable: [],
    mismatches: mismatches.map((point) => ({
      workloadId: point.workloadId,
      workloadLabel: point.workloadLabel,
      eventCount: point.size,
      errors: Object.fromEntries(
        selected.map((candidate) => [
          candidate.id,
          point.backends[candidate.id].errors,
        ]),
      ),
    })),
    summaries: Object.fromEntries(
      selected.map((candidate) => [
        candidate.id,
        {
          id: candidate.id,
          label: candidate.label,
          status: candidate.status,
        },
      ]),
    ),
    dimensions,
    provenance: {
      artifactSet:
        artifactProvenance.kind === "browser-benchmarks/artifact-set"
          ? artifactProvenance
          : null,
      rehearsal:
        artifactProvenance.kind === "illuminate-player/local-rehearsal"
          ? artifactProvenance
          : null,
      acceptedMeasurement: false,
    },
  };
}

function renderReport(report) {
  reportList.replaceChildren();
  const card = document.createElement("article");
  card.className = "report-card";
  card.dataset.passed = String(report.passed);
  const heading = document.createElement("h3");
  heading.textContent = "Illuminate trace scaling";
  const summary = document.createElement("strong");
  summary.textContent = `${report.parityCount}/${report.scenarioCount} points agree`;
  const detail = document.createElement("p");
  detail.textContent = `${report.samples} measured rounds · local rehearsal`;
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "View report";
  open.addEventListener("click", () =>
    globalThis.PrettyBenchDashboard.openReport("scaling"),
  );
  card.append(heading, summary, detail, open);
  reportList.appendChild(card);
  openDashboard.disabled = false;
  downloadResults.disabled = false;
  clearResults.disabled = false;
}

function clearReport() {
  latestReport = null;
  globalThis.PrettyBenchDashboard.reset();
  reportList.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = "No Illuminate benchmark has run yet.";
  reportList.appendChild(empty);
  openDashboard.disabled = true;
  downloadResults.disabled = true;
  clearResults.disabled = true;
}

function setRunning(value) {
  running = value;
  studyButtons.forEach((button) => {
    /** @type {HTMLButtonElement} */ (button).disabled = value;
  });
  renderBackends();
}

function studySelection(kind, options) {
  if (options?.test || options?.benchmark) return options;
  const variant = globalThis.__benchmarkExampleContext?.variant;
  const test = variant?.tests?.find((candidate) => candidate.study === kind);
  if (test) return { test };
  if (variant?.benchmark?.study === kind) {
    return { benchmark: variant.benchmark };
  }
  return options ?? {};
}

function recordExampleSelection(report, options) {
  const context = globalThis.__benchmarkExampleContext;
  if (!context) return report;
  report.examplePackage = {
    example: context.example.id,
    variant: context.variant.id,
    testPackage: context.testPackageIdentity,
    test: options.test?.id ?? null,
    benchmark: options.benchmark?.study ?? null,
  };
  return report;
}

async function execute(kind, suppliedOptions) {
  if (running) return;
  setRunning(true);
  setState("Running", "running", "Preparing Illuminate traces…");
  try {
    const options = studySelection(kind, suppliedOptions);
    const specification = options.test ?? options.benchmark ?? {};
    latestReport = await runComparison(kind, {
      backends: options.test?.backends,
      data: specification.data,
    });
    recordExampleSelection(latestReport, options);
    globalThis.PrettyBenchDashboard.load(latestReport);
    renderReport(latestReport);
    setState(
      latestReport.passed ? "Complete" : "Mismatch",
      latestReport.passed ? "ready" : "failed",
      `${latestReport.parityCount}/${latestReport.scenarioCount} points agree`,
    );
    return latestReport;
  } catch (error) {
    setState(
      "Failed",
      "failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    setRunning(false);
  }
}

async function boot() {
  renderBackends();
  const [runtimeModule, traceModule, examplesResponse, receipt] =
    await Promise.all([
      import(new URL("vir/sdk/js/vir-runtime.js", artifactBase).href),
      import(new URL("workload/vir-player-trace.mjs", artifactBase).href),
      fetch(new URL("workload/examples.json", artifactBase)).then(
        (response) => {
          if (!response.ok)
            throw new Error("failed to load Illuminate examples");
          return response.json();
        },
      ),
      loadArtifactProvenance(),
    ]);
  const selectionAvailable =
    receipt.kind === "browser-benchmarks/artifact-set"
      ? Boolean(
          receipt.files?.[
            "illuminate/selection/illuminate-selection-player-browser-adapter.mjs"
          ],
        )
      : Boolean(receipt.inputs?.selection);
  const nativeModule = await import(
    new URL(
      selectionAvailable
        ? "selection/illuminate-selection-player-browser-adapter.mjs"
        : "native/illuminate-player-browser-adapter.mjs",
      artifactBase,
    ).href
  );
  examples = examplesResponse;
  artifactProvenance = receipt;
  if (receipt.kind === "browser-benchmarks/artifact-set") {
    renderArtifactSetNotes(receipt);
  } else {
    renderBuildNotes(receipt);
  }

  backend("js").invoke = invokeJavaScript;
  try {
    const runtime = await runtimeModule.createVirRuntime({
      wasmUrl: new URL("vir/sdk/wasm/vir-upstream.wasm", artifactBase),
      irPackageSetUrl: new URL(
        "vir/module-sets/Illuminate/Animation/Vir.irpkg-set.json",
        artifactBase,
      ),
    });
    backend("vir").invoke = (animation, events) => {
      const totalStarted = performance.now();
      const projectStarted = performance.now();
      const preparedAnimation =
        traceModule.prepareVirPlayerAnimation(animation);
      const preparedEvents = traceModule.prepareVirPlayerEvents(events);
      const projectMs = performance.now() - projectStarted;
      const call = runtime.callTimed(
        typedVirEntry,
        preparedAnimation,
        preparedEvents,
      );
      const value = traceModule.normalizeVirTraceResult(call.value);
      return {
        value,
        timings: {
          prepareMs: projectMs + call.timings.marshalMs,
          executeMs: call.timings.executeMs,
          decodeMs: call.timings.decodeMs,
          totalMs: performance.now() - totalStarted,
        },
        rawTimings: { projectMs, ...call.timings },
      };
    };
    backend("vir").status = "ready";
  } catch (error) {
    backend("vir").status = "failed";
    console.error(error);
  }

  try {
    const native = selectionAvailable
      ? await nativeModule.fetchIlluminateSelectionPlayerAdapter(
          new URL("selection/illuminate-selection-player.wasm", artifactBase),
        )
      : await nativeModule.fetchIlluminatePlayerAdapter(
          new URL("native/illuminate-player.wasm", artifactBase),
        );
    if (selectionAvailable) backend("native").label = "Lean · FIR selection";
    backend("native").invoke = (animation, events) => {
      const totalStarted = performance.now();
      const result = selectionAvailable
        ? replaySelectionTrace(native, animation, events)
        : native.replayTrace(animation, events);
      const totalMs = performance.now() - totalStarted;
      return {
        value: result.ok
          ? { ok: true, actions: result.actions }
          : { ok: false, error: result.error },
        timings: normalizeNativeTimings(result, totalMs),
        rawTimings: result.timings,
      };
    };
    backend("native").status = "ready";
  } catch (error) {
    backend("native").status = "failed";
    console.error(error);
  }

  renderBackends();
  const readyCount = backends.filter(
    (candidate) => candidate.status === "ready",
  ).length;
  setState(
    readyCount === backends.length ? "Ready" : "Degraded",
    readyCount === backends.length ? "ready" : "failed",
    `${readyCount}/${backends.length} backends available · rehearsal`,
  );
  return { readyCount, backendCount: backends.length };
}

studyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    execute(/** @type {HTMLElement} */ (button).dataset.study || "quick").catch(
      (error) => console.error(error),
    );
  });
});
openDashboard.addEventListener("click", () =>
  globalThis.PrettyBenchDashboard.openReport("scaling"),
);
downloadResults.addEventListener("click", () => {
  if (!latestReport) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([`${JSON.stringify(latestReport, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  link.download = `illuminate-player-${new Date()
    .toISOString()
    .replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
loadResults.addEventListener("click", () => loadInput.click());
loadInput.addEventListener("change", () => {
  const file = loadInput.files?.[0];
  if (!file) return;
  file
    .text()
    .then((body) => {
      const report = JSON.parse(body);
      if (report?.workload?.id !== "illuminate-player") {
        throw new Error("selected file is not an Illuminate player report");
      }
      latestReport = report;
      globalThis.PrettyBenchDashboard.load(report);
      renderReport(report);
      setState("Loaded", "ready", file.name);
    })
    .catch((error) => {
      setState(
        "Failed",
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    })
    .finally(() => {
      loadInput.value = "";
    });
});
clearResults.addEventListener("click", () => {
  clearReport();
  setState("Ready", "ready", "Report cleared");
});

const api = {
  ready: boot(),
  runStudy: execute,
  getReport: () => latestReport,
  getBackends: () =>
    backends.map(({ id, label, status }) => ({ id, label, status })),
};
globalThis.__illuminateBenchApp = api;
