import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readBuildDatabase } from "../scripts/artifact-build-lib.mjs";
import {
  discoverExampleCatalog,
  validateExampleManifest,
} from "../scripts/example-catalog-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("discovers compact example manifests", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  assert.equal(catalog.kind, "browser-benchmarks/example-catalog");
  assert.deepEqual(
    catalog.examples.map(({ id, lifecycle }) => ({ id, lifecycle })),
    [
      { id: "prettyM", lifecycle: "active" },
      { id: "illuminate", lifecycle: "rehearsal" },
    ],
  );
  for (const example of catalog.examples) {
    assert.deepEqual(Object.keys(example).sort(), [
      "controller",
      "id",
      "kind",
      "lifecycle",
      "packages",
      "schemaVersion",
      "summary",
      "title",
    ]);
  }
});

test("materializes the uniform VIR package into the artifact build", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  const example = catalog.examples.find(({ id }) => id === "prettyM");
  const packageSpec = example.packages.find(({ id }) => id === "prettyM");
  const database = await readBuildDatabase(join(appRoot, "artifact-builds.json"));
  const workload = database.builds.prettyM.components.vir.artifact.workload;
  assert.equal(workload.packageRef, packageSpec.id);
  assert.equal(workload.source.file, packageSpec.target);
  assert.deepEqual(workload.exports, packageSpec.exports);
});

test("rejects unsafe or command-shaped example declarations", () => {
  const base = {
    schemaVersion: 1,
    kind: "browser-benchmarks/example",
    id: "small",
    title: "Small",
    summary: "Small example",
    lifecycle: "candidate",
    packages: [
      { id: "main", target: "Small.lean", exports: ["Small.run"] },
    ],
    controller: "examples/small/controller.mjs",
  };
  assert.doesNotThrow(() => validateExampleManifest(base));
  assert.throws(
    () =>
      validateExampleManifest({
        ...base,
        packages: [
          { id: "main", target: "../Small.lean", exports: ["Small.run"] },
        ],
      }),
    /safe relative web path/,
  );
  assert.throws(
    () => validateExampleManifest({ ...base, command: "lake build" }),
    /unknown property command/,
  );
});
