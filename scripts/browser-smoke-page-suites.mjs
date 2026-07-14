/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  basePath,
  evaluate,
  navigate,
  waitForReady,
} from "./browser-smoke-harness.mjs";
import {
  clickSelector,
  setInputValueAndDispatch,
  waitForBrowserState,
} from "./browser-smoke-page-actions.mjs";
import {
  boundaryPackageFile,
  defaultPackageFile,
  hostPackageFile,
  leanPackageFile,
  packageFiles,
  packagePresets,
  prettyPackageFile,
} from "./browser-package-config.mjs";
import { packageInfoFor } from "./browser-smoke-dev-runner.mjs";

export async function smokeLanding(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}`);
  await waitForReady(cdp);
  const state = await evaluate(cdp, `({
    packageName: document.querySelector("#package-name")?.textContent?.trim(),
    packageItems: Array.from(document.querySelectorAll(".package-item")).map((link) => ({
      href: link.getAttribute("href"),
      text: link.textContent.trim().replace(/\\s+/g, " "),
    })),
    name: document.querySelector("#pet-name-display")?.textContent?.trim(),
    mood: document.querySelector("#pet-mood-display")?.textContent?.trim(),
    care: document.querySelector("#pet-care-display")?.textContent?.trim(),
    turns: document.querySelector("#pet-turn-display")?.textContent?.trim()
  })`);
  assert.equal(
    state.packageName,
    packageFiles.join(", "),
  );
  assert.equal(state.mood, "happy");
  assert.deepEqual(state.packageItems.map((item) => item.href), [
    "dev.html?package=local-quickstart.irpkg&entry=Quickstart.total",
    `dev.html?package=${defaultPackageFile}&entry=Vir_Fixtures_InterfaceShapes_profileStatsBump`,
    `dev.html?package=${hostPackageFile}&entry=HostInterop_titleHandshake`,
    "react.html",
    "format.html?case=list&width=12",
    `dev.html?package=${leanPackageFile}&entry=Vir_Fixtures_ExprPrinter_exprKindScore`,
    `dev.html?package=${boundaryPackageFile}&entry=Vir_Fixtures_Boundary_floatScaleScore`,
  ]);
  assert.ok(state.packageItems[0].text.includes("Four small exports from one Lean file"));
  assert.ok(state.packageItems[1].text.includes("Basic, list/option, interface shapes"));
  assert.ok(state.packageItems[2].text.includes("Browser host calls, React, and Tamagotchi demos"));
  assert.ok(state.packageItems[3].text.includes("Lean-authored React examples"));
  assert.ok(state.packageItems[4].text.includes("Std.Format.pretty component package"));
  assert.ok(state.packageItems[5].text.includes("Lean Expr, parser, Task"));
  assert.equal(state.name, "Octi");
  assert.equal(state.care, "3/5");
  assert.equal(state.turns, "0");

  await setInputValueAndDispatch(cdp, "#pet-name-input", "Ada", "change");
  await clickSelector(cdp, "[data-action='ignore']");
  const stepped = await waitForBrowserState(cdp, landingPetStateScript("state.mood === 'hungry'"), {
    timeoutMessage: "Lean Tamagotchi step did not update the page",
  });
  assert.deepEqual(stepped, {
    name: "Ada",
    mood: "hungry",
    action: "ignore",
    trace: "happy -> hungry",
    care: "2/5",
    turns: "1",
    summary: "Ada is hungry; last ignore; care 2/5; turn 1",
    deviceName: "Ada",
    deviceMood: "hungry",
    deviceTrace: "happy,hungry",
    deviceTurns: "1",
    deviceCare: "2",
    status: "Ready",
  });
}

export async function smokeFormatWorkbench(cdp, origin) {
  const packageInfo = await packageInfoFor(prettyPackageFile);
  await navigate(cdp, `${origin}${basePath}format.html?case=list&width=12`);
  await waitForBrowserState(cdp, `(() => {
    const status = document.querySelector("#format-status")?.textContent?.trim();
    return {
      ready: status === "Ready",
      value: status,
      status,
    };
  })()`, {
    timeoutMessage: "format page did not become Ready",
    timeoutMs: 15000,
    pollMs: 100,
  });

  const loaded = await evaluate(cdp, `({
    status: document.querySelector("#format-status")?.textContent?.trim(),
    exports: document.querySelector("#format-export-count")?.textContent?.trim(),
    width: document.querySelector("#format-width-input")?.value,
    active: document.querySelector("[data-case][aria-pressed='true']")?.dataset.case,
    ruler: document.querySelector("#format-ruler")?.textContent,
    output: document.querySelector("#format-output")?.textContent,
    source: document.querySelector("#format-source")?.textContent,
  })`);
  assert.equal(loaded.status, "Ready");
  assert.equal(loaded.exports, String(packageInfo.manifest.exports.length));
  assert.equal(loaded.width, "12");
  assert.equal(loaded.active, "list");
  assert.equal(loaded.ruler, "|------------| 12");
  assert.equal(loaded.output, "[alpha,\n beta,\n gamma]");
  assert.ok(loaded.source.includes("Format.group <|"));

  const changed = await evaluate(cdp, `(() => {
    const widthInput = document.querySelector("#format-width-input");
    widthInput.value = "28";
    widthInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("[data-case='fill']").click();
    return {
      active: document.querySelector("[data-case][aria-pressed='true']")?.dataset.case,
      width: widthInput.value,
      output: document.querySelector("#format-output")?.textContent,
      url: window.location.href,
    };
  })()`);
  assert.equal(changed.active, "fill");
  assert.equal(changed.width, "28");
  assert.equal(changed.output, "lean ir runs format.pretty\ninside wasm");
  assert.ok(changed.url.includes("case=fill"));
  assert.ok(changed.url.includes("width=28"));
}

export async function smokePackagePreset(cdp, origin) {
  const packageInfo = await packageInfoFor(hostPackageFile);
  await navigate(cdp, `${origin}${basePath}dev.html`);
  await waitForReady(cdp);
  const state = await evaluate(cdp, `({
    packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    preset: document.querySelector("#dev-package-preset")?.value,
    options: Array.from(document.querySelector("#dev-package-preset")?.options ?? []).map((option) => option.value)
  })`);
  assert.equal(state.packageName, defaultPackageFile);
  assert.equal(state.preset, defaultPackageFile);
  assert.deepEqual(state.options, [...packagePresets.map((preset) => preset.file), ""]);

  await evaluate(cdp, `(() => {
    const preset = document.querySelector("#dev-package-preset");
    if (!(preset instanceof HTMLSelectElement)) {
      throw new Error("package preset selector is missing");
    }
    preset.value = ${JSON.stringify(hostPackageFile)};
    preset.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const switched = await waitForBrowserState(cdp, packagePresetStateScript(`
    state.status === "Ready" &&
    state.packageName === ${JSON.stringify(hostPackageFile)}
  `), {
    timeoutMessage: `package preset did not load ${hostPackageFile}`,
  });
  assert.deepEqual(switched, {
    status: "Ready",
    packageName: hostPackageFile,
    packageUrl: hostPackageFile,
    entryCount: packageInfo.manifest.exports.length,
  });
}

function landingPetStateScript(condition) {
  return `(() => {
    const state = {
      name: document.querySelector("#pet-name-display")?.textContent?.trim(),
      mood: document.querySelector("#pet-mood-display")?.textContent?.trim(),
      action: document.querySelector("#pet-action-display")?.textContent?.trim(),
      trace: document.querySelector("#pet-trace-display")?.textContent?.trim(),
      care: document.querySelector("#pet-care-display")?.textContent?.trim(),
      turns: document.querySelector("#pet-turn-display")?.textContent?.trim(),
      summary: document.querySelector("#pet-summary-display")?.textContent?.trim(),
      deviceName: document.querySelector("#pet-device")?.dataset.name,
      deviceMood: document.querySelector("#pet-device")?.dataset.mood,
      deviceTrace: document.querySelector("#pet-device")?.dataset.trace,
      deviceTurns: document.querySelector("#pet-device")?.dataset.turns,
      deviceCare: document.querySelector("#pet-device")?.dataset.care,
      status: document.querySelector("#status")?.textContent?.trim(),
    };
    return {
      ready: Boolean(${condition}),
      value: state,
      ...state,
    };
  })()`;
}

function packagePresetStateScript(condition) {
  return `(() => {
    const state = {
      status: document.querySelector("#status")?.textContent?.trim(),
      packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
      packageUrl: document.querySelector("#dev-package-url")?.value,
      entryCount: document.querySelector("#dev-entry-select")?.options.length,
    };
    return {
      ready: Boolean(${condition}),
      value: state,
      ...state,
    };
  })()`;
}
