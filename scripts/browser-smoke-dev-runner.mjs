/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  basePath,
  distRoot,
  evaluate,
  navigate,
  waitForReady,
  waitForStatus,
} from "./browser-smoke-harness.mjs";
import { interfaceInputTag } from "../web/src/pages/interface-inputs.js";
import { encodeInvalidMagicPackage, readIrPackageInfo, replaceIrPackageManifest } from "./irpkg-format.mjs";

const packageInfoCache = new Map();

export async function smokeRunner(cdp, origin, url, expected) {
  await navigate(cdp, `${origin}${basePath}${url}`);
  await waitForReady(cdp);
  const before = await evaluate(cdp, `({
    location: window.location.href,
    packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    exports: document.querySelector("#dev-export-count")?.textContent?.trim(),
    sourceTargets: document.querySelector("#dev-source-targets")?.textContent?.trim(),
    toolchain: document.querySelector("#dev-toolchain")?.textContent?.trim(),
    generatedAt: document.querySelector("#dev-generated-at")?.textContent?.trim(),
    entry: document.querySelector("#dev-entry-select")?.value,
    entryCount: document.querySelector("#dev-entry-select")?.options.length,
    input: document.querySelector("[data-input-index='0']")?.value,
    inputs: Array.from(document.querySelectorAll("[data-input-index]")).map((field) => ({
      value: field.value,
      checked: field.checked,
      type: field.type,
      tagName: field.tagName
    }))
  })`);
  assert.ok(before.location.endsWith(url), `unexpected runner URL: ${before.location}`);
  assert.equal(before.packageName, expected.packageName);
  assert.ok(/^\d+$/.test(before.exports), `expected export count, got ${before.exports}`);
  assert.notEqual(before.sourceTargets, "...");
  assert.match(before.toolchain, /leanprover\/lean4/);
  assert.notEqual(before.generatedAt, "...");
  assert.equal(before.entry, expected.entry);
  if (expected.entryCount !== undefined) {
    assert.equal(before.entryCount, expected.entryCount);
  }
  if (expected.input !== undefined) {
    assert.equal(before.input, expected.input);
  }
  if (expected.inputs !== undefined) {
    assert.deepEqual(before.inputs.map((input) => input.value).slice(0, expected.inputs.length), expected.inputs);
  }
  if (expected.inputTags !== undefined) {
    assert.deepEqual(before.inputs.map((input) => input.tagName).slice(0, expected.inputTags.length), expected.inputTags);
  }

  const runInputs = expected.runInputs ?? (expected.runInput === undefined ? null : [expected.runInput]);
  const result = await runSelectedEntry(cdp, runInputs);
  assert.equal(result, expected.result);
  if (expected.documentTitle !== undefined) {
    const title = await evaluate(cdp, "document.title");
    assert.equal(title, expected.documentTitle);
  }
}

export async function runSelectedEntry(cdp, runInputs = null) {
  return evaluate(cdp, `new Promise((resolve, reject) => {
    const output = document.querySelector("#dev-result");
    const runInputs = ${JSON.stringify(runInputs)};
    if (runInputs !== null) {
      for (const [index, value] of runInputs.entries()) {
        const field = document.querySelector("[data-input-index='" + index + "']");
        if (field.type === "checkbox") {
          field.checked = value === true || value === "true";
        } else {
          field.value = value;
        }
      }
    }
    output.textContent = "pending";
    document.querySelector("#dev-run-entry").click();
    const deadline = Date.now() + 5000;
    const poll = () => {
      const text = output.textContent.trim();
      if (text !== "pending" && text !== "...") {
        resolve(text);
      } else if (Date.now() > deadline) {
        reject(new Error("runner did not produce a result"));
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  })`);
}

