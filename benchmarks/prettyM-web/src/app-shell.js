// @ts-check

const examples = [
  {
    id: "prettyM",
    label: "Std.Format.prettyM",
    summary: "Five backends · formatting, scaling, and memory",
    eyebrow: "Bounded runtimes · browser Wasm",
    title: "Std.Format.prettyM",
    intro:
      "Compare correctness, pipeline timings, scaling, and retained memory across five independently versioned implementations.",
    progress: "Preparing bounded artifact set…",
    artifactTone: "verified",
    artifactHeading: "Canonical bounded artifact set",
    artifactCopy:
      "Reports remain tied to one verified, immutable set of independently versioned runtimes and workload packages.",
    backendDescription:
      "Choose which implementations participate in the next run. Report views have their own non-destructive backend filter.",
    protocolDescription:
      "Defaults match the consolidated browser study. Treat timings as observations unless the host and run protocol are controlled.",
    controls: [
      { id: "warmup", label: "Warm-up rounds", min: 0, max: 100, value: 2 },
      { id: "samples", label: "Measured rounds", min: 1, max: 1000, value: 9 },
      {
        id: "batch-target",
        label: "Batch target (ms)",
        min: 0,
        max: 1000,
        value: 20,
      },
      {
        id: "repeat-cycles",
        label: "Repeat cycles",
        min: 1,
        max: 10000,
        value: 32,
      },
    ],
    studyDescription:
      "Execute one study or collect the complete dashboard dataset.",
    studies: [
      { id: "smoke", label: "Quick check" },
      { id: "differential", label: "Corpus" },
      { id: "scaling", label: "Scaling" },
      { id: "memory-retained", label: "Memory" },
      { id: "interactions", label: "Interactions" },
      { id: "repeated", label: "Repeated calls" },
      { id: "suite", label: "Full suite", primary: true },
    ],
    emptyResults: "No prettyM benchmark has run yet.",
    footer:
      "Reports contain artifact provenance, startup timings, per-phase samples, parity results, and memory observations.",
    classicScripts: [
      "config.js",
      "benchmark-core.js",
      "backends/pretty-vir.js",
      "backends/pretty-native.js",
      "backends/pretty-llvm.js",
      "dashboard.js",
      "app.js",
    ],
    api: "__prettyBenchApp",
  },
  {
    id: "illuminate",
    label: "Illuminate player",
    summary: "Three backends · player trace parity and scaling",
    eyebrow: "Real client · browser Wasm",
    title: "Illuminate player trace",
    intro:
      "Compare the production JavaScript player with typed VIR and FIR-native implementations over identical animations and event traces.",
    progress: "Preparing rehearsal artifacts…",
    artifactTone: "rehearsal",
    artifactHeading: "Local integration rehearsal",
    artifactCopy:
      "Correctness and packaging are validated, but timings from this loaded machine are not accepted as performance evidence.",
    backendDescription:
      "JavaScript is the semantic oracle. VIR and FIR run the same typed replay contract and return normalized frame actions.",
    protocolDescription:
      "Runs are interleaved and starting order rotates. Adaptive batching is disabled because both Wasm runtimes retain allocations.",
    controls: [
      { id: "warmup", label: "Warm-up rounds", min: 0, max: 20, value: 1 },
      { id: "samples", label: "Measured rounds", min: 1, max: 100, value: 5 },
    ],
    studyDescription:
      "Quick check uses three trace lengths. Trace scaling adds longer event sequences and opens the shared plotting report.",
    studies: [
      { id: "quick", label: "Quick parity" },
      { id: "scaling", label: "Trace scaling", primary: true },
    ],
    emptyResults: "No Illuminate benchmark has run yet.",
    footer:
      "Common plotted phases are prepare, execute, decode, and total. Backend-specific raw fields remain in the JSON report.",
    externalScripts: ["artifacts/illuminate/workload/anim_core.js"],
    classicScripts: ["dashboard.js"],
    module: "illuminate-app.js",
    api: "__illuminateBenchApp",
  },
];

