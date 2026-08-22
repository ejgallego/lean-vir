import assert from "node:assert/strict";

import {
  collectPageErrors,
  launchBenchmarkBrowser,
  startBenchmarkServer,
} from "./harness.mjs";

const port = Number(process.env.BENCH_PORT ?? "18448");
const url = `http://127.0.0.1:${port}/?example=illuminate`;

let server = null;
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`server returned ${response.status}`);
} catch {
  server = await startBenchmarkServer({ port });
}
let browser = null;

try {
  browser = await launchBenchmarkBrowser();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(120_000);
  const pageErrors = collectPageErrors(page);
  await page.goto(url, { waitUntil: "networkidle" });
  assert.deepEqual(await page.evaluate(() => window.__benchmarkApp.ready), {
    example: "illuminate",
    readyCount: 3,
    backendCount: 3,
  });
  assert.equal(
    await page
      .locator('#example-nav [data-example="illuminate"]')
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.locator("#variant-picker").isVisible(), true);
  assert.equal(await page.locator("#variant-select").inputValue(), "default");
  assert.equal(
    await page.evaluate(
      () => window.__benchmarkExampleContext.artifactBaseUrl.href,
    ),
    `http://127.0.0.1:${port}/artifacts/illuminate/`,
  );
  assert.equal(
    await page.locator("#variant-select option:checked").textContent(),
    "Player trace replay",
  );
  const readiness = await page.evaluate(
    () => window.__illuminateBenchApp.ready,
  );
  assert.deepEqual(readiness, { readyCount: 3, backendCount: 3 });
  assert.deepEqual(
    await page.evaluate(() => {
      const status = window.__benchmarkApp.getArtifactStatus();
      return { verified: status.verified, tone: status.tone, setId: status.setId };
    }),
    { verified: false, tone: "rehearsal", setId: null },
  );
  const backends = await page.evaluate(() =>
    window.__illuminateBenchApp.getBackends(),
  );
  assert.deepEqual(
    backends.map(({ id, status }) => ({ id, status })),
    [
      { id: "js", status: "ready" },
      { id: "vir", status: "ready" },
      { id: "native", status: "ready" },
    ],
  );
  assert.equal(backends[0].label, "JavaScript oracle");
  assert.equal(backends[1].label, "Lean · VIR typed");
  assert.ok(
    ["Lean · FIR native", "Lean · FIR selection"].includes(backends[2].label),
  );
  const usesSelection = backends[2].label === "Lean · FIR selection";
  const buildNotes = await page.locator("#build-notes").textContent();
  assert.match(buildNotes, /Illuminate [0-9a-f]{8}/);
  assert.match(buildNotes, /VIR [0-9a-f]{8}/);
  assert.match(buildNotes, /FIR(?: selection)? [0-9a-f]{8}/);
  assert.match(
    buildNotes,
    usesSelection
      ? /fir\.illuminate-player\.browser\/v4/
      : /fir\.illuminate-player\.browser\/v3/,
  );
  await page.locator("#warmup").fill("0");
  await page.locator("#samples").fill("1");
  const report = await page.evaluate(() =>
    window.__illuminateBenchApp.runStudy("quick"),
  );
  assert.equal(report.workload.id, "illuminate-player");
  assert.equal(report.passed, true);
  assert.equal(report.parityCount, 6);
  assert.equal(report.scenarioCount, 6);
  assert.deepEqual(report.mismatches, []);
  assert.ok(
    report.dimensions
      .find((dimension) => dimension.id === "parameter-heavy")
      .points.every((point) => point.parity),
  );
  assert.deepEqual(report.backendIds, ["js", "vir", "native"]);
  assert.deepEqual(
    report.timingPhases.map((phase) => phase.id),
    ["totalMs", "prepareMs", "executeMs", "decodeMs"],
  );
  assert.equal(report.provenance.acceptedMeasurement, false);
  assert.equal(await page.locator(".result-actions button").count(), 4);
  assert.equal(await page.locator("#download-results").isEnabled(), true);
  assert.equal(await page.locator("#clear-results").isEnabled(), true);
  assert.equal(await page.locator(".pretty-scaling-overlay").count(), 0);
  await page.locator("#open-dashboard").click();
  await page.locator(".pretty-scaling-overlay").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".pretty-scaling-overlay h2").textContent(),
    "Illuminate player trace scaling report",
  );
  assert.equal(
    await page
      .locator(".pretty-scaling-overlay input[data-backend-filter]")
      .count(),
    3,
  );
  assert.equal(
    await page.locator(".pretty-scaling-table th").first().textContent(),
    "Events",
  );
  assert.equal(
    await page.locator(".pretty-scaling-phase").inputValue(),
    "totalMs",
  );
  assert.deepEqual(pageErrors, []);
  console.log("PASS Illuminate JS/VIR/FIR plotting rehearsal smoke");
} finally {
  await browser?.close();
  server?.close();
}
