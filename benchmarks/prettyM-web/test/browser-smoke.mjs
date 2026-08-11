import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const hasVerifiedPrettyM = existsSync(
  join(appRoot, "artifacts/prettyM/ARTIFACT_SET.json"),
);
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
  let startupOutput = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("benchmark server did not announce readiness")),
      5_000,
    );
    const finish = (callback) => {
      clearTimeout(timeout);
      callback();
    };
    server.stdout.on("data", (chunk) => {
      startupOutput += chunk;
      if (startupOutput.includes(`at ${url}`)) finish(resolve);
    });
    server.stderr.on("data", (chunk) => {
      startupOutput += chunk;
    });
    server.once("exit", (code) =>
      finish(() =>
        reject(
          new Error(
            `benchmark server exited with ${code} before readiness\n${startupOutput}`,
          ),
        ),
      ),
    );
  });

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
  assert.equal(await page.locator("#example-nav a").count(), 2);
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
    { id: "prettyM", label: "Std.Format.prettyM" },
    { id: "illuminate", label: "Illuminate player" },
  ]);
  assert.equal(
    await page
      .locator('#example-nav [data-example="prettyM"]')
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.locator("#variant-picker").isVisible(), true);
  assert.equal(await page.locator("#variant-select").inputValue(), "default");
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
  assert.equal(artifactStatus.verified, hasVerifiedPrettyM);
  assert.equal(
    await page.locator("#artifact-status").getAttribute("data-verified"),
    String(hasVerifiedPrettyM),
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
  const report = await page.evaluate(() =>
    window.__prettyBenchApp.runStudy("smoke"),
  );
  assert.equal(report.passed, true);
  assert.equal(report.parityCount, 1);
  assert.equal(report.scenarioCount, 1);
  if (hasVerifiedPrettyM) {
    assert.equal(artifactStatus.setId, "prettyM-bounded-set-0002");
    assert.equal(
      report.runtimeProfile.artifactSet.manifest.setId,
      "prettyM-bounded-set-0002",
    );
    assert.equal(
      report.runtimeProfile.artifactSet.manifest.components.vir.runtime
        .sourceCommit,
      "64e30784da16957cca92951344d776f895b30491",
    );
  } else {
    assert.equal(artifactStatus.tone, "unverified");
    assert.equal(artifactStatus.setId, null);
    assert.match(report.runtimeProfile.artifactSet.manifest.error, /HTTP 404/);
  }
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
  await page.locator(".pretty-dashboard-overlay").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".pretty-dashboard-overlay h2").textContent(),
    "Pretty-printer benchmark results",
  );
  const dashboardFilters = page.locator(
    ".pretty-dashboard-overlay input[data-backend-filter]",
  );
  assert.equal(await dashboardFilters.count(), 5);
  for (const id of ["js", "vir", "vir-format", "llvm"]) {
    await page
      .locator(`.pretty-dashboard-overlay input[data-backend-filter="${id}"]`)
      .uncheck();
  }
  assert.equal(
    await page
      .locator(".pretty-dashboard-overlay .pretty-backend-filter-summary")
      .textContent(),
    "1 of 5 selected",
  );
  assert.equal(
    await page
      .locator('.pretty-dashboard-overview-chart rect[fill="#d879c6"]')
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator('.pretty-dashboard-overview-chart rect[fill="#74a9ff"]')
      .count(),
    0,
  );
  await page
    .locator(".pretty-dashboard-overlay header button", { hasText: "Close" })
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
    false,
  );
  assert.equal(
    await page.locator('tr[data-pretty-backend="native"]:visible').count(),
    2,
  );
  assert.equal(
    await page.locator('tr[data-pretty-backend="js"]:visible').count(),
    0,
  );
  await page
    .locator(".pretty-corpus-overlay .pretty-backend-filter-actions button")
    .click();
  assert.equal(
    await page
      .locator(".pretty-corpus-overlay .pretty-backend-filter-summary")
      .textContent(),
    "5 of 5 selected",
  );
  await page
    .locator(".pretty-corpus-overlay header button", { hasText: "Close" })
    .click();
  assert.deepEqual(pageErrors, []);
  await browser.close();
  console.log("PASS standalone five-backend prettyM benchmark webapp smoke");
} finally {
  server.kill("SIGTERM");
}
