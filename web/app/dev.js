/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import {
  inputDefault,
  interfaceInputTag,
  isJsonInputTag,
  parseBoolText,
} from "./pages/interface-inputs.js";
import { formatInterfaceEffectPrefix } from "../src/runtime/interface-effects.js";
import {
  formatInterfaceType,
  manifestDiagnostics,
  validateInterfaceManifest,
} from "../src/runtime/interface-manifest.js";
import { createBrowserReactRuntimeFactory } from "./browser-react-runtime.js";
import {
  defaultPackageFile,
  packagePresets,
  wasmPublicFile,
} from "./pages/browser-packages.js";
import {
  parseByteArrayInput,
  parseFloatText,
  parseIntText,
  parseNatText,
} from "./pages/input-parsers.js";
import {
  assetPathFor,
  errorMessage,
  formatBytes,
  formatResult,
  setReadyState,
} from "./pages/page-utils.js";
import { createLatestLoadGate } from "./pages/latest-load.js";
import { fetchBytes } from "../src/vir-runtime.js";
import { INTERFACE_TAG } from "../src/runtime/interface-tags.js";
import { formatPackageTarget } from "../src/runtime/package-targets.js";

const statusEl = document.querySelector("#status");
const packageName = document.querySelector("#dev-package-name");
const packageSize = document.querySelector("#dev-package-size");
const declCount = document.querySelector("#dev-decl-count");
const exportCount = document.querySelector("#dev-export-count");
const ptrWidth = document.querySelector("#dev-ptr-width");
const sourceTargets = document.querySelector("#dev-source-targets");
const toolchain = document.querySelector("#dev-toolchain");
const packagePreset = document.querySelector("#dev-package-preset");
const packageUrl = document.querySelector("#dev-package-url");
const packageFile = document.querySelector("#dev-package-file");
const loadUrlButton = document.querySelector("#dev-load-url");
const entrySelect = document.querySelector("#dev-entry-select");
const inputFields = document.querySelector("#dev-input-fields");
const runEntryButton = document.querySelector("#dev-run-entry");
const reloadRuntimeButton = document.querySelector("#dev-reload-runtime");
const resultOutput = document.querySelector("#dev-result");
const runtimeFactory = createBrowserReactRuntimeFactory({
  wasmUrl: `${import.meta.env.BASE_URL}${wasmPublicFile}`,
});
const query = new URLSearchParams(window.location.search);
let requestedEntry = query.get("entry");
let requestedAutoRun = query.get("run") === "1";

let runtime = null;
let interfaceEntries = [];
let currentPackageSource = null;
let packageLoadPending = false;
let reloadingFailedRuntime = false;
const packageLoadGate = createLatestLoadGate();

function updateRuntimeControls() {
  const failed = runtime?.failure != null;
  runEntryButton.disabled =
    packageLoadPending ||
    runtime === null ||
    failed ||
    interfaceEntries.length === 0;
  reloadRuntimeButton.hidden = !failed;
  reloadRuntimeButton.disabled =
    packageLoadPending || currentPackageSource === null;
  if (reloadingFailedRuntime) {
    entrySelect.disabled = true;
    for (const field of inputFields.querySelectorAll("[data-input-index]")) {
      field.disabled = true;
    }
  } else {
    entrySelect.disabled = false;
    for (const field of inputFields.querySelectorAll("[data-input-index]")) {
      field.disabled = false;
    }
  }
}

function showError(error, status = "Failed") {
  if (runtime?.failure != null) {
    try {
      runtime.dispose();
    } catch (cleanupError) {
      console.error("failed to dispose trapped runner runtime", cleanupError);
    }
  }
  resultOutput.textContent = errorMessage(error);
  updateRuntimeControls();
  setReadyState(statusEl, status, false);
  console.error(error);
}

function beginPackageLoad() {
  const token = packageLoadGate.begin();
  packageLoadPending = true;
  reloadingFailedRuntime = false;
  updateRuntimeControls();
  setReadyState(statusEl, "Loading", false);
  return token;
}

