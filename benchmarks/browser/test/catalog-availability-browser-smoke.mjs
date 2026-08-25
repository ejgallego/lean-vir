import assert from "node:assert/strict";

import {
  collectPageErrors,
  launchBenchmarkBrowser,
  startBenchmarkServer,
} from "./harness.mjs";

const port = Number(
  process.env.BENCH_PORT ?? String(20000 + (process.pid % 1000)),
);
const server = await startBenchmarkServer({
  port,
  label: "catalog availability server",
});
let browser = null;

try {
  browser = await launchBenchmarkBrowser();
  const page = await browser.newPage();
  const pageErrors = collectPageErrors(page);
  await page.goto(server.origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(globalThis.__benchmarkApp));

  const catalogResponse = await fetch(`${server.origin}/examples/catalog.json`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.ok(catalog.examples.length > 0);

  for (const example of catalog.examples) {
    const availability = example.availability;
    assert.ok(
      ["ready", "missing", "invalid"].includes(availability?.status),
      `${example.id} omits artifact availability`,
    );
    const navigation = page.locator(
      `#example-nav [data-example="${example.id}"]`,
    );
    assert.equal(await navigation.count(), 1);
    assert.equal(
      await navigation.getAttribute("data-availability"),
      availability.status,
    );

    if (availability.status === "ready") {
      assert.notEqual(await navigation.getAttribute("href"), null);
      const controller = await page.evaluate(async (path) => {
        const module = await import(new URL(path, location.href).href);
        return {
          loadExample: typeof module.loadExample,
          view: typeof module.view,
        };
      }, example.controller);
      assert.deepEqual(controller, { loadExample: "function", view: "object" });

      const manifestResponse = await fetch(
        `${server.origin}/artifacts/${example.id}/ARTIFACT_SET.json`,
      );
      assert.equal(manifestResponse.status, 200);
      const manifest = await manifestResponse.json();
      assert.deepEqual(manifest.example, {
        id: example.id,
        variant: availability.variant,
      });
      assert.equal(manifest.setId, availability.setId);
      continue;
    }

    assert.equal(await navigation.getAttribute("href"), null);
    assert.equal(await navigation.getAttribute("aria-disabled"), "true");
    const unavailablePage = await browser.newPage();
    const unavailableErrors = collectPageErrors(unavailablePage);
    const artifactRequests = [];
    unavailablePage.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith(`/artifacts/${example.id}/`)
      ) {
        artifactRequests.push(request.url());
      }
    });
    await unavailablePage.goto(
      `${server.origin}/?example=${encodeURIComponent(example.id)}`,
      { waitUntil: "networkidle" },
    );
    await unavailablePage.waitForFunction(() =>
      Boolean(globalThis.__benchmarkApp),
    );
    assert.deepEqual(
      await unavailablePage.evaluate(() => __benchmarkApp.ready),
      {
        example: example.id,
        available: false,
        readyCount: 0,
        backendCount: 0,
      },
    );
    assert.match(
      await unavailablePage.locator("#app-state").textContent(),
      /Not staged|Artifacts invalid/,
    );
    assert.deepEqual(artifactRequests, []);
    assert.deepEqual(unavailableErrors, []);
    await unavailablePage.close();
  }

  assert.deepEqual(pageErrors, []);
  console.log(
    `PASS catalog availability: ${catalog.examples
      .map(({ id, availability }) => `${id}=${availability.status}`)
      .join(", ")}`,
  );
} finally {
  if (browser) await browser.close();
  await server.close();
}
