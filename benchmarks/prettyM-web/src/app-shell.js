// @ts-check

const catalogUrl = new URL("../examples/catalog.json", import.meta.url);
const catalogResponse = await fetch(catalogUrl, { cache: "no-store" });
if (!catalogResponse.ok) {
  throw new Error(`failed to load example catalog: HTTP ${catalogResponse.status}`);
}
const catalog = await catalogResponse.json();
if (
  catalog?.schemaVersion !== 1 ||
  catalog?.kind !== "browser-benchmarks/example-catalog" ||
  !Array.isArray(catalog.examples)
) {
  throw new Error("unsupported example catalog");
}
const examples = catalog.examples.filter(
  (example) => !["queued", "archived"].includes(example.lifecycle),
);
const selectedId = new URL(location.href).searchParams.get("example");
const selected = examples.find((example) => example.id === selectedId) ?? null;
const selectedModule = selected
  ? await import(new URL(`../${selected.controller}`, import.meta.url).href)
  : null;
const view = selectedModule?.view ?? null;
let controller = null;
let artifactStatus = null;

function element(id) {
  const found = document.querySelector(`#${id}`);
  if (!(found instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return found;
}

function requireView(example, value) {
  if (!value || typeof value !== "object") {
    throw new Error(`${example.id} controller does not export view metadata`);
  }
  for (const field of [
    "eyebrow",
    "intro",
    "progress",
    "backendDescription",
    "protocolDescription",
    "studyDescription",
    "emptyResults",
    "footer",
  ]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`${example.id} view.${field} must be a non-empty string`);
    }
  }
  if (
    !value.artifacts ||
    typeof value.artifacts.root !== "string" ||
    value.artifacts.root !== `artifacts/${example.id}`
  ) {
    throw new Error(
      `${example.id} view artifact root must be artifacts/${example.id}`,
    );
  }
  if (!Array.isArray(value.controls) || !Array.isArray(value.studies)) {
    throw new Error(`${example.id} view has no controls or studies`);
  }
  if (
    !value.bootstrap ||
    !Array.isArray(value.bootstrap.externalScripts) ||
    !Array.isArray(value.bootstrap.classicScripts)
  ) {
    throw new Error(`${example.id} view has no bootstrap declaration`);
  }
  return value;
}

function renderNavigation() {
  const navigation = element("example-nav");
  for (const example of examples) {
    const link = document.createElement("a");
    link.href = `./?example=${example.id}`;
    link.dataset.example = example.id;
    const label = document.createElement("strong");
    label.textContent = example.title;
    const summary = document.createElement("small");
    summary.textContent = example.summary;
    link.append(label, summary);
    if (example.id === selected?.id) link.setAttribute("aria-current", "page");
    navigation.appendChild(link);
  }
}

function renderControls(selectedView) {
  const controls = element("protocol-controls");
  controls.style.setProperty("--control-count", String(selectedView.controls.length));
  for (const control of selectedView.controls) {
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

function renderStudies(selectedView) {
  const actions = element("study-actions");
  for (const study of selectedView.studies) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.study = study.id;
    button.textContent = study.label;
    if (study.primary) button.className = "primary";
    actions.appendChild(button);
  }
}

function showArtifactStatus(status) {
  const container = element("artifact-status");
  container.dataset.tone = status.tone;
  container.dataset.verified = String(status.verified);
  element("artifact-status-heading").textContent = status.heading;
  element("artifact-status-copy").textContent = status.copy;
}

async function inspectArtifactStatus(example, selectedView) {
  const root = selectedView.artifacts.root.replace(/\/+$/, "");
  const url = new URL(`../${root}/ARTIFACT_SET.json`, import.meta.url);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (
      manifest?.schemaVersion !== 2 ||
      manifest?.kind !== "browser-benchmarks/artifact-set" ||
      manifest?.example?.id !== example.id ||
      typeof manifest?.setId !== "string"
    ) {
      throw new Error("manifest does not match the selected example");
    }
    return {
      verified: true,
      tone: "verified",
      heading: `Verified artifact set · ${manifest.setId}`,
      copy: selectedView.artifacts.copy,
      setId: manifest.setId,
      manifest,
    };
  } catch (error) {
    const rehearsal = example.lifecycle === "rehearsal";
    return {
      verified: false,
      tone: rehearsal ? "rehearsal" : "unverified",
      heading: rehearsal
        ? "Local integration rehearsal"
        : "Unverified local artifacts",
      copy: rehearsal
        ? selectedView.artifacts.copy
        : `${selectedView.artifacts.copy} No verified artifact-set manifest is staged.`,
      setId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderShell() {
  renderNavigation();
  if (!selected) {
    document.documentElement.dataset.activeExample = "catalog";
    document.title = "Lean browser benchmarks";
    element("example-eyebrow").textContent = "Browser Wasm";
    element("example-title").textContent = "Lean browser benchmarks";
    element("example-intro").textContent =
      "Choose a benchmark example. Every example uses the same application shell, artifact status, backend selection, protocol, studies, and report workflow.";
    element("app-state").textContent = "Choose an example";
    element("app-state").dataset.state = "ready";
    element("app-progress").textContent = `${examples.length} examples available`;
    document.querySelectorAll("[data-example-content]").forEach((content) => {
      /** @type {HTMLElement} */ (content).hidden = true;
    });
    return;
  }

  const selectedView = requireView(selected, view);
  document.documentElement.dataset.activeExample = selected.id;
  document.title = `${selected.title} · Lean browser benchmarks`;
  element("example-eyebrow").textContent = selectedView.eyebrow;
  element("example-title").textContent = selected.title;
  element("example-intro").textContent = selectedView.intro;
  element("app-progress").textContent = selectedView.progress;
  showArtifactStatus({
    verified: false,
    tone: "checking",
    heading: "Checking artifact manifest",
    copy: selectedView.artifacts.copy,
  });
  element("backend-description").textContent = selectedView.backendDescription;
  element("protocol-description").textContent = selectedView.protocolDescription;
  element("study-description").textContent = selectedView.studyDescription;
  element("empty-results").textContent = selectedView.emptyResults;
  element("example-footer").textContent = selectedView.footer;
  renderControls(selectedView);
  renderStudies(selectedView);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`failed to load ${url}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

async function boot() {
  if (!selected) return { example: null, readyCount: 0, backendCount: 0 };
  const selectedView = requireView(selected, view);
  artifactStatus = await inspectArtifactStatus(selected, selectedView);
  showArtifactStatus(artifactStatus);
  for (const path of selectedView.bootstrap.externalScripts) {
    await loadScript(new URL(`../${path}`, import.meta.url).href);
  }
  for (const path of selectedView.bootstrap.classicScripts) {
    await loadScript(new URL(`../${path}`, import.meta.url).href);
  }
  if (typeof selectedModule.loadExample !== "function") {
    throw new Error(`${selected.id} controller module does not export loadExample()`);
  }
  const artifactRoot = selectedView.artifacts.root.replace(/\/+$/, "");
  controller = await selectedModule.loadExample({
    example: selected,
    artifactBaseUrl: new URL(`../${artifactRoot}/`, import.meta.url),
  });
  const readiness = await controller.ready;
  return { example: selected.id, ...readiness };
}

renderShell();

globalThis.__benchmarkApp = {
  activeExample: selected?.id ?? null,
  examples: examples.map(({ id, title }) => ({ id, label: title })),
  ready: boot(),
  getController: () => controller,
  getArtifactStatus: () => artifactStatus,
};