function finishPackageLoad(token) {
  if (!packageLoadGate.isCurrent(token)) return;
  packageLoadPending = false;
  reloadingFailedRuntime = false;
  updateRuntimeControls();
}

function selectedInterfaceEntry() {
  return (
    interfaceEntries.find((entry) => entry.id === entrySelect.value) ?? null
  );
}

function selectEntryFromQuery() {
  const entryId = requestedEntry;
  if (!entryId) return;
  const match = interfaceEntries.find(
    (entry) =>
      entry.id === entryId ||
      entry.jsName === entryId ||
      entry.entry === entryId,
  );
  if (match) {
    entrySelect.value = match.id;
  }
  requestedEntry = null;
}

function renderPackagePresets() {
  packagePreset.replaceChildren();
  for (const preset of packagePresets) {
    const option = document.createElement("option");
    option.value = preset.file;
    option.textContent = `${preset.file} / ${preset.label}`;
    packagePreset.append(option);
  }
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom URL";
  packagePreset.append(custom);
}

function syncPackagePreset() {
  const value = packageUrl.value.trim();
  packagePreset.value = packagePresets.some((preset) => preset.file === value)
    ? value
    : "";
}

function inputFieldId(input, index) {
  return `dev-entry-input-${index}-${input.name ?? "input"}`;
}

function renderInputFields(entry) {
  inputFields.replaceChildren();
  const inputs = entry?.args ?? [];
  if (inputs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dev-input-empty";
    empty.textContent = "No inputs";
    inputFields.append(empty);
    return;
  }

  for (const [index, input] of inputs.entries()) {
    const label = document.createElement("label");
    label.className = "dev-field";
    const caption = document.createElement("span");
    caption.textContent = `${input.name ?? `input${index + 1}`} : ${formatInterfaceType(input.type)}`;
    const field = document.createElement(
      interfaceInputTag(input.type).toLowerCase(),
    );
    field.id = inputFieldId(input, index);
    field.dataset.inputIndex = String(index);
    if (input.type?.interfaceTag === INTERFACE_TAG.SIMPLE_ENUM) {
      for (const ctor of input.type?.constructors ?? []) {
        const option = document.createElement("option");
        option.value = ctor.jsName;
        option.textContent = ctor.jsName;
        field.append(option);
      }
      field.value = inputDefault(input);
    } else if (
      input.type?.interfaceTag === INTERFACE_TAG.NAT ||
      input.type?.interfaceTag === INTERFACE_TAG.UINT8 ||
      input.type?.interfaceTag === INTERFACE_TAG.UINT16 ||
      input.type?.interfaceTag === INTERFACE_TAG.UINT32
    ) {
      field.type = "number";
      field.inputMode = "numeric";
      field.min = "0";
    } else if (
      input.type?.interfaceTag === INTERFACE_TAG.FLOAT ||
      input.type?.interfaceTag === INTERFACE_TAG.FLOAT32
    ) {
      field.type = "text";
      field.inputMode = "decimal";
    } else if (isJsonInputTag(input.type?.interfaceTag)) {
      field.spellcheck = false;
    } else if (input.type?.interfaceTag === INTERFACE_TAG.BOOL) {
      label.classList.add("dev-checkbox-field");
      field.type = "checkbox";
      field.checked = parseBoolText(
        inputOverride(entry, input, index) ?? inputDefault(input),
      );
    } else {
      field.type = "text";
      field.inputMode = "text";
    }
    if (
      input.type?.interfaceTag !== INTERFACE_TAG.SIMPLE_ENUM &&
      input.type?.interfaceTag !== INTERFACE_TAG.BOOL
    ) {
      field.value = inputOverride(entry, input, index) ?? inputDefault(input);
    }
    label.append(caption, field);
    if (isJsonInputTag(input.type?.interfaceTag)) {
      const hint = document.createElement("small");
      hint.id = `dev-entry-input-${index}-hint`;
      hint.className = "dev-field-hint";
      hint.textContent = 'For large integers, use quoted decimal strings, e.g. ["9007199254740993"].';
      field.setAttribute("aria-describedby", hint.id);
      label.append(hint);
    }
    inputFields.append(label);
  }
}

