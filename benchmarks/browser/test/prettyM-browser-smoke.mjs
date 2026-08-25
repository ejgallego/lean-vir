import assert from "node:assert/strict";

import {
  collectPageErrors,
  launchBenchmarkBrowser,
  startBenchmarkServer,
} from "./harness.mjs";

const port = Number(process.env.BENCH_PORT ?? "18334");
const server = await startBenchmarkServer({ port });
const url = server.origin;
let browser = null;

try {
  browser = await launchBenchmarkBrowser();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors = collectPageErrors(page);
  const smokeManifest = {
    schemaVersion: 2,
    kind: "browser-benchmarks/artifact-set",
    example: { id: "prettyM", variant: "default" },
    setId: "browser-smoke-without-test-package",
  };
  await page.route("**/artifacts/prettyM/ARTIFACT_SET.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(smokeManifest),
    }),
  );
  await page.goto(url, { waitUntil: "networkidle" });
  assert.deepEqual(await page.evaluate(() => window.__benchmarkApp.ready), {
    example: null,
    readyCount: 0,
    backendCount: 0,
  });
  assert.equal(
    await page.evaluate(() => window.__benchmarkApp.activeExample),
    null,
  );
  assert.equal(await page.locator("[data-example-content]:visible").count(), 0);
  assert.equal(await page.locator("#example-nav a").count(), 3);
  assert.equal(
    await page.locator('#example-nav [aria-current="page"]').count(),
    0,
  );
  await page.locator('#example-nav [data-example="prettyM"]').click();
  await page.waitForLoadState("networkidle");
  assert.deepEqual(await page.evaluate(() => window.__benchmarkApp.ready), {
    example: "prettyM",
    readyCount: 5,
    backendCount: 5,
  });
  assert.deepEqual(await page.evaluate(() => window.__benchmarkApp.examples), [
    { id: "illuminate", label: "Illuminate player" },
    { id: "lean-zip", label: "lean-zip raw DEFLATE" },
    { id: "prettyM", label: "Std.Format.prettyM" },
  ]);
  assert.equal(
    await page
      .locator('#example-nav [data-example="prettyM"]')
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.locator("#variant-picker").isVisible(), true);
  assert.equal(await page.locator("#variant-select").inputValue(), "default");
  assert.equal(
    await page.evaluate(
      () => window.__benchmarkExampleContext.artifactBaseUrl.href,
    ),
    `${url}/artifacts/prettyM/`,
  );
  assert.equal(
    await page.evaluate(() => window.__prettyBenchArtifactBase),
    `${url}/artifacts/prettyM/`,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.__benchmarkApp.getVariants().map(({ id, title, build }) => ({
        id,
        title,
        build,
      })),
    ),
    [
      {
        id: "default",
        title: "Compact Format to styled segments",
        build: "prettyM",
      },
    ],
  );
  const readiness = await page.evaluate(() => window.__prettyBenchApp.ready);
  assert.deepEqual(readiness, { readyCount: 5, backendCount: 5 });
  const artifactStatus = await page.evaluate(() =>
    window.__benchmarkApp.getArtifactStatus(),
  );
  assert.equal(artifactStatus.verified, false);
  assert.equal(artifactStatus.tone, "unverified");
  assert.equal(artifactStatus.setId, null);
  assert.match(artifactStatus.error, /test package/);
  assert.equal(
    await page.locator("#artifact-status").getAttribute("data-verified"),
    "false",
  );
  assert.equal(await page.evaluate(() => typeof window.Reveal), "undefined");
  assert.deepEqual(
    await page.evaluate(() => ({
      corpus: typeof window.runPrettyDifferentialCorpus,
      scaling: typeof window.runPrettyScalingStudy,
      memoryPoint: typeof window.runPrettyMemoryScalingPoint,
      interactions: typeof window.runPrettyInteractionStudy,
      repeated: typeof window.runPrettyRepeatedCallStudy,
      jsonRoundTrip: typeof window.runJsonRoundTripStudy,
    })),
    {
      corpus: "function",
      scaling: "function",
      memoryPoint: "function",
      interactions: "function",
      repeated: "function",
      jsonRoundTrip: "undefined",
    },
  );
  const backends = await page.evaluate(() =>
    window.__prettyBenchApp.getBackends(),
  );
  assert.deepEqual(
    backends.map((backend) => backend.id),
    ["js", "vir", "vir-format", "native", "llvm"],
  );
  assert.ok(
    backends.every((backend) => backend.status === "ready"),
    backends,
  );
  await page.locator('button[data-study="smoke"]').click();
  await page.waitForFunction(
    () => document.querySelector("#app-state")?.textContent === "Complete",
  );
  const report = await page.evaluate(
    () => window.__prettyBenchApp.getReports().differential,
  );
  assert.equal(report.passed, true);
  assert.equal(report.parityCount, 1);
  assert.equal(report.scenarioCount, 1);
  assert.deepEqual(report.runtimeProfile.artifactSet.manifest, smokeManifest);
  assert.ok(report.runtimeProfile.backends.js.assetBytes > 0);
  for (const profile of Object.values(report.runtimeProfile.backends)) {
    for (const asset of profile.assets) {
      assert.equal(Object.hasOwn(asset, "url"), false);
      assert.equal(typeof asset.path, "string");
    }
  }
  assert.equal(await page.locator(".report-card").count(), 1);
  assert.equal(await page.locator("#open-dashboard").isEnabled(), true);
  await page.locator("#open-dashboard").click();
  await page.locator(".benchmark-report-overlay").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".benchmark-report-overlay h2").textContent(),
    "Corpus · smoke-parity",
  );
  const dashboardFilters = page.locator(
    ".benchmark-report-overlay input[data-backend-filter]",
  );
  assert.equal(await dashboardFilters.count(), 5);
  for (const id of ["js", "vir", "vir-format", "llvm"]) {
    await page
      .locator(`.benchmark-report-overlay input[data-backend-filter="${id}"]`)
      .uncheck();
  }
  assert.equal(
    await page
      .locator(".benchmark-report-overlay .benchmark-backend-filter-summary")
      .textContent(),
    "1 of 5 selected",
  );
  assert.equal(
    await page
      .locator('.benchmark-report-chart rect[data-benchmark-backend="native"]')
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator('.benchmark-report-chart rect[data-benchmark-backend="js"]')
      .count(),
    0,
  );
  await page
    .locator(".benchmark-report-overlay header button", { hasText: "Close" })
    .click();
  await page.locator(".report-card button", { hasText: "View report" }).click();
  await page.locator(".pretty-corpus-overlay").waitFor({ state: "visible" });
  assert.equal(
    await page
      .locator('.pretty-corpus-overlay input[data-backend-filter="native"]')
      .isChecked(),
    true,
  );
  assert.equal(
    await page
      .locator('.pretty-corpus-overlay input[data-backend-filter="js"]')
      .isChecked(),
    true,
  );
  await page
    .locator('.pretty-corpus-overlay input[data-backend-filter="js"]')
    .uncheck();
  assert.equal(
    await page.locator('tr[data-pretty-backend="native"]:visible').count(),
    2,
  );
  assert.equal(
    await page.locator('tr[data-pretty-backend="js"]:visible').count(),
    0,
  );
  await page
    .locator(".pretty-corpus-overlay .benchmark-backend-filter-actions button")
    .click();
  assert.equal(
    await page
      .locator(".pretty-corpus-overlay .benchmark-backend-filter-summary")
      .textContent(),
    "5 of 5 selected",
  );
  await page
    .locator(".pretty-corpus-overlay header button", { hasText: "Close" })
    .click();
  await page.locator("#repeat-cycles").fill("1");
  await page.locator('button[data-study="repeated"]').click();
  await page.waitForFunction(
    () => document.querySelector("#app-state")?.textContent === "Complete",
  );
  await page.locator("#open-dashboard").click();
  const repeated = page.locator(".benchmark-report-overlay");
  await repeated.waitFor({ state: "visible" });
  assert.equal(await repeated.locator("h2").textContent(), "Repeated calls");
  await repeated
    .locator(".benchmark-backend-filter-actions button", {
      hasText: "Show all",
    })
    .click();
  assert.equal(await repeated.locator("tbody tr").count(), 5);
  assert.equal(
    await repeated.locator(".benchmark-report-chart rect").count(),
    5,
  );
  await repeated.locator("header button", { hasText: "Close" }).click();
  await page.locator("#clear-results").click();
  assert.equal(await page.locator("#open-dashboard").isDisabled(), true);
  assert.equal(await page.locator(".report-card").count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log("PASS standalone five-backend prettyM benchmark webapp smoke");
} finally {
  await Promise.all([browser?.close(), server.close()]);
}
