import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const port = Number(process.env.BENCH_PORT ?? "18448");
const url = `http://127.0.0.1:${port}/illuminate.html`;
const configuredChrome = process.env.CHROMIUM ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(configuredChrome) ? configuredChrome : undefined,
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(120_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(url, { waitUntil: "networkidle" });
  const readiness = await page.evaluate(
    () => window.__illuminateBenchApp.ready,
  );
  assert.deepEqual(readiness, { readyCount: 3, backendCount: 3 });
  assert.deepEqual(
    await page.evaluate(() => window.__illuminateBenchApp.getBackends()),
    [
      { id: "js", label: "JavaScript oracle", status: "ready" },
      { id: "vir", label: "Lean · VIR typed", status: "ready" },
      { id: "native", label: "Lean · FIR native", status: "ready" },
    ],
  );
  const buildNotes = await page.locator("#build-notes").textContent();
  assert.match(buildNotes, /Illuminate 22f0cc61 \+ local changes/);
  assert.match(buildNotes, /VIR c3953b24/);
  assert.match(buildNotes, /FIR b72f2bfa/);
  assert.match(buildNotes, /fir\.illuminate-player\.browser\/v3/);
  await page.locator("#warmup").fill("0");
  await page.locator("#samples").fill("1");
  const report = await page.evaluate(() =>
    window.__illuminateBenchApp.runStudy("quick"),
  );
  assert.equal(report.workload.id, "illuminate-player");
  assert.equal(report.passed, false);
  assert.equal(report.parityCount, 3);
  assert.equal(report.scenarioCount, 6);
  assert.equal(report.mismatches.length, 3);
  assert.ok(
    report.mismatches.every((mismatch) => mismatch.workloadId === "small"),
  );
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
  assert.equal(report.provenance.rehearsal.publishable, false);
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
  await browser.close();
}
