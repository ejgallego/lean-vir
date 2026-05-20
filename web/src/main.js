/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import fibSource from "../../examples/Fib.lean?raw";
import mergeSortSource from "../../examples/MergeSort.lean?raw";
import fixtureBasicSource from "../../fixtures/Basic.lean?raw";
import fixtureListOptionSource from "../../fixtures/ListOption.lean?raw";
import fixtureBoundarySource from "../../fixtures/Boundary.lean?raw";
import fixtureManifest from "../../fixtures/manifest.json";

const statusEl = document.querySelector("#status");
const petMoodDisplay = document.querySelector("#pet-mood-display");
const petActionDisplay = document.querySelector("#pet-action-display");
const petTraceDisplay = document.querySelector("#pet-trace-display");
const petActionButtons = document.querySelectorAll("[data-action]");
const petResetButton = document.querySelector("#pet-reset-button");
const wasmTarget = document.querySelector("#wasm-target");
const linkStatus = document.querySelector("#link-status");
const packageName = document.querySelector("#package-name");
const packageSize = document.querySelector("#package-size");
const ptrWidth = document.querySelector("#ptr-width");
const declCount = document.querySelector("#decl-count");
const layoutGuard = document.querySelector("#layout-guard");
const fixtureCount = document.querySelector("#fixture-count");
const fixtureFileCount = document.querySelector("#fixture-file-count");
const fixtureResultType = document.querySelector("#fixture-result-type");
const fixtureList = document.querySelector("#fixture-list");
const fixtureFilterButtons = document.querySelectorAll("[data-fixture-filter]");
const fixtureRunVisibleButton = document.querySelector("#fixture-run-visible");
const fixtureRunStatus = document.querySelector("#fixture-run-status");
const fixtureRunSelectedButton = document.querySelector("#fixture-run-selected");
const fixtureSelectedResult = document.querySelector("#fixture-selected-result");
const fixtureSourceControls = document.querySelector(".fixture-source-controls");
const fixtureInputPanel = document.querySelector("#fixture-input-panel");
const fixtureInputLabel = document.querySelector("#fixture-input-label");
const fixtureInput = document.querySelector("#fixture-input");
const fixtureInputHint = document.querySelector("#fixture-input-hint");
const fixtureSourcePath = document.querySelector("#fixture-source-path");
const fixtureSourceEntry = document.querySelector("#fixture-source-entry");
const fixtureSourceCode = document.querySelector("#fixture-source-code");
const maxFibInput = 17;
const maxSortItems = 16;
const maxSortValue = 9999;
const wasmFile = "vir-upstream.wasm";
const irPackageFile = "vir-demo.irpkg";
const moods = ["happy", "hungry", "sleepy", "angry", "asleep", "dead"];
const actions = ["feed", "play", "nap", "wake", "ignore"];
const sourceFiles = [
  { path: "examples/Fib.lean", source: fibSource },
  { path: "examples/MergeSort.lean", source: mergeSortSource },
  { path: "fixtures/Basic.lean", source: fixtureBasicSource },
  { path: "fixtures/ListOption.lean", source: fixtureListOptionSource },
  { path: "fixtures/Boundary.lean", source: fixtureBoundarySource },
];
const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source.source]));
const demoFixtures = [
  {
    id: "fib",
    source: "examples/Fib.lean",
    entry: "fib",
    group: "demo",
    runner: "fib",
    result: { type: "Nat" },
    input: {
      kind: "nat",
      label: "Input",
      defaultValue: "8",
      max: maxFibInput,
      hint: `Nat, 0..${maxFibInput}`,
    },
  },
  {
    id: "sort-array",
    source: "examples/MergeSort.lean",
    entry: "SortDemo.demoFromArray",
    group: "demo",
    runner: "sort",
    result: { type: "Nat" },
    input: {
      kind: "natArray",
      label: "Array",
      defaultValue: "7, 3, 9, 1, 4, 1, 5, 2",
      hint: `Nat array, up to ${maxSortItems} items`,
    },
  },
];
const manifestFixtures = (fixtureManifest.fixtures ?? []).map((fixture) => ({
  ...fixture,
  group: "manifest",
}));
const fixtures = [...demoFixtures, ...manifestFixtures];
const fixtureResults = new Map();
const fixtureResultFailures = new Map();
const fixtureInputs = new Map(
  demoFixtures
    .filter((fixture) => fixture.input)
    .map((fixture) => [fixture.id, fixture.input.defaultValue ?? ""]),
);
const byteCache = new Map();
let wasmModule = null;
let runtimeExports = null;
let currentFixtureFilter = "all";
let selectedFixtureId = null;
let petMood = 0;
let petTrace = [petMood];