function inputOverride(entry, input, index) {
  const inputName = input.name ?? "";
  const queryValue =
    query.get(`arg${index}`) ??
    query.get(`input${index}`) ??
    (inputName ? query.get(inputName) : null);
  if (queryValue !== null) {
    return queryValue;
  }
  if (
    entry?.entry === "Vir.Fixtures.FormatPretty.formatPrettyAtWidth" &&
    index === 0
  ) {
    return "18";
  }
  return null;
}

function validatedManifestEntries(manifest) {
  const validated = validateInterfaceManifest(manifest);
  const diagnostics = manifestDiagnostics(validated);
  if (diagnostics.length > 0) {
    const lines = diagnostics.map(
      (diagnostic) =>
        `${diagnostic.name ?? "unknown"}: ${diagnostic.reason ?? "unsupported interface"}`,
    );
    throw new Error(
      `package contains unsupported interface exports:\n${lines.join("\n")}`,
    );
  }
  return validated.exports;
}

function renderManifestEntries(entries) {
  interfaceEntries = entries;
  entrySelect.replaceChildren();
  for (const entry of interfaceEntries) {
    const option = document.createElement("option");
    option.value = entry.id;
    const effect = formatInterfaceEffectPrefix(entry.effect);
    const signature = `${entry.args.map((arg) => formatInterfaceType(arg.type)).join(", ") || "()"} -> ${effect}${formatInterfaceType(entry.result)}`;
    option.textContent = `${entry.jsName} / ${signature}`;
    entrySelect.append(option);
  }
  selectEntryFromQuery();
  renderInputFields(selectedInterfaceEntry());
  if (interfaceEntries.length === 0) {
    resultOutput.textContent =
      "No callable interface exports were found in this package.";
  }
}

function entryUrl(entry) {
  const url = new URL(window.location.href);
  url.search = "";
  if (currentPackageSource?.packageQuery != null) {
    url.searchParams.set("package", currentPackageSource.packageQuery);
  }
  url.searchParams.set("entry", entry.id);
  return url;
}

function updateLocationForSelectedEntry() {
  if (currentPackageSource?.packageQuery == null) return;
  const entry = selectedInterfaceEntry();
  if (entry === null) return;
  window.history.replaceState(null, "", entryUrl(entry));
}

function renderPackageMetadata(metadata, packageInfo) {
  const targets = Array.isArray(metadata?.targets) ? metadata.targets : [];
  const compactTargets = targets.map((target) =>
    formatPackageTarget(target, { compact: true }),
  );
  const fullTargets = targets.map((target) => formatPackageTarget(target));
  const members = packageInfo?.packageSet?.members ?? [];
  const memberSummary =
    members.length === 0
      ? ""
      : ` · ${members.length} module${members.length === 1 ? "" : "s"}`;
  const memberDetails = members.map(
    (member) => `${member.role}: ${member.module} (${member.path})`,
  );

  exportCount.textContent = String(packageInfo.interfaceExports);
  sourceTargets.textContent = `${compactTargets.join(" / ") || "unknown"}${memberSummary}`;
  sourceTargets.title = [...fullTargets, ...memberDetails].join("\n");
  toolchain.textContent =
    metadata?.leanToolchain ?? metadata?.leanVersion ?? "unknown";
}

