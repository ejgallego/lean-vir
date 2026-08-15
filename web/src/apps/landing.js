/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory, fetchBytes } from "../vir-runtime.js";
import { defaultPackageFile, wasmPublicFile } from "../pages/browser-packages.js";
import { parseDelimitedNumberText } from "../pages/input-parsers.js";

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
  runtimePromise ??= fetchBytes(`${import.meta.env.BASE_URL}${defaultPackageFile}`)
    .then((bytes) => runtimeFactory.createRuntime({ irPackageSetBytes: [bytes] }));
  return runtimePromise;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  result.dataset.failed = "false";
  result.textContent = "Loading Lean VIR…";
  try {
    const values = parseValues(input.value);
    const runtime = await loadRuntime();
    const sorted = runtime.call("SortDemo.sortArray", values);
    result.textContent = `[${sorted.join(", ")}]`;
    status.innerHTML = `<code>SortDemo.sortArray</code> ran in Lean VIR`;
  } catch (error) {
    result.dataset.failed = "true";
    result.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
});

window.addEventListener("beforeunload", async () => {
  (await runtimePromise)?.dispose();
});
