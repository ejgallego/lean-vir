/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory, fetchBytes } from "../src/vir-runtime.js";
import { defaultPackageFile, wasmPublicFile } from "./pages/browser-packages.js";
import { parseDelimitedNumberText } from "./pages/input-parsers.js";

const maxItems = 16;
const maxValue = 9999;
const form = document.querySelector("#sort-demo");
const input = document.querySelector("#sort-input");
const button = document.querySelector("#sort-run");
const result = document.querySelector("#sort-result");
const status = document.querySelector("#sort-status");
const runtimeFactory = createVirRuntimeFactory({
  wasmUrl: `${import.meta.env.BASE_URL}${wasmPublicFile}`,
});
let runtimePromise = null;
let pageUnloading = false;
let sortRequestId = 0;

function parseValues(text) {
  const parts = parseDelimitedNumberText(text);
  if (parts.length === 0) throw new Error("enter at least one natural number");
  if (parts.length > maxItems) throw new Error(`use at most ${maxItems} numbers`);
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`not a natural number: ${part}`);
    const value = Number(part);
    if (!Number.isSafeInteger(value) || value > maxValue) {
      throw new Error(`values must be at most ${maxValue}`);
    }
    return value;
  });
}

function loadRuntime() {
  if (pageUnloading) {
    return Promise.reject(new Error("the page is unloading"));
  }
  if (runtimePromise === null) {
    const pending = fetchBytes(`${import.meta.env.BASE_URL}${defaultPackageFile}`)
      .then((bytes) => {
        if (pageUnloading) throw new Error("the page is unloading");
        return runtimeFactory.createRuntime({ irPackageSet: [bytes] });
      });
    runtimePromise = pending;
    pending.catch(() => {
      if (runtimePromise === pending) runtimePromise = null;
    });
  }
  return runtimePromise;
}

function disposeRuntime(runtime) {
  try {
    runtime.dispose();
  } catch (error) {
    console.error("failed to dispose landing-page runtime", error);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const requestId = ++sortRequestId;
  button.disabled = true;
  result.dataset.failed = "false";
  result.textContent = "Loading Lean VIR…";
  let runtime = null;
  let pendingRuntime = null;
  try {
    const values = parseValues(input.value);
    pendingRuntime = loadRuntime();
    runtime = await pendingRuntime;
    if (pageUnloading || requestId !== sortRequestId || runtimePromise !== pendingRuntime) {
      return;
    }
    const sorted = runtime.call("SortDemo.sortArray", values);
    result.textContent = `[${sorted.join(", ")}]`;
    status.innerHTML = `<code>SortDemo.sortArray</code> ran in Lean VIR`;
  } catch (error) {
    if (runtime !== null && runtime.failure !== null) {
      if (runtimePromise === pendingRuntime) runtimePromise = null;
      disposeRuntime(runtime);
    }
    if (pageUnloading || requestId !== sortRequestId) return;
    result.dataset.failed = "true";
    result.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestId === sortRequestId) button.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  pageUnloading = true;
  sortRequestId += 1;
  const pending = runtimePromise;
  runtimePromise = null;
  void pending?.then(disposeRuntime, () => {});
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  pageUnloading = false;
  if (button.disabled) {
    button.disabled = false;
    if (result.textContent === "Loading Lean VIR…") {
      result.dataset.failed = "true";
      result.textContent = "Sort paused while leaving the page; press Sort to try again.";
    }
  }
});
