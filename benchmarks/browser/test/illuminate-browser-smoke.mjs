import assert from "node:assert/strict";
import { join } from "node:path";

import { readBuildDatabase } from "../scripts/artifact-build-lib.mjs";
import { appRoot } from "../scripts/package-root.mjs";
import {
  collectPageErrors,
  launchBenchmarkBrowser,
  startBenchmarkServer,
} from "./harness.mjs";

const database = await readBuildDatabase(join(appRoot, "artifact-builds.json"));
const expectedSetId = database.builds.illuminate.artifactSet.setId;
const port = Number(
  process.env.BENCH_PORT ?? String(21000 + (process.pid % 1000)),
);
const server = await startBenchmarkServer({
  port,
  label: "Illuminate browser smoke server",
});
const url = `${server.origin}/?example=illuminate`;
let browser = null;

try {
  browser = await launchBenchmarkBrowser();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(120_000);
  const pageErrors = collectPageErrors(page);
  const requestedPaths = new Set();
  let artifactManifestRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    requestedPaths.add(path);
    if (path.endsWith("/artifacts/illuminate/ARTIFACT_SET.json")) {
      artifactManifestRequests += 1;
    }
  });
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
      return {
        verified: status.verified,
        tone: status.tone,
        setId: status.setId,
      };
    }),
    {
      verified: true,
      tone: "verified",
      setId: expectedSetId,
    },
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
  assert.equal(backends[2].label, "Lean · FIR selection");
  assert.ok(
    requestedPaths.has("/artifacts/illuminate/workload/js-player-trace.mjs"),
  );
  assert.equal(artifactManifestRequests, 1);
  const buildNotes = await page.locator("#build-notes").textContent();
  assert.ok(buildNotes.includes(`Artifact set ${expectedSetId}`));
  assert.match(buildNotes, /illuminate\/browser-benchmark-source\/v1/);
  assert.match(buildNotes, /Illuminate\.Animation\.Vir\.replayTraceTyped/);
  assert.match(buildNotes, /fir\.illuminate-player\.complete-runtime\/v2/);
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
  console.log("PASS canonical Illuminate JS/VIR/FIR plotting smoke");
} finally {
  await Promise.all([browser?.close(), server.close()]);
}
