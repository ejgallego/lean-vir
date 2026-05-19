/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";

const statusEl = document.querySelector("#status");
const fibInput = document.querySelector("#fib-input");
const fibRunButton = document.querySelector("#fib-run-button");
const fibInputDisplay = document.querySelector("#fib-input-display");
const fibResultDisplay = document.querySelector("#fib-result-display");
const petMoodDisplay = document.querySelector("#pet-mood-display");
const petActionDisplay = document.querySelector("#pet-action-display");
const petTraceDisplay = document.querySelector("#pet-trace-display");
const petActionButtons = document.querySelectorAll("[data-action]");
const petResetButton = document.querySelector("#pet-reset-button");
const sortInput = document.querySelector("#sort-input");
const sortRunButton = document.querySelector("#sort-run-button");
const sortOutputDisplay = document.querySelector("#sort-output-display");
const sortResultDisplay = document.querySelector("#sort-result-display");
const wasmTarget = document.querySelector("#wasm-target");
const linkStatus = document.querySelector("#link-status");
const packageName = document.querySelector("#package-name");
const packageSize = document.querySelector("#package-size");
const ptrWidth = document.querySelector("#ptr-width");
const declCount = document.querySelector("#decl-count");
const layoutGuard = document.querySelector("#layout-guard");
const maxFibInput = 17;
const maxSortItems = 16;
const maxSortValue = 9999;
const wasmFile = "vir-upstream.wasm";
const irPackageFile = "vir-demo.irpkg";
const moods = ["happy", "hungry", "sleepy", "angry", "asleep", "dead"];
const actions = ["feed", "play", "nap", "wake", "ignore"];
let petMood = 0;
let petTrace = [petMood];

async function instantiate(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
  }
  const bytes = await response.arrayBuffer();
  const module = new WebAssembly.Module(bytes);
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
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
  }
  if (typeof exports.vir_alloc_bytes !== "function" || typeof exports.vir_load_ir_package !== "function") {
    throw new Error("IR package loader exports are missing");
  }
  if (!exports.memory) {
    throw new Error("WASM memory export is missing");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
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

function renderFib(exports) {
  const n = clampInput(Number(fibInput.value), maxFibInput);
  fibInput.value = String(n);
  fibInputDisplay.textContent = String(n);
  try {
    fibResultDisplay.textContent = String(exports.vir_upstream_fib(n));
    setReady();
  } catch (error) {
    fibResultDisplay.textContent = "error";
    setTrap(error);
  }
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
    return exports.vir_eval_const_nat(ptr, bytes.byteLength);
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

function renderSort(exports) {
  try {
    const values = parseSortInput(sortInput.value);
    sortInput.value = values.join(", ");
    sortOutputDisplay.textContent = `[${[...values].sort((a, b) => a - b).join(", ")}]`;
    sortResultDisplay.textContent = String(sortChecksumFor(exports, values));
    setReady();
  } catch (error) {
    sortOutputDisplay.textContent = "error";
    sortResultDisplay.textContent = "error";
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

try {
  const exports = await instantiate(`${import.meta.env.BASE_URL}${wasmFile}`);
  const packageInfo = await loadIrPackage(exports, `${import.meta.env.BASE_URL}${irPackageFile}`);
  const pointerBytes = exports.vir_upstream_target_pointer_bytes();

  wasmTarget.textContent = "wasm32-wasip1";
  linkStatus.textContent = "strict";
  packageName.textContent = irPackageFile;
  packageSize.textContent = formatBytes(packageInfo.byteLength);
  ptrWidth.textContent = `${pointerBytes} bytes`;
  declCount.textContent = String(packageInfo.count);
  layoutGuard.textContent = pointerBytes === 4 ? "pass" : "fail";
  setReady();

  fibRunButton.addEventListener("click", () => renderFib(exports));
  fibInput.addEventListener("change", () => renderFib(exports));
  for (const button of petActionButtons) {
    button.addEventListener("click", () => stepPet(exports, button.dataset.action));
  }
  petResetButton.addEventListener("click", resetPet);
  sortRunButton.addEventListener("click", () => renderSort(exports));
  sortInput.addEventListener("change", () => renderSort(exports));
  renderFib(exports);
  resetPet();
  renderSort(exports);
} catch (error) {
  statusEl.textContent = "Failed";
  statusEl.dataset.ready = "false";
  fibResultDisplay.textContent = "error";
  petMoodDisplay.textContent = "error";
  sortOutputDisplay.textContent = "error";
  sortResultDisplay.textContent = "error";
  console.error(error);
}
