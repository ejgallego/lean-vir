/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import { createVirRuntimeFactory, fetchBytes } from "./vir-runtime.js";

const statusEl = document.querySelector("#status");
const packageName = document.querySelector("#dev-package-name");
const packageSize = document.querySelector("#dev-package-size");
const declCount = document.querySelector("#dev-decl-count");
const exportCount = document.querySelector("#dev-export-count");
const ptrWidth = document.querySelector("#dev-ptr-width");
const sourceTargets = document.querySelector("#dev-source-targets");
const toolchain = document.querySelector("#dev-toolchain");
const generatedAt = document.querySelector("#dev-generated-at");
const packageUrl = document.querySelector("#dev-package-url");
const packageFile = document.querySelector("#dev-package-file");
const loadUrlButton = document.querySelector("#dev-load-url");
const entrySelect = document.querySelector("#dev-entry-select");
const inputFields = document.querySelector("#dev-input-fields");
const runEntryButton = document.querySelector("#dev-run-entry");
const resultOutput = document.querySelector("#dev-result");
const wasmFile = "vir-upstream.wasm";
const runtimeFactory = createVirRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmFile}` });
const query = new URLSearchParams(window.location.search);

let runtime = null;
let interfaceEntries = [];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function setStatus(text, ready) {
  statusEl.textContent = text;
  statusEl.dataset.ready = String(ready);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function showError(error, status = "Failed") {
  resultOutput.textContent = errorMessage(error);
  setStatus(status, false);
  console.error(error);
}

function assetPathFor(text) {
  if (/^(https?:)?\/\//.test(text) || text.startsWith("/")) {
    return text;
  }
  return `${import.meta.env.BASE_URL}${text}`;
}

function resetPackageState() {
  runtime = null;
  interfaceEntries = [];
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
  const entryId = query.get("entry");
  if (!entryId) return;
  const match = interfaceEntries.find((entry) =>
    entry.id === entryId || entry.jsName === entryId || entry.entry === entryId);
  if (match) {
    entrySelect.value = match.id;
  }
}

function inputDefault(input) {
  const value = defaultValueForType(input.type);
  return typeof value === "string" ? value : JSON.stringify(value);
}

function defaultValueForType(type) {
  switch (type?.wireTag) {
    case 0:
    case 1:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
      return 0;
    case 2:
      return false;
    case 3:
      return "";
    case 9:
      return [];
    case 15:
      return { kind: "const", name: "Nat", levels: [] };
    case 16:
    case 17:
      return [];
    case 18:
      return null;
    case 19:
      return {
        fst: defaultValueForType(type?.fst),
        snd: defaultValueForType(type?.snd),
      };
    case 14:
      return type?.constructors?.[0]?.jsName ?? "";
    default:
      return "";
  }
}

function isJsonInputTag(tag) {
  return tag === 15 || tag === 16 || tag === 17 || tag === 18 || tag === 19;
}

function isLegacyArrayInputTag(tag) {
  return tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 13;
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
    caption.textContent = `${input.name ?? `input${index + 1}`} : ${input.type?.type ?? "?"}`;
    const field =
      input.type?.wireTag === 14 ? document.createElement("select") :
      isJsonInputTag(input.type?.wireTag) ? document.createElement("textarea") :
      document.createElement("input");
    field.id = inputFieldId(input, index);
    field.dataset.inputIndex = String(index);
    if (input.type?.wireTag === 14) {
      for (const ctor of input.type?.constructors ?? []) {
        const option = document.createElement("option");
        option.value = ctor.jsName ?? ctor.name;
        option.textContent = ctor.jsName ?? ctor.name;
        field.append(option);
      }
      field.value = inputDefault(input);
    } else if (input.type?.wireTag === 0 || input.type?.wireTag === 4 || input.type?.wireTag === 5 || input.type?.wireTag === 6) {
      field.type = "number";
      field.inputMode = "numeric";
      field.min = "0";
    } else if (isJsonInputTag(input.type?.wireTag)) {
      field.spellcheck = false;
    } else if (input.type?.wireTag === 2) {
      field.type = "text";
      field.inputMode = "text";
    } else {
      field.type = "text";
      field.inputMode = "text";
    }
    if (input.type?.wireTag !== 14) {
      field.value = inputDefault(input);
    }
    label.append(caption, field);
    inputFields.append(label);
  }
}

function renderManifestEntries(manifest) {
  if (manifest?.version !== 1 || typeof manifest.metadata !== "object" || !Array.isArray(manifest.exports)) {
    throw new Error("embedded interface manifest must be { version: 1, metadata: {...}, exports: [...] }");
  }
  if (Array.isArray(manifest.diagnostics) && manifest.diagnostics.length > 0) {
    const lines = manifest.diagnostics.map((diagnostic) =>
      `${diagnostic.name ?? "unknown"}: ${diagnostic.reason ?? "unsupported interface"}`);
    throw new Error(`package contains unsupported interface exports:\n${lines.join("\n")}`);
  }
  interfaceEntries = manifest.exports;
  entrySelect.replaceChildren();
  for (const entry of interfaceEntries) {
    const option = document.createElement("option");
    option.value = entry.id;
    const signature = `${entry.args.map((arg) => arg.type?.type ?? "?").join(", ") || "()"} -> ${entry.result?.type ?? "?"}`;
    option.textContent = `${entry.jsName} / ${signature}`;
    entrySelect.append(option);
  }
  selectEntryFromQuery();
  renderInputFields(selectedInterfaceEntry());
  if (interfaceEntries.length === 0) {
    resultOutput.textContent = "No callable interface exports were found in this package.";
  }
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

function parseNatInput(text) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  return trimmed;
}

function parseIntInput(text) {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`invalid Int literal: ${text}`);
  }
  return trimmed;
}

function parseNatArrayInput(text) {
  const parts = text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid Nat literal: ${part}`);
    }
    return part;
  });
}

