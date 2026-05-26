/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import { createVirRuntimeFactory, fetchBytes } from "./vir-runtime.js";
import fibSource from "../../examples/Fib.lean?raw";
import hostInteropSource from "../../examples/HostInterop.lean?raw";
import mergeSortSource from "../../examples/MergeSort.lean?raw";
import fixtureBasicSource from "../../fixtures/Basic.lean?raw";
import fixtureExprPrinterSource from "../../fixtures/ExprPrinter.lean?raw";
import fixtureInterfaceShapesSource from "../../fixtures/InterfaceShapes.lean?raw";
import fixtureListOptionSource from "../../fixtures/ListOption.lean?raw";
import fixtureBoundarySource from "../../fixtures/Boundary.lean?raw";
import fixtureLeanParserSource from "../../fixtures/LeanParser.lean?raw";
import fixtureLeanParserHeaderSource from "../../fixtures/LeanParserHeader.lean?raw";
import fixtureTaskSource from "../../fixtures/Task.lean?raw";
import fixtureManifest from "../../fixtures/manifest.json";
import browserPackages from "../../fixtures/browser-packages.json";

const statusEl = document.querySelector("#status");
const petMoodDisplay = document.querySelector("#pet-mood-display");
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
const runtimeFactory = createVirRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmFile}` });
const packageSpecs = browserPackages.packages ?? [];
const packageById = new Map(packageSpecs.map((spec) => [spec.id, spec]));
const defaultPackageFile = packageById.get(browserPackages.defaultPackage)?.file ?? "fixtures-basic.irpkg";
const hostPackageFile = packageById.get(browserPackages.hostPackage)?.file ?? "demo-host.irpkg";
const packageFileByFixtureSource = new Map();
for (const spec of packageSpecs) {
  for (const source of spec.fixtureSources ?? []) {
    packageFileByFixtureSource.set(source, spec.file);
  }
}
const sourceFiles = [
  { path: "examples/Fib.lean", source: fibSource },
  { path: "examples/HostInterop.lean", source: hostInteropSource },
  { path: "examples/MergeSort.lean", source: mergeSortSource },
  { path: "fixtures/Basic.lean", source: fixtureBasicSource },
  { path: "fixtures/ExprPrinter.lean", source: fixtureExprPrinterSource },
  { path: "fixtures/InterfaceShapes.lean", source: fixtureInterfaceShapesSource },
  { path: "fixtures/ListOption.lean", source: fixtureListOptionSource },
  { path: "fixtures/Boundary.lean", source: fixtureBoundarySource },
  { path: "fixtures/LeanParser.lean", source: fixtureLeanParserSource },
  { path: "fixtures/LeanParserHeader.lean", source: fixtureLeanParserHeaderSource },
  { path: "fixtures/Task.lean", source: fixtureTaskSource },
];
const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source.source]));
const demoFixtures = [
  {
    id: "fib",
    source: "examples/Fib.lean",
    entry: "fib",
    packageFile: defaultPackageFile,
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
    packageFile: defaultPackageFile,
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
  {
    id: "host-title",
    source: "examples/HostInterop.lean",
    entry: "HostInterop.titleHandshake",
    packageFile: hostPackageFile,
    group: "demo",
    runner: "hostTitle",
    result: { type: "String" },
    input: {
      kind: "string",
      label: "Title",
      defaultValue: "browser handshake",
      hint: "String passed from Lean to the browser document title",
    },
  },
  {
    id: "string-roundtrip",
    source: "fixtures/Basic.lean",
    entry: "Vir.Fixtures.Basic.stringUtf8RoundtripScore",
    packageFile: defaultPackageFile,
    group: "demo",
    runner: "singleString",
    result: { type: "Nat" },
    input: {
      kind: "string",
      label: "String",
      defaultValue: "Aé∀Z",
      hint: "String -> Nat score through Lean UTF-8 operations",
    },
  },
  {
    id: "bytearray-score",
    source: "fixtures/Basic.lean",
    entry: "Vir.Fixtures.Basic.byteArrayInputScore",
    packageFile: defaultPackageFile,
    group: "demo",
    runner: "byteArray",
    result: { type: "Nat" },
    input: {
      kind: "byteArray",
      label: "Bytes",
      defaultValue: "65, 66, 67",
      hint: "ByteArray values, each in 0..255",
    },
  },
];
const manifestFixtures = (fixtureManifest.fixtures ?? []).map((fixture) => ({
  ...fixture,
  packageFile: packageFileByFixtureSource.get(fixture.source) ?? defaultPackageFile,
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
const packageBytesPromises = new Map();
const runtimePromises = new Map();
let hostRuntime = null;
let currentFixtureFilter = "all";
let selectedFixtureId = null;

function packageBytes(packageFile) {
  if (!packageBytesPromises.has(packageFile)) {
    packageBytesPromises.set(packageFile, fetchBytes(`${import.meta.env.BASE_URL}${packageFile}`));
  }
  return packageBytesPromises.get(packageFile);
}

function runtimeForPackage(packageFile) {
  if (!runtimePromises.has(packageFile)) {
    runtimePromises.set(
      packageFile,
      packageBytes(packageFile).then((irPackageBytes) => runtimeFactory.createRuntime({ irPackageBytes })),
    );
  }
  return runtimePromises.get(packageFile);
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

function mountPet(runtime) {
  try {
    runtime.call("Tamagotchi.uiMountFromDom");
    setReady();
  } catch (error) {
    petMoodDisplay.textContent = "error";
    setTrap(error);
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

function parseByteArrayInput(text) {
  return text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean).map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid byte literal: ${part}`);
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`ByteArray values must be in 0..255`);
    }
    return value;
  });
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
  } else if (fixture.input.kind === "string") {
    fixtureInput.removeAttribute("min");
    fixtureInput.removeAttribute("max");
    fixtureInput.inputMode = "text";
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
    const packageLabel = fixture.packageFile ?? defaultPackageFile;
    meta.textContent =
      fixture.group === "demo"
        ? `demo / ${sourceLabel(fixture.source)} / ${packageLabel}`
        : `${sourceLabel(fixture.source)} / ${packageLabel}`;

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
  const enabled = hostRuntime !== null;
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

function runInputFixture(runtime, fixture) {
  if (fixture.runner === "fib") {
    const n = parseNatInput(fixtureInputValue(fixture), fixture.input.max ?? maxFibInput);
    fixtureInputs.set(fixture.id, String(n));
    if (fixture.id === selectedFixtureId) {
      fixtureInput.value = String(n);
    }
    return runtime.call(fixture.entry, n);
  }

  if (fixture.runner === "sort") {
    const values = parseSortInput(fixtureInputValue(fixture));
    const normalized = values.join(", ");
    fixtureInputs.set(fixture.id, normalized);
    if (fixture.id === selectedFixtureId) {
      fixtureInput.value = normalized;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return `checksum ${runtime.call(fixture.entry, values)} / [${sorted.join(", ")}]`;
  }

  if (fixture.runner === "hostTitle") {
    return runtime.call(fixture.entry, fixtureInputValue(fixture));
  }

  if (fixture.runner === "singleString") {
    return runtime.call(fixture.entry, fixtureInputValue(fixture));
  }

  if (fixture.runner === "byteArray") {
    const bytes = parseByteArrayInput(fixtureInputValue(fixture));
    const normalized = bytes.join(", ");
    fixtureInputs.set(fixture.id, normalized);
    if (fixture.id === selectedFixtureId) {
      fixtureInput.value = normalized;
    }
    return runtime.call(fixture.entry, bytes);
  }

  return null;
}

function evaluateFixture(runtime, fixture) {
  if (fixture.runner) {
    return runInputFixture(runtime, fixture);
  }
  return runtime.call(fixture.entry);
}

async function runFixture(fixture) {
  if (hostRuntime === null) return null;
  fixtureRunStatus.textContent = `Running ${fixture.id}`;
  setFixtureResult(fixture, "running");
  try {
    const fixtureRuntime = await runtimeForPackage(fixture.packageFile ?? defaultPackageFile);
    const result = evaluateFixture(fixtureRuntime, fixture);
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
  if (hostRuntime === null) return;
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
  const packageFiles = packageSpecs.map((spec) => spec.file);
  const runtimes = await Promise.all(packageFiles.map((file) => runtimeForPackage(file)));
  hostRuntime = await runtimeForPackage(hostPackageFile);
  const primaryRuntime = await runtimeForPackage(defaultPackageFile);
  const totalPackageBytes = runtimes.reduce((sum, candidate) => sum + candidate.packageInfo.byteLength, 0);
  const totalDeclCount = runtimes.reduce((sum, candidate) => sum + candidate.packageInfo.count, 0);
  const pointerBytes = primaryRuntime.targetPointerBytes();

  wasmTarget.textContent = "wasm32-wasip1";
  linkStatus.textContent = "strict";
  packageName.textContent = packageFiles.join(", ");
  packageSize.textContent = formatBytes(totalPackageBytes);
  ptrWidth.textContent = `${pointerBytes} bytes`;
  declCount.textContent = String(totalDeclCount);
  layoutGuard.textContent = pointerBytes === 4 ? "pass" : "fail";
  fixtureRunStatus.textContent = "Ready";
  updateFixtureRunControls();
  setReady();

  mountPet(hostRuntime);
} catch (error) {
  hostRuntime = null;
  statusEl.textContent = "Failed";
  statusEl.dataset.ready = "false";
  fixtureRunStatus.textContent = "Unavailable";
  updateFixtureRunControls();
  petMoodDisplay.textContent = "error";
  console.error(error);
}
