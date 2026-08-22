/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  evaluate,
  launchChromium,
  navigate,
  openChromiumPage,
} from "./harness.mjs";
import {
  nativeExternFixture,
  surfaceCounts,
  surfaceDefinition,
  targetCaptureFixture,
} from "../surface/fixtures.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(join(tmpdir(), "vir-surface-browser-"));
let chromium = null;

try {
  const reportPath = join(temporary, "surface.json");
  const htmlDir = join(temporary, "html");
  const multiReportPath = join(temporary, "multi-surface.json");
  const multiHtmlDir = join(temporary, "multi-html");
  const frontierCostsPath = join(temporary, "frontier-costs.json");
  await writeFile(reportPath, `${JSON.stringify(focusedReportFixture())}\n`);
  await writeFile(multiReportPath, `${JSON.stringify(multiFocusedReportFixture())}\n`);
  await writeFile(frontierCostsPath, `${JSON.stringify(frontierCostFixture())}\n`);
  const rendered = spawnSync(
    process.execPath,
    [
      "scripts/render-surface-report.mjs", reportPath, htmlDir,
      "--frontier-costs", frontierCostsPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(rendered.status, 0, `report rendering failed\n${rendered.stdout}\n${rendered.stderr}`);
  const multiRendered = spawnSync(
    process.execPath,
    ["scripts/render-surface-report.mjs", multiReportPath, multiHtmlDir],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    multiRendered.status,
    0,
    `multi-report rendering failed\n${multiRendered.stdout}\n${multiRendered.stderr}`,
  );

  chromium = await launchChromium();
  const cdp = await openChromiumPage(chromium);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate(cdp, pathToFileURL(join(htmlDir, "index.html")).href);
  await waitFor(cdp, `document.querySelector(".focused-target-detail") !== null`);

  const initial = await evaluate(cdp, `({
    title: document.querySelector("#report-title")?.textContent,
    heading: document.querySelector("main h2")?.textContent,
    active: document.querySelector(".report-view.selected span")?.textContent,
    controlsHidden: document.querySelector(".navigator-controls")?.hidden,
    modulesOpen: document.querySelector("#module-browser")?.open,
    allAnalysesVisible: !document.querySelector("#all-analyses-link")?.hidden,
    wasmSizeHidden: document.querySelector("#wasm-size-link")?.hidden,
    hostedDemoHidden: document.querySelector("#hosted-demo-link")?.hidden,
    leanType: document.querySelector(".declaration-signature")?.textContent,
    leanDoc: document.querySelector(".declaration-docstring")?.textContent,
    statusCard: document.querySelector(".status-card")?.textContent.trim(),
    methodOpen: document.querySelector("#analysis-method")?.open,
    method: document.querySelector("#analysis-method-body")?.textContent.replace(/\\s+/g, " ").trim(),
    reachableNodes: [...document.querySelectorAll(".stat-card")]
      .find((card) => card.textContent.includes("Root-reachable nodes"))?.textContent.replace(/\\s+/g, " ").trim(),
    blockerSetsVisible: !document.querySelector("#blocker-sets-view")?.hidden,
    setAction: document.querySelector(".target-set-action")?.textContent,
    scrollY,
  })`);
  assert.equal(initial.title, "VIR Boundary Explorer");
  assert.equal(initial.heading, "Smoke.Target.main");
  assert.equal(initial.active, "Target");
  assert.equal(initial.controlsHidden, true);
  assert.equal(initial.modulesOpen, false);
  assert.equal(initial.allAnalysesVisible, true);
  assert.equal(initial.wasmSizeHidden, true);
  assert.equal(initial.hostedDemoHidden, true);
  assert.equal(initial.leanType, "IO UInt64");
  assert.equal(initial.leanDoc, "Compile the selected smoke target.");
  assert.match(initial.statusCard, /Blocked/);
  assert.equal(initial.methodOpen, true);
  assert.match(initial.method, /5 of 6 captured nodes are root-reachable/);
  assert.match(initial.method, /Smoke\/Target\.lean/);
  assert.match(initial.method, /aaaaaaaaaaaa/);
  assert.match(initial.method, /cccccccccccc/);
  assert.match(initial.method, /lean-vir-native-externs\.json \(1 externs\)/);
  assert.match(initial.method, /Manifest SHA-256bbbbbbbbbbbb/);
  assert.match(initial.method, /provider compilation and linking are not tested/);
  assert.match(initial.method, /Boundary families are name-based navigation groups/);
  assert.match(initial.reachableNodes, /5 \/ 6/);
  assert.equal(initial.blockerSetsVisible, true);
  assert.equal(initial.setAction, "View complete blocker set (2)");
  assert.equal(initial.scrollY, 0);

  await evaluate(cdp, `document.querySelector(".target-set-action").click()`);
  await waitFor(cdp, `document.querySelector(".function-blocker-set-drawer") !== null`);
  const directSet = await evaluate(cdp, `({
    eyebrow: document.querySelector(".function-blocker-set-drawer .eyebrow")?.textContent,
    heading: document.querySelector(".function-blocker-set-drawer h2")?.textContent,
    rows: document.querySelectorAll(".blocker-set-drawer-table tbody tr").length,
    unmeasured: document.querySelectorAll(".blocker-set-drawer-table .size-impact.unmeasured").length,
    measured: document.querySelector(".blocker-set-drawer-table .size-impact.measured")?.textContent,
  })`);
  assert.deepEqual(directSet, {
    eyebrow: "Complete blocker set",
    heading: "Smoke.Target.main",
    rows: 2,
    unmeasured: 1,
    measured: "256 B raw / 32 B gzip",
  });
  await evaluate(cdp, `document.querySelector(".function-blocker-set-drawer .boundary-link").click()`);
  await waitFor(cdp, `document.querySelectorAll(".boundary-drawer-layer").length === 2`);
  const nestedDrawer = await evaluate(cdp, `({
    layers: document.querySelectorAll(".boundary-drawer-layer").length,
    parentHidden: document.querySelectorAll(".boundary-drawer-layer")[0].getAttribute("aria-hidden"),
    heading: [...document.querySelectorAll(".boundary-drawer h2")].at(-1)?.textContent,
  })`);
  assert.deepEqual(nestedDrawer, {
    layers: 2,
    parentHidden: "true",
    heading: "IO.monoNanosNow",
  });
  await evaluate(cdp, `[...document.querySelectorAll(".boundary-drawer-close")].at(-1).click()`);
  await waitFor(cdp, `document.querySelectorAll(".boundary-drawer-layer").length === 1`);
  assert.deepEqual(await evaluate(cdp, `({
    functionDrawer: document.querySelector(".function-blocker-set-drawer") !== null,
    parentHidden: document.querySelector(".boundary-drawer-layer").hasAttribute("aria-hidden"),
    focusRestored: document.activeElement?.classList.contains("boundary-link") ?? false,
  })`), { functionDrawer: true, parentHidden: false, focusRestored: true });
  await evaluate(cdp, `document.querySelector(".function-blocker-set-drawer .boundary-drawer-close").click()`);
  await waitFor(cdp, `document.querySelector(".boundary-drawer") === null`);

  await evaluate(cdp, `document.querySelector("#blocker-sets-view").click()`);
  assert.deepEqual(await currentView(cdp), {
    hash: "#view=blocker-sets",
    heading: "Function blocker sets",
    active: "Blocker sets",
  });
  const matrix = await evaluate(cdp, `({
    rows: document.querySelectorAll(".blocker-set-matrix tbody tr").length,
    memberships: document.querySelectorAll(".blocker-set-cell button").length,
    primary: document.querySelectorAll(".blocker-set-cell button.primary").length,
    reached: document.querySelectorAll(".blocker-set-cell button.reached").length,
    unmeasured: document.querySelectorAll(".blocker-set-matrix .size-impact.unmeasured").length,
    measured: document.querySelector(".blocker-set-matrix .size-impact.measured")?.textContent,
  })`);
  assert.deepEqual(matrix, {
    rows: 2,
    memberships: 2,
    primary: 1,
    reached: 1,
    unmeasured: 1,
    measured: "256 B raw / 32 B gzip",
  });
  await evaluate(cdp, `document.querySelector(".blocker-set-cell button.reached").click()`);
  await waitFor(cdp, `document.querySelector(".function-blocker-set-drawer") !== null`);
  const focusedSet = await evaluate(cdp, `({
    rows: document.querySelectorAll(".blocker-set-drawer-table tbody tr").length,
    focused: document.querySelectorAll(".blocker-set-drawer-table tr.focused-blocker-row").length,
    openPaths: document.querySelectorAll(".blocker-set-drawer-table details[open]").length,
  })`);
  assert.deepEqual(focusedSet, { rows: 2, focused: 1, openPaths: 1 });
  await evaluate(cdp, `document.querySelector(".function-blocker-set-drawer .boundary-drawer-close").click()`);
  await waitFor(cdp, `document.querySelector(".boundary-drawer") === null`);

  await evaluate(cdp, `document.querySelector("#externs-view").click()`);
  assert.deepEqual(await currentView(cdp), {
    hash: "#view=externs",
    heading: "Reached externs",
    active: "Externs",
  });
  const externState = await evaluate(cdp, `({
    badge: document.querySelector("#externs-view-count")?.textContent,
    status: document.querySelector(".extern-controls select")?.value,
    rows: document.querySelectorAll(".extern-results tbody tr").length,
  })`);
  assert.deepEqual(externState, { badge: "1/2", status: "missing", rows: 1 });
  const incompatibleExtern = await evaluate(cdp, `(() => {
    const select = document.querySelector(".extern-controls select");
    select.value = "incompatible";
    select.dispatchEvent(new Event("change"));
    document.querySelector(".extern-results .boundary-link").click();
    return {
      rows: document.querySelectorAll(".extern-results tbody tr").length,
      detail: document.querySelector(".boundary-drawer")?.textContent.replace(/\\s+/g, " ").trim(),
    };
  })()`);
  assert.equal(incompatibleExtern.rows, 1);
  assert.match(incompatibleExtern.detail, /Incompatible native ABI/);
  assert.match(incompatibleExtern.detail, /Target IR ABI.*@& object.*→ object/);
  assert.match(incompatibleExtern.detail, /VIR capability ABI.*object.*→ object/);
  await evaluate(cdp, `document.querySelector(".boundary-drawer-close").click()`);
  await waitFor(cdp, `document.querySelector(".boundary-drawer") === null`);
  await evaluate(cdp, `document.querySelector("#blockers-view").click()`);
  assert.deepEqual(await currentView(cdp), {
    hash: "#view=blockers",
    heading: "Complete blocker frontier",
    active: "All blockers",
  });
  const blockerState = await evaluate(cdp, `({
    familyCards: document.querySelectorAll(".blocker-family-card").length,
    mobileCards: document.querySelectorAll(".mobile-blocker-card").length,
    mobileDisplay: getComputedStyle(document.querySelector(".mobile-blocker-list")).display,
    tableDisplay: getComputedStyle(document.querySelector(".blocker-table-wrap > table")).display,
    humanKind: document.querySelector(".mobile-blocker-card dd:nth-of-type(2)")?.textContent,
  })`);
  assert.equal(blockerState.familyCards, 2);
  assert.equal(blockerState.mobileCards, 2);
  assert.equal(blockerState.mobileDisplay, "grid");
  assert.equal(blockerState.tableDisplay, "none");
  assert.equal(blockerState.humanKind, "Missing runtime extern");

  await evaluate(cdp, `document.querySelector(".mobile-blocker-card .boundary-link").click()`);
  await waitFor(cdp, `document.querySelector(".boundary-drawer") !== null`);
  const drawerState = await evaluate(cdp, `({
    hash: location.hash,
    heading: document.querySelector(".boundary-drawer h2")?.textContent,
    leanType: document.querySelector(".boundary-drawer .declaration-signature")?.textContent,
    leanDoc: document.querySelector(".boundary-drawer .declaration-docstring")?.textContent,
    family: document.querySelector(".boundary-drawer dd")?.textContent,
  })`);
  assert.deepEqual(drawerState, {
    hash: "#view=blockers",
    heading: "IO.monoNanosNow",
    leanType: "IO Nat",
    leanDoc: "Read the monotonic clock.",
    family: "IO / filesystem / process",
  });
  await evaluate(cdp, `document.querySelector(".boundary-drawer-close").click()`);
  await waitFor(cdp, `document.querySelector(".boundary-drawer") === null`);

  await evaluate(cdp, "history.back()");
  await waitFor(cdp, `location.hash === "#view=externs"`);
  assert.equal((await currentView(cdp)).active, "Externs");
  await evaluate(cdp, "history.back()");
  await waitFor(cdp, `location.hash === "#view=blocker-sets"`);
  assert.equal((await currentView(cdp)).active, "Blocker sets");
  await evaluate(cdp, "history.back()");
  await waitFor(cdp, `location.hash === ""`);
  assert.equal((await currentView(cdp)).active, "Target");

  await navigate(cdp, pathToFileURL(join(multiHtmlDir, "index.html")).href);
  await waitFor(cdp, `document.querySelector("main h2")?.textContent === "Selected function set"`);
  const targetSetOverview = await evaluate(cdp, `({
    active: document.querySelector(".report-view.selected span")?.textContent,
    progress: document.querySelector(".stat-card [role=progressbar]")?.getAttribute("aria-label"),
    ratio: document.querySelector(".stat-card .value")?.textContent,
  })`);
  assert.deepEqual(targetSetOverview, {
    active: "Target set",
    progress: "1 of 3 closure complete",
    ratio: "1 / 3 (33.3%)",
  });
  await evaluate(cdp, `document.querySelector("#blocker-sets-view").click()`);
  await waitFor(cdp, `document.querySelector(".blocker-set-matrix") !== null`);
  const multiMatrix = await evaluate(cdp, `({
    functions: document.querySelectorAll(".matrix-function-button").length,
    rows: document.querySelectorAll(".blocker-set-matrix tbody tr").length,
    memberships: document.querySelectorAll(".blocker-set-cell button").length,
    sharedByEvery: [...document.querySelectorAll(".stat-card")]
      .find((card) => card.textContent.includes("Shared by every blocked function"))
      ?.querySelector(".value")?.textContent,
  })`);
  assert.deepEqual(multiMatrix, { functions: 3, rows: 2, memberships: 3, sharedByEvery: "1" });
  await evaluate(cdp, `document.querySelectorAll(".matrix-function-button")[1].click()`);
  await waitFor(cdp, `document.querySelector(".function-blocker-set-drawer") !== null`);
  assert.equal(
    await evaluate(cdp, `document.querySelectorAll(".blocker-set-drawer-table tbody tr").length`),
    1,
  );

  cdp.close();
  console.log("surface report browser smoke ok: focused navigation, blocker-set matrix, drawers, and mobile cards");
} catch (error) {
  const details = chromium?.stderr() ?? "";
  if (details) console.error(details);
  throw error;
} finally {
  await chromium?.close();
  await rm(temporary, { recursive: true, force: true });
}

async function currentView(cdp) {
  return evaluate(cdp, `({
    hash: location.hash,
    heading: document.querySelector("main h2")?.textContent,
    active: document.querySelector(".report-view.selected span")?.textContent,
  })`);
}

async function waitFor(cdp, expression) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`timed out waiting for ${expression}`);
}

