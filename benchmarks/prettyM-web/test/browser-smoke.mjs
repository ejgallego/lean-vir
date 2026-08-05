import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.BENCH_PORT ?? "18334");
const url = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [join(appRoot, "scripts/serve.mjs"), "--port", String(port)],
  {
    cwd: appRoot,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null)
      throw new Error(`server exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("benchmark server did not become ready");
}

try {
  await waitForServer();
  const configuredChrome = process.env.CHROMIUM ?? "/usr/bin/google-chrome";
  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(configuredChrome) ? configuredChrome : undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(url, { waitUntil: "networkidle" });
  const readiness = await page.evaluate(() => window.__prettyBenchApp.ready);
  assert.deepEqual(readiness, { readyCount: 5, backendCount: 5 });
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
  const report = await page.evaluate(() =>
    window.__prettyBenchApp.runStudy("smoke"),
  );
  assert.equal(report.passed, true);
  assert.equal(report.parityCount, 1);
  assert.equal(report.scenarioCount, 1);
  assert.equal(await page.locator(".report-card").count(), 1);
  assert.equal(await page.locator("#open-dashboard").isEnabled(), true);
  await page.locator("#open-dashboard").click();
  await page.locator(".pretty-dashboard-overlay").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".pretty-dashboard-overlay h2").textContent(),
    "Pretty-printer benchmark results",
  );
  await page
    .locator(".pretty-dashboard-overlay header button", { hasText: "Close" })
    .click();
  assert.deepEqual(pageErrors, []);
  await browser.close();
  console.log("PASS standalone five-backend prettyM benchmark webapp smoke");
} finally {
  server.kill("SIGTERM");
}