function parseInputValue(input, field) {
  const text = field?.value ?? inputDefault(input);
  switch (input.type?.interfaceTag) {
    case INTERFACE_TAG.NAT:
    case INTERFACE_TAG.UINT64:
    case INTERFACE_TAG.USIZE:
      return parseNatText(text);
    case INTERFACE_TAG.INT:
      return parseIntText(text);
    case INTERFACE_TAG.BOOL:
      if (field?.type === "checkbox") return Boolean(field.checked);
      if (String(text).trim() === "true") return true;
      if (String(text).trim() === "false") return false;
      throw new Error(`invalid Bool literal: ${text}`);
    case INTERFACE_TAG.STRING:
      return text;
    case INTERFACE_TAG.UINT8:
    case INTERFACE_TAG.UINT16:
    case INTERFACE_TAG.UINT32: {
      const value = Number(parseNatText(text));
      return value;
    }
    case INTERFACE_TAG.BYTE_ARRAY:
      return parseByteArrayInput(text);
    case INTERFACE_TAG.FLOAT:
    case INTERFACE_TAG.FLOAT32:
      return parseFloatText(text);
    case INTERFACE_TAG.SIMPLE_ENUM:
      return text.trim();
    case INTERFACE_TAG.EXPR:
    case INTERFACE_TAG.ARRAY:
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
    case INTERFACE_TAG.PROD:
    case INTERFACE_TAG.STRUCTURE:
    case INTERFACE_TAG.TAGGED_UNION:
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return JSON.parse(text);
    default:
      throw new Error(`unsupported input type: ${input.type?.type ?? "?"}`);
  }
}

function renderResult(value) {
  const text = formatResult(value);
  resultOutput.textContent = text;
  resultOutput.dataset.multiline = String(text.includes("\n"));
}

async function loadPackageSet(
  token,
  packageSource,
  irPackageSet,
  restoreState = null,
) {
  const { label } = packageSource;
  const candidate = await runtimeFactory.createRuntime({ irPackageSet });
  if (packageLoadGate.discardStale(token, () => candidate.dispose())) return;

  let entries;
  try {
    entries = validatedManifestEntries(candidate.interfaceManifest);
  } catch (error) {
    candidate.dispose();
    throw error;
  }

  const previousRuntime = runtime;
  const previousEntries = interfaceEntries;
  const previousPackageSource = currentPackageSource;
  runtime = candidate;
  currentPackageSource = packageSource;
  try {
    syncPackagePreset();
    packageName.textContent = label;
    packageSize.textContent = formatBytes(candidate.packageInfo.byteLength);
    declCount.textContent = String(candidate.packageInfo.count);
    ptrWidth.textContent = `${candidate.targetPointerBytes()} bytes`;
    renderManifestEntries(entries);
    if (restoreState !== null) restoreRunnerState(restoreState);
    renderPackageMetadata(candidate.packageMetadata, candidate.packageInfo);
    updateRuntimeControls();
    setReadyState(statusEl, "Ready", true);
    updateLocationForSelectedEntry();
  } catch (error) {
    runtime = previousRuntime;
    interfaceEntries = previousEntries;
    currentPackageSource = previousPackageSource;
    updateRuntimeControls();
    candidate.dispose();
    throw error;
  }
  previousRuntime?.dispose();
  if (requestedAutoRun) {
    requestedAutoRun = false;
    const entry = selectedInterfaceEntry();
    if (entry !== null) {
      renderResult(evaluateEntry(candidate, entry));
    }
  }
}

function captureRunnerState() {
  return {
    entryId: entrySelect.value,
    inputs: Array.from(inputFields.querySelectorAll("[data-input-index]"), (field) => ({
      value: field.value,
      checked: field.checked,
    })),
  };
}

function restoreRunnerState(state) {
  if (!interfaceEntries.some((entry) => entry.id === state.entryId)) return;
  entrySelect.value = state.entryId;
  renderInputFields(selectedInterfaceEntry());
  for (const [index, saved] of state.inputs.entries()) {
    const field = inputFields.querySelector(`[data-input-index='${index}']`);
    if (field === null) continue;
    field.value = saved.value;
    field.checked = saved.checked;
  }
}

