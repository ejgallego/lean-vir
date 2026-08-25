// @ts-check

import { requireArtifactManifestIdentity } from "./artifact-status.js";
import { createReportPresentation } from "./presentation.js";

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
for (const example of catalog.examples) requireAvailability(example);
const examples = catalog.examples.filter(
  (example) => !["queued", "archived"].includes(example.lifecycle),
);
const selectedId = new URL(location.href).searchParams.get("example");
const selected = examples.find((example) => example.id === selectedId) ?? null;
const selectedAvailability = selected ? requireAvailability(selected) : null;
const selectedModule =
  selectedAvailability?.status === "ready"
    ? await import(new URL(`../${selected.controller}`, import.meta.url).href)
    : null;
const view = selectedModule?.view ?? null;
const reportPresentation =
  selectedAvailability?.status === "ready"
    ? createReportPresentation({
        example: selected,
        openButton: /** @type {HTMLButtonElement} */ (
          element("open-dashboard")
        ),
      })
    : null;
if (reportPresentation) {
  element("clear-results").addEventListener(
    "click",
    () => reportPresentation.reset(),
    true,
  );
}
let controller = null;
let artifactStatus = null;

function requireAvailability(example) {
  const availability = example?.availability;
  if (
    !availability ||
    !["ready", "not-built", "invalid"].includes(availability.status) ||
    typeof availability.variant !== "string" ||
    availability.variant.length === 0 ||
    (availability.status === "ready" &&
      (typeof availability.setId !== "string" ||
        availability.setId.length === 0))
  ) {
    throw new Error(`example ${example?.id ?? "unknown"} has no availability`);
  }
  return availability;
}

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
    typeof value.artifacts.copy !== "string" ||
    value.artifacts.copy.length === 0
  ) {
    throw new Error(`${example.id} view has no artifact status copy`);
  }
  if (!Array.isArray(value.controls) || !Array.isArray(value.studies)) {
    throw new Error(`${example.id} view has no controls or studies`);
  }
  if (
    !value.bootstrap ||
    !Array.isArray(value.bootstrap.artifactScripts) ||
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
    const availability = requireAvailability(example);
    if (availability.status === "ready") {
      link.href = `./?example=${example.id}`;
    } else {
      link.setAttribute("aria-disabled", "true");
    }
    link.dataset.example = example.id;
    link.dataset.availability = availability.status;
    const label = document.createElement("strong");
    label.textContent = example.title;
    const summary = document.createElement("small");
    summary.textContent = example.summary;
    link.append(label, summary);
    if (availability.status !== "ready") {
      const badge = document.createElement("em");
      badge.textContent =
        availability.status === "invalid" ? "Artifacts invalid" : "Not built";
      link.appendChild(badge);
    }
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

function renderVariants(testPackage, variant) {
  const select = element("variant-select");
  for (const candidate of testPackage.variants) {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = candidate.title;
    option.selected = candidate.id === variant.id;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("example", selected.id);
    url.searchParams.set("variant", select.value);
    location.assign(url);
  });
}

function showArtifactStatus(status) {
  const container = element("artifact-status");
  container.dataset.tone = status.tone;
  container.dataset.verified = String(status.verified);
  element("artifact-status-heading").textContent = status.heading;
  element("artifact-status-copy").textContent = status.copy;
}