function focusedReportFixture() {
  const counts = surfaceCounts({
    total: 1, runnable: 0, blocked: 1, publicTotal: 1, publicRunnable: 0,
  });
  const blockers = [
    blocker("IO.monoNanosNow", "Init.System.IO", "lean_io_mono_nanos_now", 2),
    blocker("ByteArray.data", "Init.Prelude", "lean_sarray_to_array", 3, "incompatible"),
  ];
  return {
    format: "lean-vir-library-surface",
    version: 3,
    lean: { version: "4.32.0", toolchain: "leanprover/lean4:4.32.0", githash: "target" },
    capture: targetCaptureFixture({
      source: "Smoke/Target.lean",
      module: "Smoke.Target",
      supportRoots: ["Client.Native.call"],
      clientNativeExternManifest: {
        source: "lean-vir-native-externs.json",
        sha256: "b".repeat(64),
        externs: ["Client.Native.call"],
      },
    }),
    definition: surfaceDefinition(true),
    selectedModules: ["Smoke.Target"],
    selectedDeclarations: ["Smoke.Target.main"],
    loadedModules: 3,
    closure: { selectedRoots: 1, capturedNodes: 6, rootReachableNodes: 5, supportOnlyNodes: 1 },
    runtimeCapabilities: {
      lean: { version: "4.33.0", githash: "policy" },
      nativeExternCount: 2,
      primitiveNamespaces: ["ByteArray", "IO"],
      nativeExterns: [nativeExternFixture("ByteArray.data", {
        params: [{ index: 1, borrow: false, type: "object" }],
      }), nativeExternFixture("Client.Native.call", {
        generateBoxedWrapper: true,
      })],
    },
    counts,
    libraries: [{ name: "Smoke", modulesWithFunctions: 1, counts }],
    modules: [{ name: "Smoke.Target", counts }],
    primaryBlockers: [blockers[0].summary],
    reachableBlockers: blockers.map((entry) => entry.summary),
    externs: blockers.map((entry) => entry.extern),
    declarations: [{
      name: "Smoke.Target.main",
      module: "Smoke.Target",
      kind: "publicConstant",
      runnable: false,
      type: "IO UInt64",
      doc: "Compile the selected smoke target.",
      blocker: blockers[0].summary.blocker,
      blockerPath: blockers[0].summary.examplePath,
      blockers: blockers.map((entry) => ({
        blocker: entry.summary.blocker,
        path: entry.summary.examplePath,
      })),
    }],
  };
}