const selectedId = new URL(location.href).searchParams.get("example");
const selected = examples.find((example) => example.id === selectedId) ?? null;

function element(id) {
  const found = document.querySelector(`#${id}`);
  if (!(found instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return found;
}

function renderNavigation() {
  const navigation = element("example-nav");
  for (const example of examples) {
    const link = document.createElement("a");
    link.href = `./?example=${example.id}`;
    link.dataset.example = example.id;
    const label = document.createElement("strong");
    label.textContent = example.label;
    const summary = document.createElement("small");
    summary.textContent = example.summary;
    link.append(label, summary);
    if (example.id === selected?.id) link.setAttribute("aria-current", "page");
    navigation.appendChild(link);
  }
}

function renderControls(example) {
  const controls = element("protocol-controls");
  controls.style.setProperty(
    "--control-count",
    String(example.controls.length),
  );
  for (const control of example.controls) {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = control.label;
    const input = document.createElement("input");
    input.id = control.id;
    input.type = "number";
    input.min = String(control.min);
    input.max = String(control.max);
    input.value = String(control.value);
    label.append(text, input);
    controls.appendChild(label);
  }
}

function renderStudies(example) {
  const actions = element("study-actions");
  for (const study of example.studies) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.study = study.id;
    button.textContent = study.label;
    if (study.primary) button.className = "primary";
    actions.appendChild(button);
  }
}

function renderShell() {
  if (!selected) {
    document.documentElement.dataset.activeExample = "catalog";
    document.title = "Lean browser benchmarks";
    element("example-eyebrow").textContent = "Browser Wasm";
    element("example-title").textContent = "Lean browser benchmarks";
    element("example-intro").textContent =
      "Choose a benchmark example. Every example uses the same application shell, artifact status, backend selection, protocol, studies, and report workflow.";
    element("app-state").textContent = "Choose an example";
    element("app-state").dataset.state = "ready";
    element("app-progress").textContent =
      `${examples.length} examples available`;
    document.querySelectorAll("[data-example-content]").forEach((content) => {
      /** @type {HTMLElement} */ (content).hidden = true;
    });
    renderNavigation();
    return;
  }
  document.documentElement.dataset.activeExample = selected.id;
  document.title = `${selected.label} · Lean browser benchmarks`;
  element("example-eyebrow").textContent = selected.eyebrow;
  element("example-title").textContent = selected.title;
  element("example-intro").textContent = selected.intro;
  element("app-progress").textContent = selected.progress;
  element("artifact-status").dataset.tone = selected.artifactTone;
  element("artifact-status-heading").textContent = selected.artifactHeading;
  element("artifact-status-copy").textContent = selected.artifactCopy;
  element("backend-description").textContent = selected.backendDescription;
  element("protocol-description").textContent = selected.protocolDescription;
  element("study-description").textContent = selected.studyDescription;
  element("empty-results").textContent = selected.emptyResults;
  element("example-footer").textContent = selected.footer;
  renderNavigation();
  renderControls(selected);
  renderStudies(selected);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`failed to load ${url}`)),
      {
        once: true,
      },
    );
    document.head.appendChild(script);
  });
}

async function boot() {
  if (!selected) {
    return { example: null, readyCount: 0, backendCount: 0 };
  }
  for (const path of selected.externalScripts ?? []) {
    await loadScript(new URL(`../${path}`, import.meta.url).href);
  }
  for (const path of selected.classicScripts) {
    await loadScript(new URL(path, import.meta.url).href);
  }
  if (selected.module)
    await import(new URL(selected.module, import.meta.url).href);
  const api = globalThis[selected.api];
  if (!api?.ready)
    throw new Error(`${selected.id} controller did not initialize`);
  const readiness = await api.ready;
  return { example: selected.id, ...readiness };
}

renderShell();

globalThis.__benchmarkApp = {
  activeExample: selected?.id ?? null,
  examples: examples.map(({ id, label }) => ({ id, label })),
  ready: boot(),
  getController: () => (selected ? globalThis[selected.api] : null),
};