export async function smokeRunnerFailure(cdp, origin, url, expected) {
  await navigate(cdp, `${origin}${basePath}${url}`);
  await waitForStatus(cdp, "Failed");
  const state = await evaluate(cdp, `({
    packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    status: document.querySelector("#status")?.textContent?.trim(),
    result: document.querySelector("#dev-result")?.textContent?.trim(),
    entryCount: document.querySelector("#dev-entry-select")?.options.length,
    runDisabled: document.querySelector("#dev-run-entry")?.disabled,
    exports: document.querySelector("#dev-export-count")?.textContent?.trim()
  })`);
  assert.equal(state.status, "Failed");
  assert.match(state.result, expected.result);
  assert.equal(state.runDisabled, true);
  if (expected.packageName !== undefined) {
    assert.equal(state.packageName, expected.packageName);
  }
  if (expected.entryCount !== undefined) {
    assert.equal(state.entryCount, expected.entryCount);
  }
  if (expected.exports !== undefined) {
    assert.equal(state.exports, expected.exports);
  }
}

export async function smokeManifestDrivenEntryList(cdp, origin, packageFile) {
  const info = await packageInfoFor(packageFile);
  await navigate(cdp, `${origin}${basePath}dev.html?package=${encodeURIComponent(packageFile)}`);
  await waitForReady(cdp);
  const state = await evaluate(cdp, `(() => {
    const select = document.querySelector("#dev-entry-select");
    return {
      options: Array.from(select.options).map((option) => ({
        value: option.value,
        text: option.textContent,
      })),
      packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    };
  })()`);
  assert.equal(state.packageName, packageFile);
  assert.deepEqual(
    state.options.map((option) => option.value),
    info.manifest.exports.map((entry) => entry.id),
  );
  for (const [index, entry] of info.manifest.exports.entries()) {
    assert.ok(state.options[index].text.includes(entry.jsName), `missing ${entry.jsName} in option label`);
  }

  const expectedControls = info.manifest.exports.map((entry) => ({
    id: entry.id,
    inputTags: entry.args.map((arg) => interfaceInputTag(arg.type)),
    enumOptionCounts: entry.args.map((arg) =>
      interfaceInputTag(arg.type) === "SELECT" ? (arg.type.constructors ?? []).length : null),
  }));
  const renderedControls = await evaluate(cdp, `(() => {
    const select = document.querySelector("#dev-entry-select");
    return ${JSON.stringify(expectedControls)}.map((expected) => {
      select.value = expected.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        id: select.value,
        inputTags: Array.from(document.querySelectorAll("[data-input-index]")).map((field) => field.tagName),
        enumOptionCounts: Array.from(document.querySelectorAll("[data-input-index]")).map((field) =>
          field.tagName === "SELECT" ? field.options.length : null),
      };
    });
  })()`);
  assert.deepEqual(renderedControls, expectedControls);
}

export async function prepareNegativePackages() {
  await writeFile(resolve(distRoot, "bad-magic.irpkg"), encodeInvalidMagicPackage());

  const fibBytes = await readFile(resolve(distRoot, "local-fib.irpkg"));
  const fibInfo = readIrPackageInfo(fibBytes);
  const manifest = {
    ...fibInfo.manifest,
    diagnostics: [
      ...(Array.isArray(fibInfo.manifest.diagnostics) ? fibInfo.manifest.diagnostics : []),
      {
        name: "BrowserSmoke.unsupported",
        source: "scripts/smoke-pages-browser.mjs",
        reason: "unsupported interface export smoke fixture",
      },
    ],
  };
  await writeFile(
    resolve(distRoot, "unsupported-interface.irpkg"),
    replaceIrPackageManifest(fibBytes, manifest),
  );
}

export async function packageInfoFor(packageFile) {
  if (!packageInfoCache.has(packageFile)) {
    packageInfoCache.set(packageFile, readIrPackageInfo(await readFile(resolve(distRoot, packageFile))));
  }
  return packageInfoCache.get(packageFile);
}

export async function runnerCaseFromManifest(packageFile, entryName, expected) {
  const info = await packageInfoFor(packageFile);
  const entry = info.manifest.exports.find((candidate) =>
    candidate.entry === entryName || candidate.id === entryName || candidate.jsName === entryName);
  assert.ok(entry, `${packageFile} manifest does not export ${entryName}`);
  return {
    url: `dev.html?package=${encodeURIComponent(packageFile)}&entry=${encodeURIComponent(entry.id)}`,
    expected: {
      packageName: packageFile,
      entry: entry.id,
      entryCount: info.manifest.exports.length,
      ...expected,
    },
  };
}