async function fetchBytes(path) {
  if (byteCache.has(path)) {
    return byteCache.get(path);
  }
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  byteCache.set(path, bytes);
  return bytes;
}

async function instantiate(path) {
  const bytes = await fetchBytes(path);
  wasmModule ??= new WebAssembly.Module(bytes);
  const module = wasmModule;
  const imports = {};

  for (const spec of WebAssembly.Module.imports(module)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
          throw new Error(`WASI proc_exit(${args[0]})`);
        }
        return 0;
      };
    }
  }

  const instance = await WebAssembly.instantiate(module, imports);
  instance.exports.__wasm_call_ctors?.();
  return instance.exports;
}

async function loadIrPackage(exports, path) {
  if (typeof exports.vir_alloc_bytes !== "function" || typeof exports.vir_load_ir_package !== "function") {
    throw new Error("IR package loader exports are missing");
  }
  if (!exports.memory) {
    throw new Error("WASM memory export is missing");
  }
  const bytes = await fetchBytes(path);
  const ptr = exports.vir_alloc_bytes(bytes.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, bytes.byteLength).set(bytes);
    const count = exports.vir_load_ir_package(ptr, bytes.byteLength);
    if (count === 0) {
      const detail = lastPackageError(exports);
      throw new Error(`IR package load failed${detail ? `: ${detail}` : ""}`);
    }
    return { count, byteLength: bytes.byteLength };
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

function readWasmString(exports, ptr, len) {
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

function lastPackageError(exports) {
  if (
    typeof exports.vir_last_package_error !== "function" ||
    typeof exports.vir_last_package_error_size !== "function"
  ) {
    return "";
  }
  const len = exports.vir_last_package_error_size();
  return len === 0 ? "" : readWasmString(exports, exports.vir_last_package_error(), len);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function clampInput(value, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function setReady() {
  statusEl.textContent = "Ready";
  statusEl.dataset.ready = "true";
}

function setTrap(error) {
  statusEl.textContent = "Trap";
  statusEl.dataset.ready = "false";
  console.error(error);
}

function renderPet() {
  petMoodDisplay.textContent = moods[petMood] ?? "?";
  petTraceDisplay.textContent = petTrace.map((mood) => moods[mood] ?? "?").join(" -> ");
}

function stepPet(exports, actionName) {
  const action = actions.indexOf(actionName);
  if (action < 0) return;
  petActionDisplay.textContent = actionName;
  try {
    petMood = exports.vir_upstream_tamagotchi_step(petMood, action);
    petTrace.push(petMood);
    renderPet();
    setReady();
  } catch (error) {
    petMoodDisplay.textContent = "error";
    setTrap(error);
  }
}

function resetPet() {
  petMood = 0;
  petTrace = [petMood];
  petActionDisplay.textContent = "...";
  renderPet();
  setReady();
}

function evalConstNat(exports, name) {
  const bytes = new TextEncoder().encode(name);
  const ptr = exports.vir_alloc_bytes(bytes.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, bytes.byteLength).set(bytes);
    if (
      typeof exports.vir_eval_const_nat_string === "function" &&
      typeof exports.vir_eval_const_nat_string_size === "function"
    ) {
      const resultPtr = exports.vir_eval_const_nat_string(ptr, bytes.byteLength);
      const resultLen = exports.vir_eval_const_nat_string_size();
      return readWasmString(exports, resultPtr, resultLen);
    }
    return exports.vir_eval_const_nat(ptr, bytes.byteLength);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

function parseSortInput(text) {
  const parts = text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
  if (parts.length > maxSortItems) {
    throw new Error(`sort input is capped at ${maxSortItems} items`);
  }
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid Nat literal: ${part}`);
    }
    const value = Number(part);
    if (!Number.isSafeInteger(value) || value > maxSortValue) {
      throw new Error(`sort input value is capped at ${maxSortValue}`);
    }
    return value;
  });
}

function sortChecksumFor(exports, values) {
  const ptr = exports.vir_alloc_bytes(values.length * 4);
  try {
    const view = new DataView(exports.memory.buffer, ptr, values.length * 4);
    values.forEach((value, index) => view.setUint32(index * 4, value, true));
    return exports.vir_sort_checksum(ptr, values.length);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

function sourceLabel(path) {
  return path.replace(/^fixtures\//, "").replace(/^examples\//, "").replace(".lean", "");
}

function shortEntryName(entry) {
  return entry.split(".").at(-1) ?? entry;
}

function sourceSnippetForFixture(fixture) {
  const source = sourceByPath.get(fixture.source);
  if (!source) return "";
  if (fixture.group === "demo") return source.trimEnd();
  const lines = source.trimEnd().split(/\r?\n/);
  const name = shortEntryName(fixture.entry);
  const start = lines.findIndex((line) =>
    line.startsWith(`def ${name}`) ||
    line.startsWith(`partial def ${name}`) ||
    line.startsWith(`unsafe def ${name}`)
  );
  if (start === -1) {
    return source.trimEnd();
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^(def|partial def|unsafe def|inductive|structure|namespace|end|#eval)\b/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

function matchesFixtureFilter(fixture, filter) {
  if (filter === "all") return true;
  if (filter === "demos") return fixture.group === "demo";
  return fixture.source === filter;
}

function fixtureInputValue(fixture) {
  return fixtureInputs.get(fixture.id) ?? fixture.input?.defaultValue ?? "";
}

function setFixtureInputAttributes(fixture) {
  const hasInput = Boolean(fixture.input);
  fixtureSourceControls.dataset.hasInput = String(hasInput);
  fixtureInputPanel.hidden = !hasInput;
  if (!hasInput) {
    fixtureInput.value = "";
    fixtureInputHint.textContent = "";
    return;
  }

  fixtureInputLabel.textContent = fixture.input.label;
  fixtureInput.value = fixtureInputValue(fixture);
  fixtureInputHint.textContent = fixture.input.hint ?? "";
  fixtureInput.type = fixture.input.kind === "nat" ? "number" : "text";

  if (fixture.input.kind === "nat") {
    fixtureInput.min = "0";
    fixtureInput.max = String(fixture.input.max ?? maxFibInput);
    fixtureInput.inputMode = "numeric";
  } else {
    fixtureInput.removeAttribute("min");
    fixtureInput.removeAttribute("max");
    fixtureInput.inputMode = "text";
  }
}

function selectFixture(fixture) {
  selectedFixtureId = fixture.id;
  fixtureSourcePath.textContent = fixture.source;
  fixtureSourceEntry.textContent = fixture.entry;
  fixtureSourceCode.textContent = sourceSnippetForFixture(fixture);
  fixtureSelectedResult.textContent = fixtureResults.get(fixture.id) ?? "...";
  fixtureSelectedResult.dataset.failed = String(fixtureResultFailures.get(fixture.id) ?? false);
  setFixtureInputAttributes(fixture);
  for (const item of fixtureList.querySelectorAll(".fixture-item")) {
    item.dataset.selected = String(item.dataset.fixtureId === fixture.id);
  }
}

function fixtureResultTypes() {
  return [...new Set(fixtures.map((fixture) => fixture.result?.type ?? "?"))].join(", ");
}

function renderFixtureSummary() {
  fixtureCount.textContent = String(fixtures.length);
  fixtureFileCount.textContent = String(new Set(fixtures.map((fixture) => fixture.source)).size);
  fixtureResultType.textContent = fixtureResultTypes();
}

function renderFixtureList(sourceFilter = "all") {
  currentFixtureFilter = sourceFilter;
  fixtureList.replaceChildren();
  const visibleFixtures = fixtures.filter((fixture) => matchesFixtureFilter(fixture, sourceFilter));

  for (const fixture of visibleFixtures) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "fixture-item";
    item.dataset.fixtureId = fixture.id;
    item.dataset.selected = String(fixture.id === selectedFixtureId);
    item.addEventListener("click", () => selectFixture(fixture));

    const title = document.createElement("strong");
    title.textContent = fixture.id;

    const meta = document.createElement("small");
    meta.textContent =
      fixture.group === "demo" ? `demo / ${sourceLabel(fixture.source)}` : sourceLabel(fixture.source);

    item.append(title, meta);
    fixtureList.append(item);
  }

  if (visibleFixtures.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No fixtures";
    fixtureList.append(empty);
  }

  for (const button of fixtureFilterButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.fixtureFilter === sourceFilter));
  }

  if (visibleFixtures.length !== 0 && !visibleFixtures.some((fixture) => fixture.id === selectedFixtureId)) {
    selectFixture(visibleFixtures[0]);
  }
  updateFixtureRunControls();
}

function visibleFixtures() {
  return fixtures.filter((fixture) => matchesFixtureFilter(fixture, currentFixtureFilter));
}

function updateFixtureRunControls() {
  const enabled = runtimeExports !== null;
  fixtureRunVisibleButton.disabled = !enabled;
  fixtureRunSelectedButton.disabled = !enabled || selectedFixtureId === null;
}

function setFixtureResult(fixture, value, failed = false) {
  fixtureResults.set(fixture.id, value);
  fixtureResultFailures.set(fixture.id, failed);
  if (fixture.id === selectedFixtureId) {
    fixtureSelectedResult.textContent = value;
    fixtureSelectedResult.dataset.failed = String(failed);
  }
}

function parseNatInput(text, max) {
  if (!/^\d+$/.test(text.trim())) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  return clampInput(value, max);
}

function runInputFixture(exports, fixture) {
  if (fixture.runner === "fib") {
    const n = parseNatInput(fixtureInputValue(fixture), fixture.input.max ?? maxFibInput);
    fixtureInputs.set(fixture.id, String(n));
    if (fixture.id === selectedFixtureId) {
      fixtureInput.value = String(n);
    }
    return String(exports.vir_upstream_fib(n));
  }

  if (fixture.runner === "sort") {
    const values = parseSortInput(fixtureInputValue(fixture));
    const normalized = values.join(", ");
    fixtureInputs.set(fixture.id, normalized);
    if (fixture.id === selectedFixtureId) {
      fixtureInput.value = normalized;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return `checksum ${sortChecksumFor(exports, values)} / [${sorted.join(", ")}]`;
  }

  return null;
}

function evaluateFixture(exports, fixture) {
  if (fixture.runner) {
    return runInputFixture(exports, fixture);
  }
  return String(evalConstNat(exports, fixture.entry));
}

async function runFixture(fixture) {
  if (runtimeExports === null) return null;
  fixtureRunStatus.textContent = `Running ${fixture.id}`;
  setFixtureResult(fixture, "running");
  try {
    const exports = await instantiate(`${import.meta.env.BASE_URL}${wasmFile}`);
    await loadIrPackage(exports, `${import.meta.env.BASE_URL}${irPackageFile}`);
    const result = evaluateFixture(exports, fixture);
    setFixtureResult(fixture, result);
    fixtureRunStatus.textContent = `${fixture.id}: ${result}`;
    setReady();
    return result;
  } catch (error) {
    setFixtureResult(fixture, "error", true);
    fixtureRunStatus.textContent = `${fixture.id}: error`;
    setTrap(error);
    return null;
  }
}

async function runVisibleFixtures() {
  if (runtimeExports === null) return;
  const selected = visibleFixtures();
  let passed = 0;
  let failed = 0;
  fixtureRunVisibleButton.disabled = true;
  for (const fixture of selected) {
    const result = await runFixture(fixture);
    if (result === null) {
      failed++;
    } else {
      passed++;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  fixtureRunStatus.textContent = `${passed} passed${failed === 0 ? "" : `, ${failed} failed`}`;
  fixtureRunVisibleButton.disabled = false;
}

for (const button of fixtureFilterButtons) {
  button.addEventListener("click", () => renderFixtureList(button.dataset.fixtureFilter));
}

fixtureInput.addEventListener("input", () => {
  if (selectedFixtureId !== null) {
    fixtureInputs.set(selectedFixtureId, fixtureInput.value);
  }
});
fixtureRunVisibleButton.addEventListener("click", () => runVisibleFixtures());
fixtureRunSelectedButton.addEventListener("click", () => {
  const fixture = fixtures.find((candidate) => candidate.id === selectedFixtureId);
  if (fixture) {
    runFixture(fixture);
  }
});

renderFixtureSummary();
renderFixtureList();
selectFixture(fixtures[0]);

try {
  runtimeExports = await instantiate(`${import.meta.env.BASE_URL}${wasmFile}`);
  const packageInfo = await loadIrPackage(runtimeExports, `${import.meta.env.BASE_URL}${irPackageFile}`);
  const pointerBytes = runtimeExports.vir_upstream_target_pointer_bytes();

  wasmTarget.textContent = "wasm32-wasip1";
  linkStatus.textContent = "strict";
  packageName.textContent = irPackageFile;
  packageSize.textContent = formatBytes(packageInfo.byteLength);
  ptrWidth.textContent = `${pointerBytes} bytes`;
  declCount.textContent = String(packageInfo.count);
  layoutGuard.textContent = pointerBytes === 4 ? "pass" : "fail";
  fixtureRunStatus.textContent = "Ready";
  updateFixtureRunControls();
  setReady();

  for (const button of petActionButtons) {
    button.addEventListener("click", () => stepPet(runtimeExports, button.dataset.action));
  }
  petResetButton.addEventListener("click", resetPet);
  resetPet();
} catch (error) {
  runtimeExports = null;
  statusEl.textContent = "Failed";
  statusEl.dataset.ready = "false";
  fixtureRunStatus.textContent = "Unavailable";
  updateFixtureRunControls();
  petMoodDisplay.textContent = "error";
  console.error(error);
}