function multiFocusedReportFixture() {
  const report = focusedReportFixture();
  const secondaryName = "Smoke.Target.secondary";
  const readyName = "Smoke.Target.ready";
  const secondaryBlocker = report.reachableBlockers[1];
  const secondaryPath = [secondaryName, "Smoke.Target.step", secondaryBlocker.blocker.name];
  const counts = surfaceCounts({
    total: 3, runnable: 1, blocked: 2, publicTotal: 3, publicRunnable: 1,
  });
  report.selectedDeclarations.push(secondaryName, readyName);
  report.counts = counts;
  report.libraries[0].counts = counts;
  report.modules[0].counts = counts;
  report.closure = { selectedRoots: 3, capturedNodes: 9, rootReachableNodes: 8, supportOnlyNodes: 1 };
  report.primaryBlockers.push({
    ...secondaryBlocker,
    exampleRoot: secondaryName,
    examplePath: secondaryPath,
  });
  report.reachableBlockers[1] = {
    ...secondaryBlocker,
    roots: 2,
    publicRoots: 2,
  };
  report.declarations.push({
    name: secondaryName,
    module: "Smoke.Target",
    kind: "publicConstant",
    runnable: false,
    type: "IO Unit",
    doc: "Compile the secondary smoke target.",
    blocker: secondaryBlocker.blocker,
    blockerPath: secondaryPath,
    blockers: [{ blocker: secondaryBlocker.blocker, path: secondaryPath }],
  });
  report.declarations.push({
    name: readyName,
    module: "Smoke.Target",
    kind: "publicConstant",
    runnable: true,
    type: "IO Unit",
    doc: "Run the closure-complete smoke target.",
    blocker: null,
    blockerPath: [],
    blockers: [],
  });
  return report;
}