function packageUrlSource(label) {
  return {
    label,
    packageQuery: label,
    load: async () => {
      const url = assetPathFor(label, import.meta.env.BASE_URL);
      return /\.irpkg-set\.json(?:[?#]|$)/u.test(label)
        ? url
        : [await fetchBytes(url)];
    },
  };
}

async function loadPackageUrl() {
  const token = beginPackageLoad();
  const label = packageUrl.value.trim() || defaultPackageFile;
  const source = packageUrlSource(label);
  try {
    await loadPackageSet(token, source, await source.load());
  } catch (error) {
    if (packageLoadGate.isCurrent(token)) showError(error, "Failed");
  } finally {
    finishPackageLoad(token);
  }
}

async function loadPackageFile(file) {
  const token = beginPackageLoad();
  const source = {
    label: file.name,
    packageQuery: null,
    load: async () => [new Uint8Array(await file.arrayBuffer())],
  };
  try {
    await loadPackageSet(token, source, await source.load());
  } catch (error) {
    if (packageLoadGate.isCurrent(token)) showError(error, "Failed");
  } finally {
    finishPackageLoad(token);
  }
}

async function reloadFailedRuntime() {
  const source = currentPackageSource;
  if (runtime?.failure == null || source === null || packageLoadPending) return;
  const state = captureRunnerState();
  requestedAutoRun = false;
  const token = beginPackageLoad();
  reloadingFailedRuntime = true;
  updateRuntimeControls();
  try {
    await loadPackageSet(token, source, await source.load(), state);
    if (packageLoadGate.isCurrent(token)) {
      resultOutput.textContent =
        "Fresh runtime ready. Run the selected entry to continue.";
      resultOutput.dataset.multiline = "false";
    }
  } catch (error) {
    if (packageLoadGate.isCurrent(token)) showError(error, "Failed");
  } finally {
    finishPackageLoad(token);
  }
}

function evaluateEntry(runtime, entry) {
  const inputs = entry.args ?? [];
  const values = inputs.map((input, index) => {
    const field = inputFields.querySelector(`[data-input-index='${index}']`);
    const value = parseInputValue(input, field);
    if (field && input.type?.interfaceTag === INTERFACE_TAG.BYTE_ARRAY) {
      field.value = value.join(", ");
    }
    return value;
  });
  return runtime.call(entry.entry, ...values);
}

function observeRuntimeFailure() {
  if (runtime?.failure != null) showError(runtime.failure, "Trap");
}

loadUrlButton.addEventListener("click", () => {
  void loadPackageUrl();
});

reloadRuntimeButton.addEventListener("click", () => {
  void reloadFailedRuntime();
});

packagePreset.addEventListener("change", () => {
  if (packagePreset.value === "") return;
  packageUrl.value = packagePreset.value;
  requestedEntry = null;
  void loadPackageUrl();
});

packageUrl.addEventListener("input", syncPackagePreset);

packageFile.addEventListener("change", () => {
  const file = packageFile.files?.[0];
  if (!file) return;
  void loadPackageFile(file);
});

entrySelect.addEventListener("change", () => {
  renderInputFields(selectedInterfaceEntry());
  resultOutput.textContent = "...";
  resultOutput.dataset.multiline = "false";
  updateLocationForSelectedEntry();
});

runEntryButton.addEventListener("click", () => {
  if (runtime === null || runtime.failure !== null || packageLoadPending) return;
  try {
    const entry = selectedInterfaceEntry();
    if (entry === null) {
      throw new Error("no interface entry selected");
    }
    const result = evaluateEntry(runtime, entry);
    renderResult(result);
    setReadyState(statusEl, "Ready", true);
  } catch (error) {
    showError(error, runtime.failure !== null ? "Trap" : "Failed");
  }
});

window.addEventListener("beforeunload", () => {
  packageLoadGate.begin();
  runtime?.dispose();
  runtime = null;
});

window.addEventListener("error", observeRuntimeFailure);
window.addEventListener("unhandledrejection", observeRuntimeFailure);

renderPackagePresets();
packageUrl.value = query.get("package") ?? defaultPackageFile;
syncPackagePreset();

void loadPackageUrl();
