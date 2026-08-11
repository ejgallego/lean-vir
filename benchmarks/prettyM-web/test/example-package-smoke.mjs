import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import {
  discoverExampleCatalog,
  readExampleTestPackage,
} from "../scripts/example-catalog-lib.mjs";
import { canonicalJson, inside } from "../scripts/artifact-set-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}
const output = takeOption("--output");
const directory = resolve(appRoot, takeOption("--directory") ?? "dist");
const requestedBasePath = takeOption("--base-path") ?? "/";
const basePath =
  `/${requestedBasePath.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const staticHostIndex = args.indexOf("--static-host");
const staticHost = staticHostIndex !== -1;
if (staticHost) args.splice(staticHostIndex, 1);
const [exampleId, requestedVariant = "default", extra] = args;
if (
  !exampleId ||
  extra ||
  process.argv.includes("--help") ||
  process.argv.includes("-h")
) {
  console.log(`Usage: node test/example-package-smoke.mjs [OPTIONS] EXAMPLE [VARIANT]

Run every differential test declared by one self-contained example variant.

Options:
  --output PATH       Write the test report
  --directory PATH    Serve this build directory
  --base-path PATH    Open the application below this URL path
  --static-host       Omit server isolation headers and test the SW fallback`);
  process.exit(exampleId ? 0 : 1);
}

const catalog = await discoverExampleCatalog(appRoot);
const example = catalog.examples.find((candidate) => candidate.id === exampleId);
if (!example) throw new Error(`unknown example ${exampleId}`);
const testPackage = await readExampleTestPackage(appRoot, example);
const variant = testPackage.variants.find(
  (candidate) => candidate.id === requestedVariant,
);
if (!variant) {
  throw new Error(`example ${exampleId} has no variant ${requestedVariant}`);
}

const port = Number(
  process.env.BENCH_PORT ?? String(19000 + (process.pid % 1000)),
);
const origin = `http://127.0.0.1:${port}`;
const query = new URLSearchParams({ example: exampleId, variant: variant.id });
const url = `${origin}${basePath}?${query}`;
const serverArguments = [
  join(appRoot, "scripts/serve.mjs"),
  "--port",
  String(port),
  "--directory",
  directory,
];
if (staticHost) serverArguments.push("--no-isolation");
const server = spawn(process.execPath, serverArguments, {
  cwd: appRoot,
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  let output = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`example server did not start\n${output}`)),
      5_000,
    );
    const finish = (callback) => {
      clearTimeout(timeout);
      callback();
    };
    server.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes(`at ${origin}`)) finish(resolve);
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });
    server.once("exit", (code) =>
      finish(() =>
        reject(new Error(`example server exited with ${code}\n${output}`)),
      ),
    );
  });
}

let browser = null;
const results = [];
try {
  await waitForServer();
  const configuredChrome = process.env.CHROMIUM ?? "/usr/bin/google-chrome";
  browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(configuredChrome) ? configuredChrome : undefined,
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(url, {
    waitUntil: staticHost ? "domcontentloaded" : "networkidle",
  });
  await page.waitForFunction(() => Boolean(globalThis.__benchmarkApp), null, {
    timeout: 60_000,
  });
  const readiness = await page.evaluate(() => globalThis.__benchmarkApp.ready);
  assert.equal(readiness.example, exampleId);
  if (staticHost) {
    assert.equal(readiness.readyCount, readiness.backendCount);
    assert.ok(readiness.backendCount > 0);
    assert.equal(
      await page.evaluate(() => globalThis.crossOriginIsolated),
      true,
    );
    assert.equal(
      await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      true,
    );
  }
  assert.equal(
    await page.evaluate(() => globalThis.__benchmarkApp.getVariant()?.id),
    variant.id,
  );

  for (const test of variant.tests) {
    const backends = await page.evaluate(() =>
      globalThis.__benchmarkApp.getController().getBackends(),
    );
    const byId = new Map(backends.map((backend) => [backend.id, backend]));
    for (const backendId of test.backends) {
      assert.equal(
        byId.get(backendId)?.status,
        "ready",
        `${exampleId}/${variant.id}/${test.id} requires ready backend ${backendId}`,
      );
    }
    const report = await page.evaluate(
      ({ study, specification }) =>
        globalThis.__benchmarkApp
          .getController()
          .runStudy(study, { test: specification }),
      { study: test.study, specification: test },
    );
    assert.equal(report.passed, true, `${test.id} differential failed`);
    assert.deepEqual(
      {
        example: report.examplePackage?.example,
        variant: report.examplePackage?.variant,
        test: report.examplePackage?.test,
      },
      { example: exampleId, variant: variant.id, test: test.id },
    );
    assert.match(report.examplePackage.testPackage.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(report.backendIds), `${test.id} omits backendIds`);
    assert.deepEqual(
      new Set(report.backendIds),
      new Set(test.backends),
      `${test.id} did not exercise its declared backends`,
    );
    if (test.oracle !== null) {
      assert.ok(
        report.backendIds.includes(test.oracle),
        `${test.id} did not exercise its ${test.oracle} oracle`,
      );
    }
    results.push({
      id: test.id,
      study: test.study,
      oracle: test.oracle,
      backends: test.backends,
      passed: true,
      report,
    });
  }
  assert.deepEqual(pageErrors, []);
  if (output) {
    const outputPath = inside(appRoot, output, "write example test report");
    await writeFile(
      outputPath,
      canonicalJson({
        schemaVersion: 1,
        kind: "browser-benchmarks/example-test-run",
        example: exampleId,
        variant: variant.id,
        testPackage: results[0]?.report.examplePackage.testPackage,
        benchmark: variant.benchmark.study,
        passed: results.every((result) => result.passed),
        results,
      }),
    );
  }
  console.log(
    `PASS ${exampleId}/${variant.id}: ${variant.tests.length} differential test(s); benchmark ${variant.benchmark.study} registered`,
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
