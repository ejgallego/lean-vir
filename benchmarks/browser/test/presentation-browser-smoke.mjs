import assert from "node:assert/strict";

import {
  collectPageErrors,
  launchBenchmarkBrowser,
  startBenchmarkServer,
} from "./harness.mjs";

const port = Number(process.env.BENCH_PRESENTATION_PORT ?? "18337");
const server = await startBenchmarkServer({
  port,
  label: "presentation server",
});
let browser = null;

try {
  browser = await launchBenchmarkBrowser();
  const page = await browser.newPage();
  const pageErrors = collectPageErrors(page);
  await page.goto(server.origin, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { createReportPresentation } = await import(
      new URL("src/presentation.js", location.href).href
    );
    const button = document.createElement("button");
    button.id = "presentation-smoke-open";
    button.type = "button";
    button.textContent = "Open synthetic report";
    document.body.appendChild(button);
    const presentation = createReportPresentation({
      example: { id: "synthetic", title: "Synthetic benchmark" },
      openButton: button,
    });
    const backends = ["js", "vir", "vir-format", "native", "llvm"].map(
      (id) => ({ id, label: id }),
    );
    presentation.record(
      {
        kind: "synthetic-scaling",
        passed: true,
        backendIds: backends.map(({ id }) => id),
        scenarios: Array.from({ length: 10 }, (_, groupIndex) => ({
          caseId: `group-${groupIndex}`,
          label: `Group ${groupIndex}`,
          parity: true,
          backends: Object.fromEntries(
            backends.map(({ id }, backendIndex) => [
              id,
              {
                errors: [],
                summary: {
                  totalMs: { median: (groupIndex + 1) * (backendIndex + 1) },
                },
              },
            ]),
          ),
        })),
      },
      backends,
    );
    globalThis.__presentationSmoke = { button, presentation };
  });

  await page.locator("#presentation-smoke-open").click();
  let report = page.locator(".benchmark-report-overlay");
  await report.waitFor({ state: "visible" });
  assert.equal(
    await report.locator(".benchmark-report-chart rect").count(),
    35,
  );
  assert.equal(await report.locator("tbody tr").count(), 50);
  assert.match(
    await report.locator("figcaption").textContent(),
    /7 of 10 complete workload groups/,
  );
  await report.locator("header button", { hasText: "Close" }).click();

  await page.evaluate(() => {
    globalThis.__presentationSmoke.presentation.record(
      {
        kind: "memory-retained",
        passed: true,
        backendIds: ["native"],
        points: [
          {
            dimension: "depth",
            dimensionLabel: "Document depth",
            caseId: "signed",
            label: "Signed growth",
            size: 1,
            sizeLabel: "one call",
            parity: true,
            backends: {
              native: {
                errors: [],
                retainedResidentGrowthBytes: -64,
              },
            },
          },
        ],
      },
      [{ id: "native", label: "Native" }],
    );
  });
  await page.locator("#presentation-smoke-open").click();
  report = page.locator(".benchmark-report-overlay");
  await report.waitFor({ state: "visible" });
  assert.equal(
    await report.locator(".benchmark-report-chart-empty").textContent(),
    "Signed values are shown in the table",
  );
  assert.match(
    await report.locator("figcaption").textContent(),
    /one-sided bar would hide the sign/,
  );
  assert.equal(
    await report.locator("tbody tr td").nth(1).textContent(),
    "-64 B",
  );
  await report.locator("header button", { hasText: "Close" }).click();

  await page.evaluate(() => {
    globalThis.__presentationSmoke.presentation.reset();
    globalThis.__presentationSmoke.button.remove();
    delete globalThis.__presentationSmoke;
  });
  assert.deepEqual(pageErrors, []);
  console.log("PASS shared benchmark presentation browser smoke");
} finally {
  await Promise.all([browser?.close(), server.close()]);
}
