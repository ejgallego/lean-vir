/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import {
  defaultPackageFile,
  hostPackageFile,
  packageFiles,
  wasmPublicFile,
} from "./pages/browser-packages.js";
import {
  createFixtureInputDefaults,
  fixtures,
  matchesFixtureFilter,
  maxFibInput,
  maxSortItems,
  maxSortValue,
  sourceLabel,
} from "./pages/fixture-catalog.js";
import { sourceSnippetForFixture } from "./pages/fixture-sources.js";
import { parseByteArrayInput, parseClampedNatInput, parseDelimitedNumberText } from "./pages/input-parsers.js";
import { formatBytes, setReadyState } from "./pages/page-utils.js";
import { createVirRuntimeFactory, fetchBytes } from "../src/vir-runtime.js";

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
const fixtureReloadRuntimeButton = document.querySelector("#fixture-reload-runtime");
const fixtureSelectedResult = document.querySelector("#fixture-selected-result");
const fixtureSourceControls = document.querySelector(".fixture-source-controls");
const petActionButtons = document.querySelectorAll(".action-grid button");
const petReinitializeButton = document.querySelector("#pet-reinitialize-runtime");
const fixtureInputPanel = document.querySelector("#fixture-input-panel");
const fixtureInputLabel = document.querySelector("#fixture-input-label");
const fixtureInput = document.querySelector("#fixture-input");
const fixtureInputHint = document.querySelector("#fixture-input-hint");
const fixtureSourcePath = document.querySelector("#fixture-source-path");
const fixtureSourceEntry = document.querySelector("#fixture-source-entry");
const fixtureSourceCode = document.querySelector("#fixture-source-code");
const runtimeFactory = createVirRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmPublicFile}` });
const fixtureResults = new Map();
const fixtureResultFailures = new Map();
const fixtureInputs = createFixtureInputDefaults();
const packageBytesPromises = new Map();
const runtimePromises = new Map();
const failedRuntimePackages = new Set();
const retiredRuntimes = new WeakSet();
let hostRuntime = null;
let pageReady = false;
let recoveryPackageFile = null;
let recoveryLoading = false;
let fixtureBatchRunning = false;
let fatalGeneration = 0;
let petMountPending = false;
let currentFixtureFilter = "all";
let selectedFixtureId = null;

function packageBytes(packageFile) {
  if (!packageBytesPromises.has(packageFile)) {
    packageBytesPromises.set(packageFile, fetchBytes(`${import.meta.env.BASE_URL}${packageFile}`));
  }
  return packageBytesPromises.get(packageFile);
}

function startRuntimeForPackage(packageFile) {
  const pending = packageBytes(packageFile)
    .then((bytes) => runtimeFactory.createRuntime({ irPackageSet: [bytes] }))
    .catch((error) => {
      if (runtimePromises.get(packageFile) === pending) {
        runtimePromises.delete(packageFile);
      }
      throw error;
    });
  runtimePromises.set(packageFile, pending);
  return pending;
}

function runtimeForPackage(packageFile) {
  if (failedRuntimePackages.has(packageFile)) {
    return Promise.reject(
      new Error(`Runtime for ${packageFile} failed; reload it before running again`),
    );
  }
  return runtimePromises.get(packageFile) ?? startRuntimeForPackage(packageFile);
}

function disposeRuntime(runtime) {
  try {
    runtime.dispose();
  } catch (error) {
    console.error("failed to dispose retired runtime", error);
  }
}

function retireRuntime(packageFile, runtime) {
  if (runtime?.failure == null) return false;
  if (retiredRuntimes.has(runtime)) return true;
  retiredRuntimes.add(runtime);
  fatalGeneration += 1;
  failedRuntimePackages.delete(packageFile);
  failedRuntimePackages.add(packageFile);
  recoveryPackageFile = packageFile;
  runtimePromises.delete(packageFile);
  disposeRuntime(runtime);
  updateFixtureRunControls();
  updatePetControls();
  return true;
}

function setReady() {
  if (failedRuntimePackages.size === 0) {
    setReadyState(statusEl, "Ready", true);
  }
  updatePetControls();
}

function updatePetControls() {
  const ready =
    pageReady &&
    !recoveryLoading &&
    !petMountPending &&
    hostRuntime !== null &&
    hostRuntime.failure === null;
  for (const button of petActionButtons) button.disabled = !ready;
  petReinitializeButton.hidden = !petMountPending;
  petReinitializeButton.disabled =
    !pageReady ||
    recoveryLoading ||
    hostRuntime === null ||
    hostRuntime.failure !== null;
}

function setRunError(error, fatal = false) {
  setReadyState(statusEl, fatal ? "Trap" : "Failed", false);
  console.error(error);
}

function mountPet(runtime) {
  try {
    runtime.call("Tamagotchi.uiMountFromDom");
    setReady();
  } catch (error) {
    petMoodDisplay.textContent = "error";
    const fatal = retireRuntime(hostPackageFile, runtime);
    petMountPending = true;
    setRunError(error, fatal);
    updatePetControls();
  }
}

function parseSortInput(text) {
  const parts = parseDelimitedNumberText(text);
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
  const selected = fixtures.find((fixture) => fixture.id === selectedFixtureId);
  const blockedVisible = visibleFixtures().some((fixture) =>
    failedRuntimePackages.has(fixture.packageFile ?? defaultPackageFile),
  );
  fixtureRunVisibleButton.disabled =
    !pageReady || recoveryLoading || fixtureBatchRunning || blockedVisible;
  fixtureRunSelectedButton.disabled =
    !pageReady ||
    recoveryLoading ||
    fixtureBatchRunning ||
    selected === undefined ||
    failedRuntimePackages.has(selected.packageFile ?? defaultPackageFile);
  fixtureReloadRuntimeButton.hidden = recoveryPackageFile === null;
  fixtureReloadRuntimeButton.disabled =
    !pageReady || recoveryLoading || fixtureBatchRunning || recoveryPackageFile === null;
  fixtureReloadRuntimeButton.textContent = recoveryPackageFile === null
    ? "Reload failed runtime"
    : `Reload ${recoveryPackageFile}`;
}

function setFixtureResult(fixture, value, failed = false) {
  fixtureResults.set(fixture.id, value);
  fixtureResultFailures.set(fixture.id, failed);
  if (fixture.id === selectedFixtureId) {
    fixtureSelectedResult.textContent = value;
    fixtureSelectedResult.dataset.failed = String(failed);
  }
}

function runInputFixture(runtime, fixture) {
  if (fixture.runner === "fib") {
    const n = parseClampedNatInput(fixtureInputValue(fixture), fixture.input.max ?? maxFibInput);
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

async function runFixture(fixture, fromBatch = false) {
  if (!pageReady || recoveryLoading || (fixtureBatchRunning && !fromBatch)) return null;
  const packageFile = fixture.packageFile ?? defaultPackageFile;
  if (failedRuntimePackages.has(packageFile)) return null;
  fixtureRunStatus.textContent = `Running ${fixture.id}`;
  setFixtureResult(fixture, "running");
  let fixtureRuntime = null;
  try {
    fixtureRuntime = await runtimeForPackage(packageFile);
    if (fixtureRuntime.failure !== null) throw fixtureRuntime.failure;
    const result = evaluateFixture(fixtureRuntime, fixture);
    setFixtureResult(fixture, result);
    fixtureRunStatus.textContent = `${fixture.id}: ${result}`;
    setReady();
    return result;
  } catch (error) {
    setFixtureResult(fixture, "error", true);
    fixtureRunStatus.textContent = `${fixture.id}: error`;
    const fatal = retireRuntime(packageFile, fixtureRuntime);
    setRunError(error, fatal);
    updateFixtureRunControls();
    return null;
  }
}

async function runVisibleFixtures() {
  if (!pageReady || recoveryLoading || fixtureBatchRunning) return;
  const selected = visibleFixtures();
  let passed = 0;
  let failed = 0;
  const startingFatalGeneration = fatalGeneration;
  fixtureBatchRunning = true;
  updateFixtureRunControls();
  for (const fixture of selected) {
    const result = await runFixture(fixture, true);
    if (result === null) {
      failed++;
    } else {
      passed++;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (fatalGeneration !== startingFatalGeneration) break;
  }
  fixtureRunStatus.textContent = `${passed} passed${failed === 0 ? "" : `, ${failed} failed`}`;
  fixtureBatchRunning = false;
  updateFixtureRunControls();
}

async function reloadFailedRuntime() {
  const packageFile = recoveryPackageFile;
  if (
    packageFile === null ||
    !failedRuntimePackages.has(packageFile) ||
    recoveryLoading
  ) return;
  recoveryLoading = true;
  updateFixtureRunControls();
  updatePetControls();
  fixtureRunStatus.textContent = `Loading fresh ${packageFile}`;
  try {
    runtimePromises.delete(packageFile);
    const freshRuntime = await startRuntimeForPackage(packageFile);
    failedRuntimePackages.delete(packageFile);
    recoveryPackageFile = [...failedRuntimePackages].at(-1) ?? null;
    if (packageFile === hostPackageFile) {
      hostRuntime = freshRuntime;
      petMountPending = true;
    }
    if (!failedRuntimePackages.has(packageFile)) {
      fixtureRunStatus.textContent =
        `Fresh ${packageFile} runtime ready. Run an entry explicitly to continue.`;
      if (recoveryPackageFile === null) setReady();
    }
  } catch (error) {
    fixtureRunStatus.textContent = `${packageFile}: reload failed`;
    setRunError(error);
  } finally {
    recoveryLoading = false;
    updateFixtureRunControls();
    updatePetControls();
  }
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
fixtureReloadRuntimeButton.addEventListener("click", () => {
  void reloadFailedRuntime();
});
petReinitializeButton.addEventListener("click", () => {
  if (hostRuntime === null || hostRuntime.failure !== null || recoveryLoading) return;
  petMountPending = false;
  mountPet(hostRuntime);
  updatePetControls();
});
fixtureRunSelectedButton.addEventListener("click", () => {
  const fixture = fixtures.find((candidate) => candidate.id === selectedFixtureId);
  if (fixture) {
    runFixture(fixture);
  }
});
function observeHostRuntimeFailure() {
  if (hostRuntime?.failure != null) {
    const error = hostRuntime.failure;
    retireRuntime(hostPackageFile, hostRuntime);
    setRunError(error, true);
    fixtureRunStatus.textContent = `${hostPackageFile}: runtime trapped`;
  }
}

window.addEventListener("error", observeHostRuntimeFailure);
window.addEventListener("unhandledrejection", observeHostRuntimeFailure);
renderFixtureSummary();
renderFixtureList();
selectFixture(fixtures[0]);

try {
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
  pageReady = true;
  updateFixtureRunControls();
  updatePetControls();
  setReady();

  mountPet(hostRuntime);
} catch (error) {
  hostRuntime = null;
  pageReady = false;
  setReadyState(statusEl, "Failed", false);
  fixtureRunStatus.textContent = "Unavailable";
  updateFixtureRunControls();
  petMoodDisplay.textContent = "error";
  console.error(error);
}
