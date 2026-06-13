/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import { prettyPackageFile, wasmPublicFile } from "./pages/browser-packages.js";
import { errorMessage, setReadyState } from "./pages/page-utils.js";
import { createVirRuntimeFactory } from "./vir-runtime.js";

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
  const message = errorMessage(error);
  outputEl.textContent = message;
  durationEl.textContent = "Trap";
  setReadyState(statusEl, "Failed", false);
  console.error(error);
}

function render() {
  if (runtime === null) return;
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
  } catch (error) {
    renderError(error);
  }
}

async function boot() {
  setReadyState(statusEl, "Loading", false);
  const width = setWidth(query.get("width") ?? "18");
  setActiveCase(activeCase);
  runtime = await runtimeFactory.createRuntime({
    irPackageUrl: `${import.meta.env.BASE_URL}${prettyPackageFile}`,
  });
  exportCountEl.textContent = String(runtime.packageInfo.interfaceExports);
  setWidth(width);
  render();
}

for (const button of caseButtons) {
  button.addEventListener("click", () => {
    setActiveCase(button.dataset.case);
    render();
  });
}

widthRange.addEventListener("input", () => {
  widthInput.value = widthRange.value;
  render();
});

widthInput.addEventListener("input", () => {
  setWidth(widthInput.value);
  render();
});

boot().catch(renderError);
