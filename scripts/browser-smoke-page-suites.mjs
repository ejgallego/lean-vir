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
  const state = await evaluate(cdp, `({
    title: document.title,
    heading: document.querySelector("h1")?.textContent?.trim(),
    hasRuntimeStatus: Boolean(document.querySelector("#status")),
    destinations: Array.from(document.querySelectorAll("a[href]"), (link) => link.getAttribute("href")),
    journeys: Array.from(document.querySelectorAll("main > section[id]"), (section) => section.id),
    integrationSteps: Array.from(document.querySelectorAll(".use-flow strong"), (step) => step.textContent?.trim()),
  })`);
  assert.equal(state.title, "Lean VIR · Lean IR in the browser");
  assert.equal(state.heading, "Lean VIR");
  assert.equal(state.hasRuntimeStatus, false);
  assert.deepEqual(state.journeys, ["try", "run", "use", "inspect"]);
  assert.deepEqual(state.integrationSteps, ["Mark", "Build", "Call"]);
  for (const href of [
    "demo.html",
    "dev.html",
    "format.html?case=list&width=12",
    "react.html",
    "benchmarks/",
    "surface/",
    "size/",
  ]) {
    assert.ok(state.destinations.includes(href), `landing page is missing ${href}`);
  }

  await setInputValueAndDispatch(cdp, "#sort-input", "4, 1, 3, 2", "input");
  await clickSelector(cdp, "#sort-run");
  const sorted = await waitForBrowserState(cdp, `(() => {
    const value = document.querySelector("#sort-result")?.textContent?.trim();
    return { ready: value === "[1, 2, 3, 4]", value };
  })()`, {
    timeoutMessage: "landing merge sort did not return the Lean result",
    timeoutMs: 15000,
  });
  assert.equal(sorted, "[1, 2, 3, 4]");
}

