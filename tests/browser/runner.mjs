/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  assertDistReady,
  fetchJsonWithRetry,
  launchChromium,
  openCdp,
  serveDist,
} from "./harness.mjs";
import { browserRunnerCaseSpecs, browserRunnerFailureSpecs } from "./cases.mjs";
import { smokeBrowserCallbackCleanup, smokeBrowserCallbacks } from "./callbacks.mjs";
import {
  prepareNegativePackages,
  runnerCaseFromManifest,
  smokeManifestDrivenEntryList,
  smokeRunner,
  smokeRunnerFailure,
} from "./dev-runner.mjs";
import {
  smokeFormatWorkbench,
  smokeLanding,
  smokePackagePreset,
  smokeRuntimeDemo,
  smokeRuntimeExample,
  smokeSurfaceExplorer,
  smokeWasmSizeExplorer,
} from "./page-suites.mjs";
import { smokeBrowserReactLifetimes } from "./react-lifetimes.mjs";
import { smokeReactTamagotchi } from "./react-tamagotchi.mjs";
import { packageFiles } from "../../scripts/browser-package-config.mjs";

await assertDistReady();
await prepareNegativePackages();

const server = await serveDist();
let chromium = null;

try {
  chromium = await launchChromium();
  const targets = await fetchJsonWithRetry(
    `http://127.0.0.1:${chromium.debugPort}/json/list`,
    chromium.child,
    (candidates) => Array.isArray(candidates) && candidates.some((target) =>
      target.type === "page" && target.webSocketDebuggerUrl),
  );
  const pageTarget = targets.find((target) => target.type === "page");
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Chromium did not expose a page DevTools target");
  const cdp = await openCdp(pageTarget.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  await smokeLanding(cdp, server.origin);
  await smokeRuntimeExample(cdp, server.origin);
  await smokeRuntimeDemo(cdp, server.origin);
  await smokePackagePreset(cdp, server.origin);
  await smokeFormatWorkbench(cdp, server.origin);
  await smokeSurfaceExplorer(cdp, server.origin);
  await smokeWasmSizeExplorer(cdp, server.origin);
  await smokeReactTamagotchi(cdp, server.origin);
  await smokeBrowserReactLifetimes(cdp);
  for (const packageFile of packageFiles) {
    await smokeManifestDrivenEntryList(cdp, server.origin, packageFile);
  }
  await smokeBrowserCallbacks(cdp, server.origin);
  await smokeBrowserCallbackCleanup(cdp, server.origin);

  const runnerCases = await Promise.all(
    browserRunnerCaseSpecs.map(({ packageFile, entryName, expected }) =>
      runnerCaseFromManifest(packageFile, entryName, expected)),
  );

  for (const { url, expected } of runnerCases) {
    await smokeRunner(cdp, server.origin, url, expected);
  }
  for (const { url, expected } of browserRunnerFailureSpecs) {
    await smokeRunnerFailure(cdp, server.origin, url, expected);
  }

  cdp.close();
  console.log("pages browser smoke ok: landing, minimal runtime example, runtime diagnostics, React Tamagotchi, React proof goal transitions, React DOM ref lifetime, React Strict Mode and abandoned-render lifetimes, format workbench, runnable-surface navigation, Wasm size explorer, package presets, manifest-driven entry list, browser callbacks, browser callback cleanup, React rerender cleanup, React input callback, React change callback, React checkbox callback, local runners, host-call runner, manifest enum runner, manifest Expr runner, manifest JSON runner, recursive inductive runner, recursive structure runner, mixed inductive runner, and failure paths");
} catch (error) {
  const details = chromium?.stderr() ?? "";
  if (details) {
    console.error(details);
  }
  console.error("browser smoke failed");
  throw error;
} finally {
  try {
    await chromium?.close();
  } finally {
    await server.close();
  }
}