function frontierCostFixture() {
  return {
    format: "lean-vir-frontier-size-costs",
    version: 1,
    generatedAt: "2026-08-11T00:00:00.000Z",
    baseline: { rawBytes: 1000, gzipBytes: 500, sha256: "baseline" },
    candidates: [{
      id: "io-clock",
      names: ["IO.monoNanosNow"],
      rawDeltaBytes: 256,
      gzipDeltaBytes: 32,
      primaryRoots: 1,
      primaryPublicRoots: 1,
    }],
  };
}

function blocker(name, module, target, steps, status = "missing") {
  const path = ["Smoke.Target.main"];
  for (let index = 1; index < steps; index += 1) path.push(`Smoke.Target.step${index}`);
  path.push(name);
  return {
    summary: {
      blocker: { kind: status === "incompatible" ? "incompatibleExtern" : "missingExtern", name },
      roots: 1,
      publicRoots: 1,
      exampleRoot: "Smoke.Target.main",
      examplePath: path,
    },
    extern: {
      name,
      module,
      status,
      targets: [{ kind: "standard", backend: "all", value: target }],
      ...(status === "incompatible" ? {
        targetAbi: {
          params: [{ borrow: true, type: "object" }],
          resultType: "object",
        },
        capabilityAbi: {
          params: [{ borrow: false, type: "object" }],
          resultType: "object",
        },
      } : {}),
      type: name === "IO.monoNanosNow" ? "IO Nat" : "ByteArray → Array UInt8",
      doc: name === "IO.monoNanosNow"
        ? "Read the monotonic clock."
        : "Expose the backing byte array.",
    },
  };
}
