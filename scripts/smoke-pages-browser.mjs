/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  assertDistReady,
  fetchJsonWithRetry,
  freePort,
  launchChromium,
  openCdp,
  serveDist,
} from "./browser-smoke-harness.mjs";
import { browserRunnerCaseSpecs, browserRunnerFailureSpecs } from "./browser-smoke-cases.mjs";
import { smokeBrowserCallbackCleanup, smokeBrowserCallbacks } from "./browser-smoke-callbacks.mjs";
import {
  prepareNegativePackages,
  runnerCaseFromManifest,
  smokeManifestDrivenEntryList,
  smokeRunner,
  smokeRunnerFailure,
} from "./browser-smoke-dev-runner.mjs";
import { smokeFormatWorkbench, smokeLanding, smokePackagePreset } from "./browser-smoke-page-suites.mjs";
import { smokeReactReview } from "./browser-smoke-react-review.mjs";
import { packageFiles } from "./browser-package-config.mjs";

await assertDistReady();
await prepareNegativePackages();

const server = await serveDist();
const debugPort = await freePort();
const chromium = await launchChromium(debugPort);

try {
  const targets = await fetchJsonWithRetry(`http://127.0.0.1:${debugPort}/json/list`, chromium.child);
  const pageTarget = targets.find((target) => target.type === "page");
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Chromium did not expose a page DevTools target");
  const cdp = await openCdp(pageTarget.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  await smokeLanding(cdp, server.origin);
  await smokePackagePreset(cdp, server.origin);
  await smokeFormatWorkbench(cdp, server.origin);
  await smokeReactReview(cdp, server.origin);
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
  console.log("pages browser smoke ok: landing, React review, format workbench, package presets, manifest-driven entry list, browser callbacks, browser callback cleanup, React rerender cleanup, React input callback, React change callback, React checkbox callback, local runners, host-call runner, manifest enum runner, manifest Expr runner, manifest JSON runner, recursive inductive runner, recursive structure runner, mixed inductive runner, and failure paths");
} catch (error) {
  const details = chromium.stderr();
  if (details) {
    console.error(details);
  }
  console.error("browser smoke failed; if web/dist was not built from the current checkout, run npm run build:site first");
  throw error;
} finally {
  await chromium.close();
  await server.close();
}
