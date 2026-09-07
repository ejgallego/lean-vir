/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import "./style.css";
import { createBrowserReactRuntimeFactory } from "./browser-react-runtime.js";
import { hostPackageFile, wasmPublicFile } from "./pages/browser-packages.js";
import { errorMessage, setReadyState } from "./pages/page-utils.js";
import { fetchBytes } from "../src/vir-runtime.js";

const packageFile = hostPackageFile;
const runtimeFactory = createBrowserReactRuntimeFactory({ wasmUrl: `${import.meta.env.BASE_URL}${wasmPublicFile}` });

const statusEl = document.querySelector("#react-status");
const packageEl = document.querySelector("#react-package");
const declsEl = document.querySelector("#react-decls");
const exportsEl = document.querySelector("#react-exports");
const ptrEl = document.querySelector("#react-ptr");
const reloadButton = document.querySelector("#react-reload");
const tamagotchiEntry = "ReactTamagotchi.mount";
const tamagotchiSelector = "#react-pet-root";
const resultEl = document.querySelector("#react-pet-result");

let runtime = null;

function setTamagotchiResult(text, failed = false) {
  resultEl.textContent = text;
  resultEl.dataset.failed = String(failed);
}

function clearMount() {
  document.querySelector(tamagotchiSelector)?.replaceChildren();
  setTamagotchiResult("...");
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

async function mountTamagotchi() {
  reloadButton.disabled = true;
  setReadyState(statusEl, "Loading package", false);
  disposeRuntime();
  clearMount();
  try {
    const packageMemberBytes = await fetchBytes(`${import.meta.env.BASE_URL}${packageFile}`);
    runtime = await runtimeFactory.createRuntime({ irPackageSet: [packageMemberBytes] });
    renderRuntimeSummary();
    const mounted = runtime.call(tamagotchiEntry, tamagotchiSelector);
    setTamagotchiResult(
      mounted === true ? "mounted" : "missing",
      mounted !== true,
    );
    setReadyState(statusEl, "Ready", true);
  } catch (error) {
    setReadyState(statusEl, "Failed", false);
    setTamagotchiResult(errorMessage(error), true);
    console.error(error);
  } finally {
    reloadButton.disabled = false;
  }
}

reloadButton.addEventListener("click", () => {
  mountTamagotchi();
});

window.addEventListener("beforeunload", () => {
  disposeRuntime();
});

mountTamagotchi();
