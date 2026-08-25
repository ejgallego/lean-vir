import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { readBuildDatabase } from "../scripts/artifact-build-lib.mjs";
import { canonicalJson, fileRecord } from "../scripts/artifact-set-lib.mjs";
import {
  catalogWithArtifactAvailability,
  discoverExampleCatalog,
} from "../scripts/example-catalog-lib.mjs";
import {
  activePagesDeployments,
  parsePagesDeployment,
  selectPagesCatalog,
} from "../scripts/pages-deployment-lib.mjs";
import { appRoot } from "../scripts/package-root.mjs";

test("parses safe example and variant selections", () => {
  assert.deepEqual(parsePagesDeployment("lean-zip=default"), {
    example: "lean-zip",
    variant: "default",
  });
  for (const value of [
    undefined,
    "",
    "prettyM",
    "prettyM=default=extra",
    "../prettyM=default",
    "prettyM=../default",
  ]) {
    assert.throws(
      () => parsePagesDeployment(value),
      /invalid Pages deployment/,
    );
  }
});

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
  const select = (selectedCatalog, ...deployments) =>
    selectPagesCatalog({
      appRoot,
      artifactsRoot,
      catalog: selectedCatalog,
      database,
      deployments: (deployments.length ? deployments : ["prettyM=default"]).map(
        parsePagesDeployment,
      ),
    });
  return {
    artifactsRoot,
    catalog,
    database,
    directory,
    manifest,
    manifestPath,
    payloadPath,
    select: (...deployments) => select(catalog, ...deployments),
    selectWithCatalog: select,
  };
}

async function catalogWithoutBuild(fixture, exampleId) {
  const catalog = structuredClone(fixture.catalog);
  const example = catalog.examples.find(({ id }) => id === exampleId);
  const testPackage = JSON.parse(
    await readFile(join(appRoot, example.testPackage), "utf8"),
  );
  testPackage.variants[0].build = null;
  const testPackagePath = join(
    fixture.artifactsRoot,
    `${exampleId}-without-build.json`,
  );
  await writeFile(testPackagePath, canonicalJson(testPackage));
  example.testPackage = relative(appRoot, testPackagePath);
  return catalog;
}

test("admits a canonical staged example to Pages", async (t) => {
  const fixture = await stagedDeployment(t);
  const pagesCatalog = await fixture.select();
  assert.deepEqual(
    pagesCatalog.examples.map(({ id }) => id),
    ["prettyM"],
  );
});

test("marks only verified staged examples as ready", async (t) => {
  const fixture = await stagedDeployment(t);
  const catalog = await catalogWithArtifactAvailability({
    appRoot,
    artifactsRoot: fixture.artifactsRoot,
    database: fixture.database,
    catalog: fixture.catalog,
  });
  assert.deepEqual(
    Object.fromEntries(
      catalog.examples.map(({ id, availability }) => [id, availability]),
    ),
    {
      illuminate: {
        status: "missing",
        variant: "default",
        build: "illuminate",
        setId: fixture.database.builds.illuminate.artifactSet.setId,
      },
      "lean-zip": {
        status: "missing",
        variant: "default",
        build: "lean-zip",
        setId: fixture.database.builds["lean-zip"].artifactSet.setId,
      },
      prettyM: {
        status: "ready",
        variant: "default",
        build: "prettyM",
        setId: fixture.manifest.setId,
      },
    },
  );
});

test("does not advertise an invalid staged example", async (t) => {
  const fixture = await stagedDeployment(t);
  await writeFile(join(fixture.directory, "unexpected.bin"), "extra\n");
  const catalog = await catalogWithArtifactAvailability({
    appRoot,
    artifactsRoot: fixture.artifactsRoot,
    database: fixture.database,
    catalog: fixture.catalog,
  });
  const prettyM = catalog.examples.find(({ id }) => id === "prettyM");
  assert.equal(prettyM.availability.status, "invalid");
  assert.equal(prettyM.availability.variant, "default");
  assert.match(prettyM.availability.reason, /unexpected member/);
});

test("does not admit a stale artifact set with matching tests", async (t) => {
  const fixture = await stagedDeployment(t);
  await writeFile(
    fixture.manifestPath,
    canonicalJson({ ...fixture.manifest, setId: "prettyM-stale-set" }),
  );
  const catalog = await catalogWithArtifactAvailability({
    appRoot,
    artifactsRoot: fixture.artifactsRoot,
    database: fixture.database,
    catalog: fixture.catalog,
  });
  const prettyM = catalog.examples.find(({ id }) => id === "prettyM");
  assert.equal(prettyM.availability.status, "invalid");
  assert.equal(
    prettyM.availability.setId,
    fixture.database.builds.prettyM.artifactSet.setId,
  );
  assert.match(prettyM.availability.reason, /expected artifact set.*found/);
});

test("derives Pages deployments from active canonical examples", async (t) => {
  const fixture = await stagedDeployment(t);
  assert.deepEqual(
    await activePagesDeployments({
      appRoot,
      catalog: fixture.catalog,
      database: fixture.database,
    }),
    [
      { example: "illuminate", variant: "default", build: "illuminate" },
      { example: "lean-zip", variant: "default", build: "lean-zip" },
      { example: "prettyM", variant: "default", build: "prettyM" },
    ],
  );
});

test("rejects an active example without a canonical build", async (t) => {
  const fixture = await stagedDeployment(t);
  const catalog = await catalogWithoutBuild(fixture, "illuminate");
  await assert.rejects(
    () =>
      activePagesDeployments({
        appRoot,
        catalog,
        database: fixture.database,
      }),
    /has no canonical build/,
  );
});

test("rejects a Pages example without a canonical build", async (t) => {
  const fixture = await stagedDeployment(t);
  const catalog = await catalogWithoutBuild(fixture, "illuminate");
  await assert.rejects(
    () => fixture.selectWithCatalog(catalog, "illuminate=default"),
    /has no canonical build/,
  );
});

test("rejects duplicate Pages example selections", async (t) => {
  const fixture = await stagedDeployment(t);
  await assert.rejects(
    () => fixture.select("prettyM=default", "prettyM=default"),
    /duplicate Pages example: prettyM/,
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
