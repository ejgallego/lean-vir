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
import { formatInterfaceType, manifestDiagnostics, validateInterfaceManifest } from "./runtime/interface-manifest.js";
import { createBrowserReactRuntimeFactory } from "./browser-react-runtime.js";
import { defaultPackageFile, packagePresets } from "./pages/browser-packages.js";
import { parseByteArrayInput, parseFloatText, parseIntText, parseNatText } from "./pages/input-parsers.js";
import { assetPathFor, errorMessage, formatBytes, setReadyState } from "./pages/page-utils.js";
import { fetchBytes } from "./vir-runtime.js";
import { WIRE } from "./runtime/wire-tags.js";

const statusEl = document.querySelector("#status");
const packageName = document.querySelector("#dev-package-name");
const packageSize = document.querySelector("#dev-package-size");
const declCount = document.querySelector("#dev-decl-count");
const exportCount = document.querySelector("#dev-export-count");
const ptrWidth = document.querySelector("#dev-ptr-width");
const sourceTargets = document.querySelector("#dev-source-targets");
const toolchain = document.querySelector("#dev-toolchain");
const generatedAt = document.querySelector("#dev-generated-at");
const packagePreset = document.querySelector("#dev-package-preset");
const packageUrl = document.querySelector("#dev-package-url");
const packageFile = document.querySelector("#dev-package-file");
const loadUrlButton = document.querySelector("#dev-load-url");
const entrySelect = document.querySelector("#dev-entry-select");
const inputFields = document.querySelector("#dev-input-fields");
const runEntryButton = document.querySelector("#dev-run-entry");
const resultOutput = document.querySelector("#dev-result");
const wasmFile = "vir-upstream.wasm";
const runtimeFactory = createBrowserReactRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmFile}` });
const query = new URLSearchParams(window.location.search);
let requestedEntry = query.get("entry");
let requestedAutoRun = query.get("run") === "1";

let runtime = null;
let interfaceEntries = [];
let currentPackageQuery = null;

function showError(error, status = "Failed") {
  resultOutput.textContent = errorMessage(error);
  setReadyState(statusEl, status, false);
  console.error(error);
}

function resetPackageState() {
  runtime?.dispose();
  runtime = null;
  interfaceEntries = [];
  currentPackageQuery = null;
  runEntryButton.disabled = true;
  entrySelect.replaceChildren();
  inputFields.replaceChildren();
  resultOutput.textContent = "...";
  packageName.textContent = "...";
  packageSize.textContent = "...";
  declCount.textContent = "...";
  exportCount.textContent = "...";
  ptrWidth.textContent = "...";
  sourceTargets.textContent = "...";
  sourceTargets.removeAttribute("title");
  toolchain.textContent = "...";
  generatedAt.textContent = "...";
}

function selectedInterfaceEntry() {
  return interfaceEntries.find((entry) => entry.id === entrySelect.value) ?? null;
}

function selectEntryFromQuery() {
  const entryId = requestedEntry;
  if (!entryId) return;
  const match = interfaceEntries.find((entry) =>
    entry.id === entryId || entry.jsName === entryId || entry.entry === entryId);
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
  packagePreset.value = packagePresets.some((preset) => preset.file === value) ? value : "";
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
    const field = document.createElement(interfaceInputTag(input.type).toLowerCase());
    field.id = inputFieldId(input, index);
    field.dataset.inputIndex = String(index);
    if (input.type?.wireTag === WIRE.SIMPLE_ENUM) {
      for (const ctor of input.type?.constructors ?? []) {
        const option = document.createElement("option");
        option.value = ctor.jsName ?? ctor.name;
        option.textContent = ctor.jsName ?? ctor.name;
        field.append(option);
      }
      field.value = inputDefault(input);
    } else if (input.type?.wireTag === WIRE.NAT ||
        input.type?.wireTag === WIRE.UINT8 ||
        input.type?.wireTag === WIRE.UINT16 ||
        input.type?.wireTag === WIRE.UINT32) {
      field.type = "number";
      field.inputMode = "numeric";
      field.min = "0";
    } else if (input.type?.wireTag === WIRE.FLOAT || input.type?.wireTag === WIRE.FLOAT32) {
      field.type = "text";
      field.inputMode = "decimal";
    } else if (isJsonInputTag(input.type?.wireTag)) {
      field.spellcheck = false;
    } else if (input.type?.wireTag === WIRE.BOOL) {
      label.classList.add("dev-checkbox-field");
      field.type = "checkbox";
      field.checked = parseBoolText(inputOverride(entry, input, index) ?? inputDefault(input));
    } else {
      field.type = "text";
      field.inputMode = "text";
    }
    if (input.type?.wireTag !== WIRE.SIMPLE_ENUM && input.type?.wireTag !== WIRE.BOOL) {
      field.value = inputOverride(entry, input, index) ?? inputDefault(input);
    }
    label.append(caption, field);
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
  if (entry?.entry === "Vir.Fixtures.FormatPretty.formatPrettyAtWidth" && index === 0) {
    return "18";
  }
  return null;
}

function renderManifestEntries(manifest) {
  validateInterfaceManifest(manifest);
  const diagnostics = manifestDiagnostics(manifest);
  if (diagnostics.length > 0) {
    const lines = diagnostics.map((diagnostic) =>
      `${diagnostic.name ?? "unknown"}: ${diagnostic.reason ?? "unsupported interface"}`);
    throw new Error(`package contains unsupported interface exports:\n${lines.join("\n")}`);
  }
  interfaceEntries = manifest.exports;
  entrySelect.replaceChildren();
  for (const entry of interfaceEntries) {
    const option = document.createElement("option");
    option.value = entry.id;
    const effect = entry.effect === "io" ? "IO " : "";
    const signature = `${entry.args.map((arg) => formatInterfaceType(arg.type)).join(", ") || "()"} -> ${effect}${formatInterfaceType(entry.result)}`;
    option.textContent = `${entry.jsName} / ${signature}`;
    entrySelect.append(option);
  }
  selectEntryFromQuery();
  renderInputFields(selectedInterfaceEntry());
  if (interfaceEntries.length === 0) {
    resultOutput.textContent = "No callable interface exports were found in this package.";
  }
}

function entryUrl(entry) {
  const url = new URL(window.location.href);
  url.search = "";
  if (currentPackageQuery !== null) {
    url.searchParams.set("package", currentPackageQuery);
  }
  url.searchParams.set("entry", entry.id);
  return url;
}

function updateLocationForSelectedEntry() {
  if (currentPackageQuery === null) return;
  const entry = selectedInterfaceEntry();
  if (entry === null) return;
  window.history.replaceState(null, "", entryUrl(entry));
}

function renderPackageMetadata(metadata) {
  const targets = Array.isArray(metadata?.targets) ? metadata.targets : [];
  const compactTargets = targets.map((target) => {
    const roots = Array.isArray(target.resolvedRoots) ? target.resolvedRoots.length : 0;
    return `${target.source ?? "unknown"} [${target.mode ?? "?"}: ${roots} roots]`;
  });
  const fullTargets = targets.map((target) => {
    const roots = Array.isArray(target.resolvedRoots) && target.resolvedRoots.length > 0
      ? target.resolvedRoots.join(", ")
      : "(none)";
    return `${target.source ?? "unknown"} [${target.mode ?? "?"}] roots: ${roots}`;
  });

  exportCount.textContent = String(runtime.packageInfo.interfaceExports);
  sourceTargets.textContent = compactTargets.join(" / ") || "unknown";
  sourceTargets.title = fullTargets.join("\n");
  toolchain.textContent = metadata?.leanToolchain ?? metadata?.leanVersion ?? "unknown";
  generatedAt.textContent = metadata?.generatedAt ?? "unknown";
}

function parseInputValue(input, field) {
  const text = field?.value ?? inputDefault(input);
  switch (input.type?.wireTag) {
    case WIRE.NAT:
    case WIRE.UINT64:
    case WIRE.USIZE:
      return parseNatText(text);
    case WIRE.INT:
      return parseIntText(text);
    case WIRE.BOOL:
      if (field?.type === "checkbox") return Boolean(field.checked);
      if (String(text).trim() === "true") return true;
      if (String(text).trim() === "false") return false;
      throw new Error(`invalid Bool literal: ${text}`);
    case WIRE.STRING:
      return text;
    case WIRE.UINT8:
    case WIRE.UINT16:
    case WIRE.UINT32: {
      const value = Number(parseNatText(text));
      return value;
    }
    case WIRE.BYTE_ARRAY:
      return parseByteArrayInput(text);
    case WIRE.FLOAT:
    case WIRE.FLOAT32:
      return parseFloatText(text);
    case WIRE.SIMPLE_ENUM:
      return text.trim();
    case WIRE.EXPR:
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
    case WIRE.PROD:
    case WIRE.STRUCTURE:
    case WIRE.TAGGED_UNION:
    case WIRE.CUSTOM_INDUCTIVE:
      return JSON.parse(text);
    default:
      throw new Error(`unsupported input type: ${input.type?.type ?? "?"}`);
  }
}

function formatResult(value) {
  if (value instanceof Uint8Array) return Array.from(value).join(", ");
  if (value !== null && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function renderResult(value) {
  const text = formatResult(value);
  resultOutput.textContent = text;
  resultOutput.dataset.multiline = String(text.includes("\n"));
}

async function loadIrPackageBytes(label, bytes, packageQuery = null) {
  currentPackageQuery = packageQuery;
  runtime = await runtimeFactory.createRuntime({ irPackageBytes: bytes });
  syncPackagePreset();
  packageName.textContent = label;
  packageSize.textContent = formatBytes(runtime.packageInfo.byteLength);
  declCount.textContent = String(runtime.packageInfo.count);
  ptrWidth.textContent = `${runtime.targetPointerBytes()} bytes`;
  renderManifestEntries(runtime.interfaceManifest);
  renderPackageMetadata(runtime.packageMetadata);
  runEntryButton.disabled = interfaceEntries.length === 0;
  setReadyState(statusEl, "Ready", true);
  updateLocationForSelectedEntry();
  if (requestedAutoRun) {
    requestedAutoRun = false;
    const entry = selectedInterfaceEntry();
    if (entry !== null) {
      renderResult(evaluateEntry(runtime, entry));
    }
  }
}

async function loadPackageUrl() {
  resetPackageState();
  setReadyState(statusEl, "Loading", false);
  const label = packageUrl.value.trim() || defaultPackageFile;
  const bytes = await fetchBytes(assetPathFor(label, import.meta.env.BASE_URL));
  await loadIrPackageBytes(label, bytes, label);
}

async function loadPackageFile(file) {
  resetPackageState();
  setReadyState(statusEl, "Loading", false);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadIrPackageBytes(file.name, bytes);
}

function evaluateEntry(runtime, entry) {
  const inputs = entry.args ?? [];
  const values = inputs.map((input, index) => {
    const field = inputFields.querySelector(`[data-input-index='${index}']`);
    const value = parseInputValue(input, field);
    if (field && input.type?.wireTag === WIRE.BYTE_ARRAY) {
      field.value = value.join(", ");
    }
    return value;
  });
  return runtime.call(entry.entry, ...values);
}

loadUrlButton.addEventListener("click", () => {
  loadPackageUrl().catch((error) => {
    showError(error, "Failed");
  });
});

packagePreset.addEventListener("change", () => {
  if (packagePreset.value === "") return;
  packageUrl.value = packagePreset.value;
  requestedEntry = null;
  loadPackageUrl().catch((error) => {
    showError(error, "Failed");
  });
});

packageUrl.addEventListener("input", syncPackagePreset);

packageFile.addEventListener("change", () => {
  const file = packageFile.files?.[0];
  if (!file) return;
  loadPackageFile(file).catch((error) => {
    showError(error, "Failed");
  });
});

entrySelect.addEventListener("change", () => {
  renderInputFields(selectedInterfaceEntry());
  resultOutput.textContent = "...";
  resultOutput.dataset.multiline = "false";
  updateLocationForSelectedEntry();
});

runEntryButton.addEventListener("click", () => {
  if (runtime === null) return;
  try {
    const entry = selectedInterfaceEntry();
    if (entry === null) {
      throw new Error("no interface entry selected");
    }
    const result = evaluateEntry(runtime, entry);
    renderResult(result);
    setReadyState(statusEl, "Ready", true);
  } catch (error) {
    showError(error, "Trap");
  }
});

renderPackagePresets();
packageUrl.value = query.get("package") ?? defaultPackageFile;
syncPackagePreset();

loadPackageUrl().catch((error) => {
  showError(error, "Failed");
});
