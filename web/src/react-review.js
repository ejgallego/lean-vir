/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import { createBrowserReactRuntimeFactory } from "./browser-react-runtime.js";
import { hostPackageFile, wasmPublicFile } from "./pages/browser-packages.js";
import { errorMessage, setReadyState } from "./pages/page-utils.js";
import { fetchBytes } from "./vir-runtime.js";

const packageFile = hostPackageFile;
const runtimeFactory = createBrowserReactRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmPublicFile}` });

const statusEl = document.querySelector("#react-review-status");
const packageEl = document.querySelector("#react-review-package");
const declsEl = document.querySelector("#react-review-decls");
const exportsEl = document.querySelector("#react-review-exports");
const ptrEl = document.querySelector("#react-review-ptr");
const reloadButton = document.querySelector("#react-review-reload");

const examples = [
  {
    entry: "ReactCounter.mount",
    selector: "#react-counter-root",
    result: document.querySelector("#react-counter-result"),
  },
  {
    entry: "ReactInput.mountInput",
    selector: "#react-input-root",
    result: document.querySelector("#react-input-result"),
  },
  {
    entry: "ReactInput.mountChangeInput",
    selector: "#react-change-root",
    result: document.querySelector("#react-change-result"),
  },
  {
    entry: "ReactInput.mountCheckbox",
    selector: "#react-checkbox-root",
    result: document.querySelector("#react-checkbox-result"),
  },
  {
    entry: "ReactInput.mountAttributes",
    selector: "#react-attributes-root",
    result: document.querySelector("#react-attributes-result"),
  },
  {
    entry: "ReactProofWidget.mount",
    selector: "#react-proof-root",
    result: document.querySelector("#react-proof-result"),
  },
  {
    entry: "ReactTamagotchi.mount",
    selector: "#react-pet-root",
    result: document.querySelector("#react-pet-result"),
  },
];

let runtime = null;

function setExampleResult(example, text, failed = false) {
  example.result.textContent = text;
  example.result.dataset.failed = String(failed);
}

function clearMounts() {
  for (const example of examples) {
    document.querySelector(example.selector)?.replaceChildren();
    setExampleResult(example, "...");
  }
}

function renderRuntimeSummary() {
  packageEl.textContent = packageFile;
  declsEl.textContent = String(runtime.packageInfo.count);
  exportsEl.textContent = String(runtime.packageInfo.interfaceExports);
  ptrEl.textContent = `${runtime.targetPointerBytes()} bytes`;
}

function disposeRuntime() {
  runtime?.dispose();
  runtime = null;
}

async function mountExamples() {
  reloadButton.disabled = true;
  setReadyState(statusEl, "Loading package", false);
  disposeRuntime();
  clearMounts();
  try {
    const irPackageBytes = await fetchBytes(`${import.meta.env.BASE_URL}${packageFile}`);
    runtime = await runtimeFactory.createRuntime({ irPackageBytes });
    renderRuntimeSummary();
    for (const example of examples) {
      const mounted = runtime.call(example.entry, example.selector);
      setExampleResult(example, mounted === true ? "mounted" : "missing", mounted !== true);
    }
    setReadyState(statusEl, "Ready", true);
  } catch (error) {
    setReadyState(statusEl, "Failed", false);
    for (const example of examples) {
      setExampleResult(example, errorMessage(error), true);
    }
    console.error(error);
  } finally {
    reloadButton.disabled = false;
  }
}

reloadButton.addEventListener("click", () => {
  mountExamples();
});

window.addEventListener("beforeunload", () => {
  disposeRuntime();
});

mountExamples();
