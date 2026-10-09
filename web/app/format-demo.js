/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import { prettyPackageFile, wasmPublicFile } from "./pages/browser-packages.js";
import { errorMessage, setReadyState } from "./pages/page-utils.js";
import { createVirRuntimeFactory, fetchBytes } from "../src/vir-runtime.js";

const cases = [
  {
    id: "group",
    source: 'Format.group ("hello" ++ Format.line ++ "world")',
  },
  {
    id: "list",
    source: [
      "Format.group <|",
      "  Format.nest 1 <|",
      '    "[" ++ "alpha," ++ Format.line ++',
      '    "beta," ++ Format.line ++',
      '    "gamma" ++ "]"',
    ].join("\n"),
  },
  {
    id: "fill",
    source: [
      "Format.fill <|",
      '  "lean" ++ Format.line ++',
      '  "ir" ++ Format.line ++',
      '  "runs" ++ Format.line ++',
      '  "format.pretty" ++ Format.line ++',
      '  "inside wasm"',
    ].join("\n"),
  },
  {
    id: "nested",
    source: 'Format.nest 2 ("." ++ Format.align false ++ "a" ++ Format.line ++ "b")',
  },
  {
    id: "all",
    source: [
      "formatPrettyAtWidth width",
      "",
      "-- group, list, fill, and nested examples",
    ].join("\n"),
  },
];

const caseById = new Map(cases.map((entry) => [entry.id, entry]));
const query = new URLSearchParams(window.location.search);
const statusEl = document.querySelector("#format-status");
const reloadRuntimeButton = document.querySelector("#format-reload-runtime");
const exportCountEl = document.querySelector("#format-export-count");
const durationEl = document.querySelector("#format-duration");
const widthRange = document.querySelector("#format-width-range");
const widthInput = document.querySelector("#format-width-input");
const widthReadout = document.querySelector("#format-width-readout");
const rulerEl = document.querySelector("#format-ruler");
const outputEl = document.querySelector("#format-output");
const sourceEl = document.querySelector("#format-source");
const caseButtons = Array.from(document.querySelectorAll("[data-case]"));
const runtimeFactory = createVirRuntimeFactory({
  wasmUrl: `${import.meta.env.BASE_URL}${wasmPublicFile}`,
});

let runtime = null;
let activeCase = normalizeCase(query.get("case") ?? "list");
let loadGeneration = 0;
let loadingRuntime = false;

function normalizeCase(value) {
  return caseById.has(value) ? value : "list";
}

function clampWidth(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 18;
  return Math.min(40, Math.max(4, parsed));
}

function setWidth(value) {
  const width = clampWidth(value);
  widthRange.value = String(width);
  widthInput.value = String(width);
  widthReadout.textContent = String(width);
  rulerEl.textContent = `|${"-".repeat(width)}| ${width}`;
  return width;
}

function setActiveCase(value) {
  activeCase = normalizeCase(value);
  for (const button of caseButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.case === activeCase));
  }
  sourceEl.textContent = caseById.get(activeCase)?.source ?? "";
}

function updateUrl(width) {
  const next = new URL(window.location.href);
  next.searchParams.set("case", activeCase);
  next.searchParams.set("width", String(width));
  window.history.replaceState(null, "", next);
}

function renderError(error) {
  if (runtime?.failure != null) {
    try {
      runtime.dispose();
    } catch (cleanupError) {
      console.error("failed to dispose trapped format runtime", cleanupError);
    }
  }
  const message = errorMessage(error);
  outputEl.textContent = message;
  durationEl.textContent = "Trap";
  setReadyState(statusEl, runtime?.failure != null ? "Trap" : "Failed", false);
  updateRuntimeControls();
  console.error(error);
}

function updateRuntimeControls() {
  const failed = runtime?.failure != null;
  const usable = runtime !== null && !failed && !loadingRuntime;
  for (const button of caseButtons) button.disabled = !usable;
  widthRange.disabled = !usable;
  widthInput.disabled = !usable;
  reloadRuntimeButton.hidden = !failed;
  reloadRuntimeButton.disabled = loadingRuntime;
}

function render() {
  if (runtime === null || runtime.failure !== null || loadingRuntime) {
    updateRuntimeControls();
    return;
  }
  try {
    const width = setWidth(widthInput.value);
    setActiveCase(activeCase);
    const start = performance.now();
    const value = runtime.call("Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth", activeCase, width);
    const elapsed = performance.now() - start;
    outputEl.textContent = value;
    durationEl.textContent = `${elapsed.toFixed(2)} ms`;
    setReadyState(statusEl, "Ready", true);
    updateUrl(width);
    updateRuntimeControls();
  } catch (error) {
    renderError(error);
  }
}

async function loadRuntime() {
  const generation = ++loadGeneration;
  loadingRuntime = true;
  setReadyState(statusEl, "Loading", false);
  updateRuntimeControls();
  try {
    const packageBytes = await fetchBytes(
      `${import.meta.env.BASE_URL}${prettyPackageFile}`,
    );
    const candidate = await runtimeFactory.createRuntime({
      irPackageSet: [packageBytes],
    });
    if (generation !== loadGeneration) {
      candidate.dispose();
      return;
    }
    const previousRuntime = runtime;
    runtime = candidate;
    previousRuntime?.dispose();
    exportCountEl.textContent = String(runtime.packageInfo.interfaceExports);
    loadingRuntime = false;
    updateRuntimeControls();
    render();
  } catch (error) {
    if (generation !== loadGeneration) return;
    loadingRuntime = false;
    renderError(error);
  }
}

for (const button of caseButtons) {
  button.addEventListener("click", () => {
    setActiveCase(button.dataset.case);
    render();
  });
}

reloadRuntimeButton.addEventListener("click", () => {
  if (runtime?.failure == null || loadingRuntime) return;
  void loadRuntime();
});

widthRange.addEventListener("input", () => {
  widthInput.value = widthRange.value;
  render();
});

widthInput.addEventListener("input", () => {
  setWidth(widthInput.value);
  render();
});

setReadyState(statusEl, "Loading", false);
setWidth(query.get("width") ?? "18");
setActiveCase(activeCase);
updateRuntimeControls();
void loadRuntime();