function parseStringListInput(text) {
  if (text.trim() === "") return [];
  return text.split(",").map((part) => part.trim());
}

function parseUInt32ArrayInput(text) {
  const parts = text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid UInt32 literal: ${part}`);
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error("UInt32 values must be in 0..4294967295");
    }
    return value;
  });
}

function parseByteArrayInput(text) {
  const parts = text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid byte literal: ${part}`);
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("ByteArray values must be in 0..255");
    }
    return value;
  });
}

function parseInputValue(input, text) {
  switch (input.type?.wireTag) {
    case 0:
    case 7:
    case 8:
      return parseNatInput(text);
    case 1:
      return parseIntInput(text);
    case 2:
      if (text.trim() === "true") return true;
      if (text.trim() === "false") return false;
      throw new Error(`invalid Bool literal: ${text}`);
    case 3:
      return text;
    case 4:
    case 5:
    case 6: {
      const value = Number(parseNatInput(text));
      return value;
    }
    case 9:
      return parseByteArrayInput(text);
    case 10:
    case 12:
      return parseNatArrayInput(text);
    case 11:
      return parseUInt32ArrayInput(text);
    case 13:
      return parseStringListInput(text);
    case 14:
      return text.trim();
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
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

async function loadIrPackageBytes(label, bytes) {
  runtime = await runtimeFactory.createRuntime({ irPackageBytes: bytes });
  packageName.textContent = label;
  packageSize.textContent = formatBytes(runtime.packageInfo.byteLength);
  declCount.textContent = String(runtime.packageInfo.count);
  ptrWidth.textContent = `${runtime.targetPointerBytes()} bytes`;
  renderManifestEntries(runtime.interfaceManifest);
  renderPackageMetadata(runtime.packageMetadata);
  runEntryButton.disabled = interfaceEntries.length === 0;
  setStatus("Ready", true);
}

async function loadPackageUrl() {
  resetPackageState();
  setStatus("Loading", false);
  const label = packageUrl.value.trim() || "vir-demo.irpkg";
  const bytes = await fetchBytes(assetPathFor(label));
  await loadIrPackageBytes(label, bytes);
}

async function loadPackageFile(file) {
  resetPackageState();
  setStatus("Loading", false);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadIrPackageBytes(file.name, bytes);
}

function evaluateEntry(runtime, entry) {
  const inputs = entry.args ?? [];
  const values = inputs.map((input, index) => {
    const field = inputFields.querySelector(`[data-input-index='${index}']`);
    const value = parseInputValue(input, field?.value ?? inputDefault(input));
    if (field && Array.isArray(value) && isLegacyArrayInputTag(input.type?.wireTag)) {
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
});

runEntryButton.addEventListener("click", () => {
  if (runtime === null) return;
  try {
    const entry = selectedInterfaceEntry();
    if (entry === null) {
      throw new Error("no interface entry selected");
    }
    const result = evaluateEntry(runtime, entry);
    resultOutput.textContent = formatResult(result);
    setStatus("Ready", true);
  } catch (error) {
    showError(error, "Trap");
  }
});

packageUrl.value = query.get("package") ?? "vir-demo.irpkg";

loadPackageUrl().catch((error) => {
  showError(error, "Failed");
});
