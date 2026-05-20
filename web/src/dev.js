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
const ptrWidth = document.querySelector("#dev-ptr-width");
const packageUrl = document.querySelector("#dev-package-url");
const packageFile = document.querySelector("#dev-package-file");
const loadUrlButton = document.querySelector("#dev-load-url");
const specUrl = document.querySelector("#dev-spec-url");
const specFile = document.querySelector("#dev-spec-file");
const loadSpecUrlButton = document.querySelector("#dev-load-spec-url");
const inputSpecText = document.querySelector("#dev-input-spec");
const applySpecButton = document.querySelector("#dev-apply-spec");
const entrySelect = document.querySelector("#dev-entry-select");
const inputFields = document.querySelector("#dev-input-fields");
const runEntryButton = document.querySelector("#dev-run-entry");
const resultOutput = document.querySelector("#dev-result");
const wasmFile = "vir-upstream.wasm";
const runtimeFactory = createVirRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmFile}` });
const query = new URLSearchParams(window.location.search);

let runtime = null;
let inputSpec = null;

const defaultInputSpec = {
  version: 1,
  entries: [
    {
      id: "demo-constant",
      entry: "SortDemo.demo",
      result: { type: "Nat" },
      inputs: [],
    },
    {
      id: "fib",
      entry: "fib",
      result: { type: "Nat" },
      inputs: [
        {
          name: "n",
          type: "Nat",
          defaultValue: "8",
          min: 0,
          max: 17,
        },
      ],
    },
    {
      id: "sort-array",
      entry: "SortDemo.demoFromArray",
      result: { type: "Nat" },
      inputs: [
        {
          name: "values",
          type: "Array Nat",
          defaultValue: "7, 3, 9, 1, 4, 1, 5, 2",
          maxItems: 16,
          maxValue: 9999,
        },
      ],
    },
  ],
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function setStatus(text, ready) {
  statusEl.textContent = text;
  statusEl.dataset.ready = String(ready);
}

function assetPathFor(text) {
  if (/^(https?:)?\/\//.test(text) || text.startsWith("/")) {
    return text;
  }
  return `${import.meta.env.BASE_URL}${text}`;
}

function resetPackageState() {
  runtime = null;
  runEntryButton.disabled = true;
  resultOutput.textContent = "...";
  packageName.textContent = "...";
  packageSize.textContent = "...";
  declCount.textContent = "...";
  ptrWidth.textContent = "...";
}

function normalizeInputSpec(spec) {
  if (spec?.version !== 1 || !Array.isArray(spec.entries)) {
    throw new Error("input spec must be { version: 1, entries: [...] }");
  }
  return {
    version: 1,
    entries: spec.entries.map((entry, index) => {
      if (!entry.entry || typeof entry.entry !== "string") {
        throw new Error(`input spec entry ${index} is missing an entry name`);
      }
      return {
        id: entry.id ?? entry.entry,
        entry: entry.entry,
        result: entry.result ?? { type: "Nat" },
        inputs: entry.inputs ?? [],
      };
    }),
  };
}

function selectedSpecEntry() {
  return inputSpec?.entries.find((entry) => entry.id === entrySelect.value) ?? null;
}

function selectEntryFromQuery() {
  const entryId = query.get("entry");
  if (entryId && inputSpec?.entries.some((entry) => entry.id === entryId)) {
    entrySelect.value = entryId;
  }
}

function inputDefault(input) {
  return input.defaultValue ?? input.default ?? "";
}

function inputFieldId(input, index) {
  return `dev-entry-input-${index}-${input.name ?? "input"}`;
}

function renderInputFields(entry) {
  inputFields.replaceChildren();
  const inputs = entry?.inputs ?? [];
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
    caption.textContent = `${input.name ?? `input${index + 1}`} : ${input.type}`;
    const field = document.createElement("input");
    field.id = inputFieldId(input, index);
    field.value = inputDefault(input);
    field.dataset.inputIndex = String(index);
    if (input.type === "Nat") {
      field.type = "number";
      field.inputMode = "numeric";
      field.min = String(input.min ?? 0);
      if (input.max !== undefined) {
        field.max = String(input.max);
      }
    } else {
      field.type = "text";
      field.inputMode = "text";
    }
    label.append(caption, field);
    inputFields.append(label);
  }
}

function renderInputSpec(spec) {
  inputSpec = normalizeInputSpec(spec);
  inputSpecText.value = JSON.stringify(inputSpec, null, 2);
  entrySelect.replaceChildren();
  for (const entry of inputSpec.entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.id} -> ${entry.entry}`;
    entrySelect.append(option);
  }
  selectEntryFromQuery();
  renderInputFields(selectedSpecEntry());
}

function parseNatInput(text, input) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  const min = input.min ?? 0;
  const max = input.max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, value));
}