export async function smokeRuntimeDemo(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}demo.html`);
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
  assert.ok(state.packageItems[3].text.includes("Lean-authored React Tamagotchi"));
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

export async function smokeSurfaceExplorer(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}surface/index.html#module=Lean.Expr`);
  await waitForBrowserState(cdp, `(() => {
    const status = document.querySelector("#function-status");
    return { ready: status instanceof HTMLSelectElement, value: status?.value };
  })()`, {
    timeoutMessage: "runnable-surface module did not load",
    timeoutMs: 20000,
  });
  const progress = await evaluate(cdp, `({
    treeBars: document.querySelectorAll("#module-tree .tree-progress").length,
    tones: document.querySelectorAll("#module-tree .tree-progress[class*='progress-']").length,
    legendBands: document.querySelectorAll(".coverage-legend .coverage-swatch").length,
  })`);
  assert.ok(progress.treeBars > 0);
  assert.equal(progress.tones, progress.treeBars);
  assert.equal(progress.legendBands, 4);
  await evaluate(cdp, `(() => {
    const status = document.querySelector("#function-status");
    if (!(status instanceof HTMLSelectElement)) throw new Error("surface status selector is missing");
    status.value = "blocked";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const previousHash = await evaluate(cdp, "location.hash");
  await evaluate(cdp, `(() => {
    const next = Array.from(document.querySelectorAll("#module-tree .tree-label.file"))
      .find((button) => !button.closest(".tree-row")?.classList.contains("selected"));
    if (!(next instanceof HTMLButtonElement)) throw new Error("no second surface module is visible");
    next.click();
  })()`);
  const sticky = await waitForBrowserState(cdp, `(() => {
    const status = document.querySelector("#function-status");
    const state = { hash: location.hash, status: status?.value };
    return {
      ready: state.hash !== ${JSON.stringify(previousHash)} && state.status === "blocked",
      value: state,
      ...state,
    };
  })()`, {
    timeoutMessage: "runnable-surface status filter did not survive module navigation",
    timeoutMs: 20000,
  });
  assert.equal(sticky.status, "blocked");

  await clickSelector(cdp, "#blockers-view");
  const blockers = await evaluate(cdp, `({
    hash: location.hash,
    selected: document.querySelector("#blockers-view")?.classList.contains("selected"),
    title: document.querySelector("#report-main .content-heading h2")?.textContent,
  })`);
  assert.equal(blockers.hash, "#view=blockers");
  assert.equal(blockers.selected, true);
  assert.equal(blockers.title, "Primary blockers");
}

export async function smokeWasmSizeExplorer(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}size/index.html`);
  await waitForBrowserState(cdp, `(() => {
    const blocks = document.querySelectorAll("#treemap .map-block");
    return {
      ready: blocks.length > 0,
      value: blocks.length,
    };
  })()`, {
    timeoutMessage: "Wasm size explorer did not render its ownership treemap",
  });

  const ownership = await evaluate(cdp, `({
    selectedView: document.querySelector("#view-switch button.selected")?.dataset.view,
    blocks: document.querySelectorAll("#treemap .map-block").length,
    root: document.querySelector("#breadcrumbs button:disabled")?.textContent,
    summary: document.querySelector("#global-summary")?.textContent,
    top: Array.from(document.querySelectorAll("#top-children button span:first-child"), (node) => node.textContent),
    depth: document.querySelector("#map-depth")?.value,
    depthMax: document.querySelector("#map-depth")?.max,
    runtimeCoverageHidden: document.querySelector("#runtime-coverage")?.hidden,
  })`);
  assert.equal(ownership.selectedView, "ownership");
  assert.ok(ownership.blocks > 0);
  assert.equal(ownership.root, "Retained Code+Data");
  assert.ok(ownership.summary.includes("Code+Data attributed"));
  assert.ok(ownership.top.includes("Lean C runtime"));
  assert.equal(ownership.depth, "2");
  assert.equal(ownership.depthMax, "3");
  assert.equal(ownership.runtimeCoverageHidden, true);

  await setInputValueAndDispatch(cdp, "#map-depth", "3", "input");

  await clickSelector(cdp, "#view-switch button[data-view='debugSections']");
  const debugSections = await evaluate(cdp, `({
    selectedView: document.querySelector("#view-switch button.selected")?.dataset.view,
    root: document.querySelector("#breadcrumbs button:disabled")?.textContent,
    top: Array.from(document.querySelectorAll("#top-children button span:first-child"), (node) => node.textContent),
  })`);
  assert.equal(debugSections.selectedView, "debugSections");
  assert.equal(debugSections.root, "Debug Wasm binary");
  assert.ok(debugSections.top.includes("Code"));
  assert.ok(debugSections.top.some((name) => name.startsWith("Custom:.debug")));
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth')?.max"), "1");

  await clickSelector(cdp, "#view-switch button[data-view='ownership']");
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth')?.value"), "3");
  await setInputValueAndDispatch(cdp, "#node-search", "package_decl_provider", "input");
  const search = await evaluate(cdp, `({
    visible: !document.querySelector("#search-results-section")?.hidden,
    results: Array.from(document.querySelectorAll("#search-results button span:first-child"), (node) => node.textContent),
  })`);
  assert.equal(search.visible, true);
  assert.ok(search.results.some((name) => name.includes("package_decl_provider")));

  await setInputValueAndDispatch(cdp, "#node-search", "lean_mk_array", "input");
  await clickSelector(cdp, "#search-results button");
  const surfaceBridge = await evaluate(cdp, `({
    entry: document.querySelector("#selection-details .detail-actions a")?.textContent,
    href: document.querySelector("#selection-details .detail-actions a")?.getAttribute("href"),
  })`);
  assert.equal(surfaceBridge.entry, "Array.replicate");
  assert.ok(surfaceBridge.href.includes("../surface/#declaration=Array.replicate"));

  await clickSelector(cdp, "#scope-switch button[data-scope='context']");
  await waitForBrowserState(cdp, `(() => {
    const selected = document.querySelector("#scope-switch button.selected")?.dataset.scope;
    return { ready: selected === "context", value: selected };
  })()`, { timeoutMessage: "Wasm size explorer scope transition did not finish" });
  const context = await evaluate(cdp, `({
    selectedScope: document.querySelector("#scope-switch button.selected")?.dataset.scope,
    scopeTransition: {
      supported: typeof document.startViewTransition === "function",
      name: getComputedStyle(document.querySelector("#treemap")).viewTransitionName,
    },
    root: document.querySelector("#breadcrumbs button:disabled")?.textContent,
    note: document.querySelector("#view-note")?.textContent,
    explanationOpen: document.querySelector(".view-explanation")?.open,
    mixed: document.querySelectorAll("#treemap .mixed-boundary").length,
    outside: document.querySelectorAll("#treemap .outside-boundary").length,
    depth: document.querySelector("#map-depth")?.value,
    depthMax: document.querySelector("#map-depth")?.max,
    depthTwo: document.querySelectorAll("#treemap .depth-2").length,
    depthTwoLabels: Array.from(document.querySelectorAll("#treemap .depth-2 .block-label strong"), (node) => node.textContent),
    depthThree: document.querySelectorAll("#treemap .depth-3").length,
    archiveColors: Array.from(document.querySelectorAll("#treemap .depth-1"), (node) => ({
      name: node.querySelector(":scope > .block-label strong")?.textContent,
      color: getComputedStyle(node).backgroundColor,
    })).filter((entry) => entry.name?.endsWith(".a")),
    legend: {
      hidden: document.querySelector("#color-legend")?.hidden,
      title: document.querySelector("#color-legend-title")?.textContent,
      min: document.querySelector("#color-legend-min")?.textContent,
      max: document.querySelector("#color-legend-max")?.textContent,
    },
    retainedCodeLabel: document.querySelector("#context-color-switch button[data-context-color='boundary']")?.textContent,
    coverage: (() => {
      const native = globalThis.__virWasmSize.trees.runtimeContext.children
        .find((node) => node.meta?.layer === "native");
      const ratio = native.meta.retainedNativeFunctionBytes / native.bytes;
      return {
        hidden: document.querySelector("#runtime-coverage")?.hidden,
        title: document.querySelector("#runtime-coverage-title")?.textContent,
        percent: document.querySelector("#runtime-coverage-percent")?.value,
        expectedPercent: (ratio * 100).toFixed(1) + "%",
        expectedFill: ratio * 100,
        fill: Number.parseFloat(document.querySelector("#runtime-coverage-fill")?.style.width),
        description: document.querySelector("#runtime-coverage-description")?.textContent,
        facts: Array.from(document.querySelectorAll("#runtime-coverage-facts > div"), (node) => node.textContent),
        retainedFunctions: native.meta.retainedFunctionCount.toLocaleString("en-US"),
        totalFunctions: native.meta.functionCount.toLocaleString("en-US"),
      };
    })(),
    objectFunctions: (() => {
      let object = null;
      const visit = (node) => {
        if (node.kind === "runtimeMember" && node.name === "object.cpp") object = node;
        for (const child of node.children ?? []) visit(child);
      };
      visit(globalThis.__virWasmSize.trees.runtimeContext);
      return {
        total: object.meta.functionCount,
        retained: object.meta.retainedFunctionCount,
        density: object.meta.boundaryDensity,
      };
    })(),
    surfaceMapping: {
      mappedMissing: globalThis.__virWasmSize.runtimeContext.missingSurfaceEntries,
      totalMissing: globalThis.__virWasmSize.runtimeContext.totalMissingSurfaceEntries,
      unmappedMissing: globalThis.__virWasmSize.runtimeContext.unmappedMissingSurfaceEntries,
      primaryRoots: globalThis.__virWasmSize.runtimeContext.primaryRoots,
    },
  })`);
  assert.equal(context.selectedScope, "context");
  assert.equal(context.scopeTransition.supported, true);
  assert.equal(context.scopeTransition.name, "vir-map-scope");
  assert.equal(context.root, "Installed Lean execution context");
  assert.equal(context.explanationOpen, false);
  assert.ok(context.note.includes("exact retained Wasm symbols"));
  assert.ok(context.surfaceMapping.mappedMissing > 300);
  assert.ok(context.surfaceMapping.totalMissing > context.surfaceMapping.mappedMissing);
  assert.equal(
    context.surfaceMapping.unmappedMissing,
    context.surfaceMapping.totalMissing - context.surfaceMapping.mappedMissing,
  );
  assert.ok(context.surfaceMapping.primaryRoots > 40_000);
  assert.ok(context.mixed > 0);
  assert.ok(context.outside > 0);
  assert.equal(context.depth, "4");
  assert.equal(context.depthMax, "7");
  assert.ok(context.depthTwo > 0);
  assert.ok(context.depthTwoLabels.includes("src/"));
  assert.ok(context.depthThree > 0);
  assert.ok(context.archiveColors.length >= 2);
  assert.ok(new Set(context.archiveColors.map((entry) => entry.color)).size >= 2);
  assert.deepEqual(context.legend, {
    hidden: false,
    title: "Exact retained-function byte density",
    min: "0%",
    max: "100%",
  });
  assert.equal(context.retainedCodeLabel, "Retained code");
  assert.equal(context.coverage.hidden, false);
  assert.equal(context.coverage.title, "Full Lean native support");
  assert.equal(context.coverage.percent, context.coverage.expectedPercent);
  assert.ok(Math.abs(context.coverage.fill - context.coverage.expectedFill) < 0.01);
  assert.ok(context.coverage.description.includes("exact retained Wasm counterparts"));
  assert.equal(context.coverage.facts.length, 2);
  assert.ok(context.coverage.facts[0].includes(
    `${context.coverage.retainedFunctions} / ${context.coverage.totalFunctions}`,
  ));
  assert.equal(context.objectFunctions.total, 260);
  assert.ok(
    Number.isInteger(context.objectFunctions.retained)
      && context.objectFunctions.retained >= 0
      && context.objectFunctions.retained < context.objectFunctions.total,
  );
  assert.ok(
    Number.isFinite(context.objectFunctions.density)
      && context.objectFunctions.density >= 0
      && context.objectFunctions.density < 1,
  );
  await setInputValueAndDispatch(cdp, "#node-search", "expr.cpp", "input");
  await clickSelector(cdp, "#search-results button");
  const runtimeMemberDetails = await evaluate(cdp, `({
    title: document.querySelector("#selection-details h2")?.textContent,
    statLabels: Array.from(document.querySelectorAll("#selection-details .detail-stats dt"),
      (node) => node.textContent),
    highlightTitles: Array.from(document.querySelectorAll("#selection-details .detail-highlights h3"),
      (node) => node.textContent),
    pressureFunctions: Array.from(document.querySelectorAll(
      "#selection-details .detail-highlights section:nth-child(2) button span:first-child",
    ), (node) => node.textContent),
    retainedRows: document.querySelectorAll(
      "#selection-details .detail-highlights section:nth-child(3) li",
    ).length,
    expectedRetainedRows: (() => {
      let result = 0;
      const visit = (node) => {
        if (node.kind === "runtimeMember" && node.name === "expr.cpp") {
          result = node.children
            .filter((child) => child.kind === "runtimeFunction" && child.meta.inVirBoundary)
            .slice(0, 5)
            .length;
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(globalThis.__virWasmSize.trees.runtimeContext);
      return result;
    })(),
    archiveBreakdown: (() => {
      let result = null;
      const visit = (node) => {
        if (node.kind === "runtimeMember" && node.name === "expr.cpp") result = {
          bytes: node.bytes,
          childBytes: node.children.reduce((sum, child) => sum + child.bytes, 0),
          categories: node.children
            .filter((child) => child.kind === "runtimeOverhead")
            .map((child) => child.name),
        };
        for (const child of node.children ?? []) visit(child);
      };
      visit(globalThis.__virWasmSize.trees.runtimeContext);
      return result;
    })(),
  })`);
  assert.equal(runtimeMemberDetails.title, "expr.cpp");
  assert.ok(runtimeMemberDetails.statLabels.includes("Functions with blocker pressure"));
  assert.ok(runtimeMemberDetails.statLabels.includes("Retained + blocker overlap"));
  assert.ok(runtimeMemberDetails.statLabels.includes("Zero-fill memory (not archive bytes)"));
  assert.deepEqual(runtimeMemberDetails.highlightTitles, [
    "Largest native functions",
    "Highest frontier pressure",
    ...(runtimeMemberDetails.expectedRetainedRows > 0 ? ["Retained in VIR Wasm"] : []),
  ]);
  assert.ok(runtimeMemberDetails.pressureFunctions.includes("lean_expr_has_loose_bvar"));
  assert.equal(runtimeMemberDetails.retainedRows, runtimeMemberDetails.expectedRetainedRows);
  assert.equal(
    runtimeMemberDetails.archiveBreakdown.childBytes,
    runtimeMemberDetails.archiveBreakdown.bytes,
  );
  assert.ok(runtimeMemberDetails.archiveBreakdown.categories.includes("Relocation records"));
  assert.ok(runtimeMemberDetails.archiveBreakdown.categories.includes("Symbol and string tables"));
  assert.ok(runtimeMemberDetails.archiveBreakdown.categories.includes("ELF metadata and alignment"));
  await clickSelector(cdp, "#breadcrumbs button:first-child");

  await setInputValueAndDispatch(cdp, "#node-search", "src/", "input");
  await clickSelector(cdp, "#search-results button");
  const sourceDirectoryDetail = await evaluate(cdp, `(() => {
    const exprBlock = Array.from(document.querySelectorAll("#treemap .map-block"))
      .find((block) => block.getAttribute("aria-label")?.startsWith("expr.cpp,"));
    return {
      root: document.querySelector("#breadcrumbs button:disabled")?.textContent,
      breadcrumbs: Array.from(document.querySelectorAll("#breadcrumbs button"),
        (button) => button.textContent),
      exprWidth: exprBlock?.getBoundingClientRect().width ?? 0,
      exprHeight: exprBlock?.getBoundingClientRect().height ?? 0,
      exprChildren: exprBlock?.querySelectorAll(":scope > .nested-map > .map-block").length ?? 0,
      exprLooseBVar: exprBlock?.querySelectorAll(
        ":scope > .nested-map > [aria-label^='lean_expr_has_loose_bvar,']",
      ).length ?? 0,
    };
  })()`);
  assert.equal(sourceDirectoryDetail.root, "src/");
  assert.ok(sourceDirectoryDetail.breadcrumbs.includes("libleancpp.a"));
  assert.ok(sourceDirectoryDetail.exprWidth >= 36);
  assert.ok(sourceDirectoryDetail.exprHeight >= 40);
  assert.ok(sourceDirectoryDetail.exprChildren > 0);
  assert.ok(sourceDirectoryDetail.exprLooseBVar > 0);
  await clickSelector(cdp, "#breadcrumbs button:first-child");
  await setInputValueAndDispatch(cdp, "#node-search", "", "input");

  const hoverCoverage = await evaluate(cdp, `(() => {
    const native = globalThis.__virWasmSize.trees.runtimeContext.children
      .find((node) => node.meta?.layer === "native");
    const archive = native.children.find((node) => node.name === "libleanrt.a");
    const block = Array.from(document.querySelectorAll("#treemap .map-block"))
      .find((node) => node.dataset.nodeId === archive.id);
    block.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const hovered = {
      title: document.querySelector("#runtime-coverage-title")?.textContent,
      percent: document.querySelector("#runtime-coverage-percent")?.value,
      expectedPercent: (archive.meta.retainedNativeFunctionBytes / archive.bytes * 100).toFixed(1) + "%",
      facts: Array.from(document.querySelectorAll("#runtime-coverage-facts > div"), (node) => node.textContent),
    };
    document.querySelector("#treemap").dispatchEvent(new PointerEvent("pointerleave"));
    return {
      hovered,
      resetTitle: document.querySelector("#runtime-coverage-title")?.textContent,
    };
  })()`);
  assert.equal(hoverCoverage.hovered.title, "libleanrt.a");
  assert.equal(hoverCoverage.hovered.percent, hoverCoverage.hovered.expectedPercent);
  assert.equal(hoverCoverage.hovered.facts.length, 2);
  assert.equal(hoverCoverage.resetTitle, "Full Lean native support");

  await clickSelector(cdp, ".view-explanation summary");
  const explanation = await evaluate(cdp, `({
    open: document.querySelector(".view-explanation")?.open,
    noteWidth: document.querySelector("#view-note")?.getBoundingClientRect().width,
    breadcrumbWidth: document.querySelector("#breadcrumbs")?.getBoundingClientRect().width,
  })`);
  assert.equal(explanation.open, true);
  assert.ok(explanation.noteWidth > 300);
  assert.ok(explanation.breadcrumbWidth > 300);
  await clickSelector(cdp, ".view-explanation summary");

  const deepContext = await evaluate(cdp, `(async () => {
    const input = document.querySelector("#map-depth");
    input.value = "7";
    const started = performance.now();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    return {
      depth: input.value,
      output: document.querySelector("#map-depth-value")?.value,
      hash: location.hash,
      renderMs: performance.now() - started,
      sharedAreas: document.querySelectorAll("#treemap [data-wasm-node-id]").length,
      sharedWasmIds: Array.from(document.querySelectorAll("#treemap [data-wasm-node-id]"),
        (node) => node.dataset.wasmNodeId),
      depthSix: document.querySelectorAll("#treemap .depth-6").length,
      depthFourNames: Array.from(document.querySelectorAll("#treemap .depth-4"), (node) => node.getAttribute("aria-label")),
      depthFiveNames: Array.from(document.querySelectorAll("#treemap .depth-5"), (node) => node.getAttribute("aria-label")),
      depthSixNames: Array.from(document.querySelectorAll("#treemap .depth-6"), (node) => node.getAttribute("aria-label")),
    };
  })()`);
  assert.equal(deepContext.depth, "7");
  assert.equal(deepContext.output, "7 / 7");
  assert.ok(deepContext.hash.includes("depth=7"));
  assert.ok(deepContext.renderMs < 1500, `level-7 treemap render took ${deepContext.renderMs} ms`);
  assert.ok(deepContext.sharedAreas > 0);
  assert.ok(deepContext.depthSix > 0);
  assert.ok(deepContext.depthFourNames.some((name) => name?.startsWith("object.cpp,")));
  assert.ok(deepContext.depthFiveNames.some((name) => name?.startsWith("tcp.cpp,")));
  assert.ok(deepContext.depthFiveNames.some((name) => name?.startsWith("lean_mark_mt,")));
  assert.ok(deepContext.depthSixNames.some((name) => name?.startsWith("lean_uv_tcp_send,")));

  await clickSelector(cdp, "#scope-switch button[data-scope='boundary']");
  await waitForBrowserState(cdp, `(() => {
    const selected = document.querySelector("#scope-switch button.selected")?.dataset.scope;
    return { ready: selected === "boundary", value: selected };
  })()`, { timeoutMessage: "Wasm size explorer shared transition did not reach boundary scope" });
  const boundarySharedWasmIds = await evaluate(cdp,
    "Array.from(document.querySelectorAll('#treemap [data-wasm-node-id]'), "
      + "(node) => node.dataset.wasmNodeId)");
  assert.ok(deepContext.sharedWasmIds.some((id) => boundarySharedWasmIds.includes(id)));
  await clickSelector(cdp, "#scope-switch button[data-scope='context']");
  await waitForBrowserState(cdp, `(() => {
    const selected = document.querySelector("#scope-switch button.selected")?.dataset.scope;
    return { ready: selected === "context", value: selected };
  })()`, { timeoutMessage: "Wasm size explorer shared transition did not return to context" });
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth')?.value"), "7");

  await clickSelector(cdp, "#top-children button");
  const nativeLayer = await evaluate(cdp, `({
    root: document.querySelector("#breadcrumbs button:disabled")?.textContent,
    top: Array.from(document.querySelectorAll("#top-children button span:first-child"), (node) => node.textContent),
    inside: document.querySelectorAll("#treemap .in-boundary").length,
  })`);
  assert.equal(nativeLayer.root, "Lean native support");
  assert.ok(nativeLayer.top.includes("libleanrt.a"));
  assert.ok(nativeLayer.top.includes("libleancpp.a"));
  assert.ok(nativeLayer.inside > 0);
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth')?.value"), "6");
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth-value')?.value"), "6 / 6");

  await clickSelector(cdp, "#context-color-switch button[data-context-color='frontier']");
  const frontier = await evaluate(cdp, `({
    selectedColor: document.querySelector("#context-color-switch button.selected")?.dataset.contextColor,
    note: document.querySelector("#view-note")?.textContent,
    pressured: document.querySelectorAll("#treemap .frontier-pressure").length,
    colorRange: (() => {
      const blocks = Array.from(document.querySelectorAll("#treemap .frontier-pressure"));
      const lightness = blocks.map((block) => Number.parseFloat(
        block.style.getPropertyValue("--frontier-lightness"),
      ));
      const saturation = blocks.map((block) => Number.parseFloat(
        block.style.getPropertyValue("--frontier-saturation"),
      ));
      return {
        lightness: Math.max(...lightness) - Math.min(...lightness),
        saturation: Math.max(...saturation) - Math.min(...saturation),
      };
    })(),
    listTitle: document.querySelector("#child-list-title")?.textContent,
    top: Array.from(document.querySelectorAll("#top-children button span:first-child"), (node) => node.textContent),
    densityAverage: (() => {
      const native = globalThis.__virWasmSize.trees.runtimeContext.children
        .find((node) => node.name === "Lean native support");
      const weighted = native.children.reduce(
        (sum, child) => sum + child.meta.frontierDensity * child.bytes,
        0,
      ) / native.bytes;
      return Math.abs(weighted - native.meta.frontierDensity);
    })(),
    legendTitle: document.querySelector("#color-legend-title")?.textContent,
    legendMax: document.querySelector("#color-legend-max")?.textContent,
  })`);
  assert.equal(frontier.selectedColor, "frontier");
  assert.ok(frontier.note.includes("not predicted unlock"));
  assert.ok(frontier.pressured > 0);
  assert.ok(frontier.colorRange.lightness > 8);
  assert.ok(frontier.colorRange.saturation > 8);
  assert.ok(frontier.note.includes("averaged by child bytes"));
  assert.equal(frontier.listTitle, "Frontier pressure");
  assert.ok(frontier.top.length > 0);
  assert.ok(frontier.top.every((name) => nativeLayer.top.includes(name)));
  assert.ok(frontier.densityAverage < 1e-9);
  assert.equal(frontier.legendTitle, "Blocker density · log color scale");
  assert.ok(frontier.legendMax.endsWith("roots / MiB"));

  await clickSelector(cdp, "#context-color-switch button[data-context-color='combined']");
  const combined = await evaluate(cdp, `({
    selectedColor: document.querySelector("#context-color-switch button.selected")?.dataset.contextColor,
    note: document.querySelector("#view-note")?.textContent,
    overlap: document.querySelectorAll("#treemap .combined-overlap").length,
    boundary: document.querySelectorAll("#treemap .combined-boundary").length,
    neither: document.querySelectorAll("#treemap .combined-neither").length,
    listTitle: document.querySelector("#child-list-title")?.textContent,
    legendTitle: document.querySelector("#color-legend-title")?.textContent,
    legendMin: document.querySelector("#color-legend-min")?.textContent,
    legendMax: document.querySelector("#color-legend-max")?.textContent,
    hash: location.hash,
    top: Array.from(document.querySelectorAll("#top-children button span:first-child"), (node) => node.textContent),
    overlapLeaves: (() => {
      let count = 0;
      const visit = (node) => {
        if (!(node.children?.length)
            && (node.meta?.boundaryDensity ?? 0) > 0
            && (node.meta?.frontierDensity ?? 0) > 0) count += 1;
        for (const child of node.children ?? []) visit(child);
      };
      visit(globalThis.__virWasmSize.trees.runtimeContext);
      return count;
    })(),
  })`);
  assert.equal(combined.selectedColor, "combined");
  assert.ok(combined.overlapLeaves > 0);
  assert.ok(combined.note.includes(`${combined.overlapLeaves} leaf functions currently have both signals`));
  assert.ok(combined.note.includes("separate boundaries"));
  assert.ok(combined.overlap > 0);
  assert.ok(combined.boundary > 0);
  assert.ok(combined.neither > 0);
  assert.equal(combined.listTitle, "Retained + blocker overlap");
  assert.equal(combined.top.length, combined.overlapLeaves);
  assert.equal(combined.legendTitle, "Green retained · orange pressure · purple overlap");
  assert.equal(combined.legendMin, "neither");
  assert.equal(combined.legendMax, "both");
  assert.ok(combined.hash.includes("color=combined"));

  await clickSelector(cdp, "#top-children button");
  const overlapDetail = await evaluate(cdp, `({
    title: document.querySelector("#selection-details h2")?.textContent,
    surfaceEntry: document.querySelector("#selection-details .detail-actions a")?.textContent,
    surfaceHref: document.querySelector("#selection-details .detail-actions a")?.getAttribute("href"),
  })`);
  assert.ok(combined.top.includes(overlapDetail.title));
  assert.ok(overlapDetail.surfaceEntry);
  assert.ok(overlapDetail.surfaceHref.includes("../surface/#declaration="));

  await clickSelector(cdp, "#breadcrumbs button:first-child");
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth')?.value"), "7");
  assert.equal(await evaluate(cdp, "document.querySelector('#map-depth-value')?.value"), "7 / 7");
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