async function inspectArtifactStatus(
  example,
  variant,
  selectedView,
  testPackageIdentity,
  artifactBaseUrl,
) {
  const url = new URL("ARTIFACT_SET.json", artifactBaseUrl);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    requireArtifactManifestIdentity(manifest, {
      exampleId: example.id,
      variantId: variant.id,
      testPackage: testPackageIdentity,
    });
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

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
    const readyCount = examples.filter(
      (example) => requireAvailability(example).status === "ready",
    ).length;
    element("app-progress").textContent =
      `${readyCount} ready · ${examples.length - readyCount} unavailable`;
    document.querySelectorAll("[data-example-content]").forEach((content) => {
      /** @type {HTMLElement} */ (content).hidden = true;
    });
    return;
  }

  if (selectedAvailability.status !== "ready") {
    document.documentElement.dataset.activeExample = selected.id;
    document.title = `${selected.title} · Lean browser benchmarks`;
    element("example-eyebrow").textContent = "Browser benchmark";
    element("example-title").textContent = selected.title;
    element("example-intro").textContent = selected.summary;
    element("app-state").textContent =
      selectedAvailability.status === "invalid"
        ? "Artifacts invalid"
        : "Not built";
    element("app-state").dataset.state = "unavailable";
    element("app-progress").textContent =
      `Build with: npm run example -- ${selected.id} ${selectedAvailability.variant} --materialize --prepare`;
    artifactStatus = {
      verified: false,
      tone: "unavailable",
      heading: element("app-state").textContent,
      copy: element("app-progress").textContent,
      setId: null,
    };
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

function observeControllerReports(value) {
  if (!reportPresentation) return value;
  /** @type {*} */
  const observed = {
    ready: value.ready,
    getBackends: value.getBackends.bind(value),
    async runStudy(studyId, options) {
      const report = await value.runStudy(studyId, options);
      reportPresentation.record(report, value.getBackends());
      return report;
    },
  };
  if (typeof value.dispose === "function") {
    observed.dispose = value.dispose.bind(value);
  }
  return observed;
}

function bindStudyActions() {
  const actions = element("study-actions");
  actions.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element) || !controller) return;
      const button = event.target.closest("button[data-study]");
      if (!(button instanceof HTMLButtonElement) || !actions.contains(button)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      controller.runStudy(button.dataset.study ?? "").catch((error) => {
        element("app-state").textContent = "Failed";
        element("app-state").dataset.state = "failed";
        element("app-progress").textContent =
          error instanceof Error ? error.message : String(error);
        console.error(error);
      });
    },
    true,
  );
}

async function boot() {
  if (!selected) return { example: null, readyCount: 0, backendCount: 0 };
  if (selectedAvailability.status !== "ready") {
    return {
      example: selected.id,
      available: false,
      readyCount: 0,
      backendCount: 0,
    };
  }
  const selectedView = requireView(selected, view);
  const testPackageUrl = new URL(`../${selected.testPackage}`, import.meta.url);
  const testPackageResponse = await fetch(testPackageUrl, { cache: "no-store" });
  if (!testPackageResponse.ok) {
    throw new Error(
      `${selected.id} test package failed to load: HTTP ${testPackageResponse.status}`,
    );
  }
  const testPackageBytes = await testPackageResponse.arrayBuffer();
  const testPackage = JSON.parse(new TextDecoder().decode(testPackageBytes));
  if (
    testPackage?.schemaVersion !== 1 ||
    testPackage?.kind !== "browser-benchmarks/example-tests" ||
    testPackage?.example !== selected.id ||
    !Array.isArray(testPackage.variants) ||
    testPackage.variants.length === 0
  ) {
    throw new Error(`${selected.id} has an unsupported test package`);
  }
  const variantId = new URL(location.href).searchParams.get("variant");
  const variant = variantId
    ? testPackage.variants.find((candidate) => candidate.id === variantId)
    : testPackage.variants[0];
  if (!variant) {
    throw new Error(`${selected.id} has no test variant ${variantId}`);
  }
  const testPackageIdentity = {
    file: selected.testPackage,
    bytes: testPackageBytes.byteLength,
    sha256: await sha256(testPackageBytes),
  };
  const artifactBaseUrl = new URL(
    `../artifacts/${selected.id}/`,
    import.meta.url,
  );
  renderVariants(testPackage, variant);
  artifactStatus = await inspectArtifactStatus(
    selected,
    variant,
    selectedView,
    testPackageIdentity,
    artifactBaseUrl,
  );
  showArtifactStatus(artifactStatus);
  globalThis.__benchmarkExampleContext = {
    example: selected,
    artifactBaseUrl,
    artifactStatus,
    testPackage,
    testPackageIdentity,
    variant,
  };
  for (const path of selectedView.bootstrap.artifactScripts) {
    await loadScript(new URL(path, artifactBaseUrl).href);
  }
  for (const path of selectedView.bootstrap.classicScripts) {
    await loadScript(new URL(`../${path}`, import.meta.url).href);
  }
  if (typeof selectedModule.loadExample !== "function") {
    throw new Error(`${selected.id} controller module does not export loadExample()`);
  }
  controller = observeControllerReports(
    await selectedModule.loadExample({
      example: selected,
      artifactBaseUrl,
      testPackage,
      testPackageIdentity,
      variant,
    }),
  );
  bindStudyActions();
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
  getVariants: () =>
    globalThis.__benchmarkExampleContext?.testPackage.variants ?? [],
  getVariant: () => globalThis.__benchmarkExampleContext?.variant ?? null,
};