function parseNatArrayInput(text, input) {
  const parts = text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
  const maxItems = input.maxItems ?? 1024;
  const maxValue = input.maxValue ?? Number.MAX_SAFE_INTEGER;
  if (parts.length > maxItems) {
    throw new Error(`Array Nat input is capped at ${maxItems} items`);
  }
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid Nat literal: ${part}`);
    }
    const value = Number(part);
    if (!Number.isSafeInteger(value) || value > maxValue) {
      throw new Error(`Array Nat value is capped at ${maxValue}`);
    }
    return value;
  });
}

async function loadIrPackageBytes(label, bytes) {
  runtime = await runtimeFactory.createRuntime({ irPackageBytes: bytes });
  packageName.textContent = label;
  packageSize.textContent = formatBytes(runtime.packageInfo.byteLength);
  declCount.textContent = String(runtime.packageInfo.count);
  ptrWidth.textContent = `${runtime.targetPointerBytes()} bytes`;
  runEntryButton.disabled = false;
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

async function loadSpecUrl() {
  const label = specUrl.value.trim();
  if (!label) return;
  setStatus("Loading Spec", false);
  const bytes = await fetchBytes(assetPathFor(label));
  renderInputSpec(JSON.parse(new TextDecoder().decode(bytes)));
  setStatus(runtime === null ? "No package" : "Ready", runtime !== null);
}

async function loadSpecFile(file) {
  setStatus("Loading Spec", false);
  const text = await file.text();
  renderInputSpec(JSON.parse(text));
  setStatus(runtime === null ? "No package" : "Ready", runtime !== null);
}

function evaluateEntry(runtime, entry) {
  if (entry.result?.type !== "Nat") {
    throw new Error(`unsupported result type: ${entry.result?.type}`);
  }
  const inputs = entry.inputs ?? [];
  if (inputs.length === 0) {
    return runtime.evalConstNat(entry.entry);
  }
  if (inputs.length !== 1) {
    throw new Error("the developer runner currently supports zero or one input");
  }

  const input = inputs[0];
  const field = inputFields.querySelector("[data-input-index='0']");
  const text = field?.value ?? inputDefault(input);
  if (input.type === "Nat") {
    const value = parseNatInput(text, input);
    if (field) field.value = String(value);
    return runtime.evalNatToNat(entry.entry, value);
  }
  if (input.type === "Array Nat") {
    const values = parseNatArrayInput(text, input);
    if (field) field.value = values.join(", ");
    return runtime.evalNatArrayToNat(entry.entry, values);
  }
  throw new Error(`unsupported input type: ${input.type}`);
}

loadUrlButton.addEventListener("click", () => {
  loadPackageUrl().catch((error) => {
    resultOutput.textContent = "error";
    setStatus("Failed", false);
    console.error(error);
  });
});

packageFile.addEventListener("change", () => {
  const file = packageFile.files?.[0];
  if (!file) return;
  loadPackageFile(file).catch((error) => {
    resultOutput.textContent = "error";
    setStatus("Failed", false);
    console.error(error);
  });
});

loadSpecUrlButton.addEventListener("click", () => {
  loadSpecUrl().catch((error) => {
    resultOutput.textContent = "spec error";
    setStatus("Spec Error", false);
    console.error(error);
  });
});

specFile.addEventListener("change", () => {
  const file = specFile.files?.[0];
  if (!file) return;
  loadSpecFile(file).catch((error) => {
    resultOutput.textContent = "spec error";
    setStatus("Spec Error", false);
    console.error(error);
  });
});

applySpecButton.addEventListener("click", () => {
  try {
    renderInputSpec(JSON.parse(inputSpecText.value));
    resultOutput.textContent = "...";
    setStatus(runtime === null ? "No package" : "Ready", runtime !== null);
  } catch (error) {
    resultOutput.textContent = "spec error";
    setStatus("Spec Error", false);
    console.error(error);
  }
});

entrySelect.addEventListener("change", () => {
  renderInputFields(selectedSpecEntry());
  resultOutput.textContent = "...";
});

runEntryButton.addEventListener("click", () => {
  if (runtime === null) return;
  try {
    const entry = selectedSpecEntry();
    if (entry === null) {
      throw new Error("no input spec entry selected");
    }
    resultOutput.textContent = evaluateEntry(runtime, entry);
    setStatus("Ready", true);
  } catch (error) {
    resultOutput.textContent = "error";
    setStatus("Trap", false);
    console.error(error);
  }
});

packageUrl.value = query.get("package") ?? "vir-demo.irpkg";
specUrl.value = query.get("spec") ?? "";
renderInputSpec(defaultInputSpec);

if (query.has("spec")) {
  loadSpecUrl().catch((error) => {
    console.warn(error);
  });
}

loadPackageUrl().catch((error) => {
  setStatus("Failed", false);
  resultOutput.textContent = "error";
  console.error(error);
});
