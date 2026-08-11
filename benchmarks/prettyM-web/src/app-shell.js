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
    if (
      manifest?.schemaVersion !== 2 ||
      manifest?.kind !== "browser-benchmarks/artifact-set" ||
      manifest?.example?.id !== example.id ||
      (manifest?.example?.variant !== undefined &&
        manifest.example.variant !== variant.id) ||
      typeof manifest?.setId !== "string"
    ) {
      throw new Error("manifest does not match the selected example");
    }
    if (
      manifest.testPackage &&
      (manifest.testPackage.file !== testPackageIdentity.file ||
        manifest.testPackage.bytes !== testPackageIdentity.bytes ||
        manifest.testPackage.sha256 !== testPackageIdentity.sha256)
    ) {
      throw new Error("manifest test package does not match the selected example");
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
  globalThis.__benchmarkExampleContext = {
    example: selected,
    artifactBaseUrl,
    testPackage,
    testPackageIdentity,
    variant,
  };
  artifactStatus = await inspectArtifactStatus(
    selected,
    variant,
    selectedView,
    testPackageIdentity,
    artifactBaseUrl,
  );
  showArtifactStatus(artifactStatus);
  for (const path of selectedView.bootstrap.artifactScripts) {
    await loadScript(new URL(path, artifactBaseUrl).href);
  }
  for (const path of selectedView.bootstrap.classicScripts) {
    await loadScript(new URL(`../${path}`, import.meta.url).href);
  }
  if (typeof selectedModule.loadExample !== "function") {
    throw new Error(`${selected.id} controller module does not export loadExample()`);
  }
  controller = await selectedModule.loadExample({
    example: selected,
    artifactBaseUrl,
    testPackage,
    testPackageIdentity,
    variant,
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
  getVariants: () =>
    globalThis.__benchmarkExampleContext?.testPackage.variants ?? [],
  getVariant: () => globalThis.__benchmarkExampleContext?.variant ?? null,
};
