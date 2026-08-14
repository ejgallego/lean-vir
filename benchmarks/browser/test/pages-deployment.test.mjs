import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

async function stagedDeployment(t) {
  const resultsRoot = join(appRoot, "test-results");
  await mkdir(resultsRoot, { recursive: true });
  const artifactsRoot = await mkdtemp(join(resultsRoot, "pages-admission-"));
  t.after(() => rm(artifactsRoot, { recursive: true, force: true }));
  const directory = join(artifactsRoot, "prettyM");
  await mkdir(directory, { recursive: true });
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
    setId: database.builds.prettyM.artifactSet.setId,
    testPackage: { file: example.testPackage, ...testPackage },
    files: { "prettyM/payload.bin": await fileRecord(payloadPath) },
  };
  const manifestPath = join(directory, "ARTIFACT_SET.json");
  await writeFile(manifestPath, canonicalJson(manifest));
  return {
    artifactsRoot,
    catalog,
    database,
    directory,
    manifest,
    manifestPath,
    payloadPath,
    select: (deployment = "prettyM=default") =>
      selectPagesCatalog({
        appRoot,
        artifactsRoot,
        catalog,
        database,
        deployments: [parsePagesDeployment(deployment)],
      }),
  };
}

test("admits a canonical staged example to Pages", async (t) => {
  const fixture = await stagedDeployment(t);
  const pagesCatalog = await fixture.select();
  assert.deepEqual(
    pagesCatalog.examples.map(({ id }) => id),
    ["prettyM"],
  );
});

test("rejects a Pages example without a canonical build", async (t) => {
  const fixture = await stagedDeployment(t);
  await assert.rejects(
    () => fixture.select("illuminate=default"),
    /has no canonical build/,
  );
});

for (const [name, mutate, message] of [
  [
    "different variant",
    (manifest) => (manifest.example.variant = "wide"),
    /staged artifact does not match/,
  ],
  [
    "different set ID",
    (manifest) => (manifest.setId = "prettyM-other-set"),
    /staged artifact does not match/,
  ],
  [
    "different test-package digest",
    (manifest) => (manifest.testPackage.sha256 = "0".repeat(64)),
    /test package does not match/,
  ],
]) {
  test(`rejects a staged manifest with a ${name}`, async (t) => {
    const fixture = await stagedDeployment(t);
    const manifest = structuredClone(fixture.manifest);
    mutate(manifest);
    await writeFile(fixture.manifestPath, canonicalJson(manifest));
    await assert.rejects(() => fixture.select(), message);
  });
}

test("rejects a staged manifest without payload files", async (t) => {
  const fixture = await stagedDeployment(t);
  await writeFile(
    fixture.manifestPath,
    canonicalJson({ ...fixture.manifest, files: {} }),
  );
  await assert.rejects(() => fixture.select(), /omits its example or files/);
});

test("rejects an unexpected staged artifact file", async (t) => {
  const fixture = await stagedDeployment(t);
  await writeFile(join(fixture.directory, "unexpected.bin"), "extra\n");
  await assert.rejects(() => fixture.select(), /unexpected member/);
});

test("rejects a staged artifact symlink", async (t) => {
  const fixture = await stagedDeployment(t);
  await symlink("payload.bin", join(fixture.directory, "payload-link.bin"));
  await assert.rejects(() => fixture.select(), /not a regular file/);
});

test("rejects a corrupted staged artifact payload", async (t) => {
  const fixture = await stagedDeployment(t);
  await writeFile(fixture.payloadPath, "changed\n");
  await assert.rejects(() => fixture.select(), /member digest mismatch/);
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
