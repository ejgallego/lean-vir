import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { readBuildDatabase } from "../scripts/artifact-build-lib.mjs";
import { canonicalJson, fileRecord } from "../scripts/artifact-set-lib.mjs";
import { discoverExampleCatalog } from "../scripts/example-catalog-lib.mjs";
import {
  parsePagesDeployment,
  selectPagesCatalog,
} from "../scripts/pages-deployment-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("admits only canonical staged examples to Pages", async () => {
  const artifactsRoot = join(
    appRoot,
    "test-results",
    `pages-admission-${process.pid}`,
  );
  await rm(artifactsRoot, { recursive: true, force: true });
  const directory = join(artifactsRoot, "prettyM");
  await mkdir(directory, { recursive: true });
  try {
    const payloadPath = join(directory, "payload.bin");
    await writeFile(payloadPath, "pages payload\n");
    const catalog = await discoverExampleCatalog(appRoot);
    const database = await readBuildDatabase(
      join(appRoot, "artifact-builds.json"),
    );
    const example = catalog.examples.find(({ id }) => id === "prettyM");
    const testPackage = await fileRecord(join(appRoot, example.testPackage));
    const manifest = {
      schemaVersion: 2,
      kind: "browser-benchmarks/artifact-set",
      example: { id: "prettyM", variant: "default" },
      setId: "prettyM-bounded-set-0002",
      testPackage: { file: example.testPackage, ...testPackage },
      files: { "prettyM/payload.bin": await fileRecord(payloadPath) },
    };
    const manifestPath = join(directory, "ARTIFACT_SET.json");
    await writeFile(manifestPath, canonicalJson(manifest));
    const pagesCatalog = await selectPagesCatalog({
      appRoot,
      artifactsRoot,
      catalog,
      database,
      deployments: [parsePagesDeployment("prettyM=default")],
    });
    assert.deepEqual(
      pagesCatalog.examples.map(({ id }) => id),
      ["prettyM"],
    );
    await assert.rejects(
      () =>
        selectPagesCatalog({
          appRoot,
          artifactsRoot,
          catalog,
          database,
          deployments: [parsePagesDeployment("illuminate=default")],
        }),
      /has no canonical build/,
    );
    await writeFile(manifestPath, canonicalJson({ ...manifest, files: {} }));
    await assert.rejects(
      () =>
        selectPagesCatalog({
          appRoot,
          artifactsRoot,
          catalog,
          database,
          deployments: [parsePagesDeployment("prettyM=default")],
        }),
      /omits its example or files/,
    );
    await writeFile(manifestPath, canonicalJson(manifest));
    const unexpectedPath = join(directory, "unexpected.bin");
    await writeFile(unexpectedPath, "extra\n");
    await assert.rejects(
      () =>
        selectPagesCatalog({
          appRoot,
          artifactsRoot,
          catalog,
          database,
          deployments: [parsePagesDeployment("prettyM=default")],
        }),
      /unexpected member/,
    );
    await rm(unexpectedPath);
    const linkPath = join(directory, "payload-link.bin");
    await symlink("payload.bin", linkPath);
    await assert.rejects(
      () =>
        selectPagesCatalog({
          appRoot,
          artifactsRoot,
          catalog,
          database,
          deployments: [parsePagesDeployment("prettyM=default")],
        }),
      /not a regular file/,
    );
    await rm(linkPath);
    await writeFile(payloadPath, "changed\n");
    await assert.rejects(
      () =>
        selectPagesCatalog({
          appRoot,
          artifactsRoot,
          catalog,
          database,
          deployments: [parsePagesDeployment("prettyM=default")],
        }),
      /member digest mismatch/,
    );
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("the static-host service worker adds isolation headers", async () => {
  const listeners = new Map();
  const context = {
    Headers,
    Response,
    URL,
    fetch: async () => new Response("ok", { status: 200 }),
    self: {
      location: { origin: "https://example.test" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
  };
  runInNewContext(
    await readFile(join(appRoot, "static/coi-serviceworker.js"), "utf8"),
    context,
  );
  let isolatedResponse = null;
  listeners.get("fetch")({
    request: { url: "https://example.test/benchmarks/" },
    respondWith: (response) => {
      isolatedResponse = response;
    },
  });
  const response = await isolatedResponse;
  assert.equal(
    response.headers.get("Cross-Origin-Opener-Policy"),
    "same-origin",
  );
  assert.equal(
    response.headers.get("Cross-Origin-Embedder-Policy"),
    "require-corp",
  );
  assert.equal(
    response.headers.get("Cross-Origin-Resource-Policy"),
    "same-origin",
  );

  let crossOriginIntercepted = false;
  listeners.get("fetch")({
    request: { url: "https://other.test/resource" },
    respondWith: () => {
      crossOriginIntercepted = true;
    },
  });
  assert.equal(crossOriginIntercepted, false);
});
