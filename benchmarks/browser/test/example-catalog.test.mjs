import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { readBuildDatabase } from "../scripts/artifact-build-lib.mjs";
import {
  discoverExampleCatalog,
  validateExampleManifest,
  validateExampleTestPackage,
} from "../scripts/example-catalog-lib.mjs";
import { appRoot } from "../scripts/package-root.mjs";

test("discovers compact example manifests", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  assert.equal(catalog.kind, "browser-benchmarks/example-catalog");
  assert.deepEqual(
    catalog.examples.map(({ id, lifecycle }) => ({ id, lifecycle })),
    [
      { id: "illuminate", lifecycle: "active" },
      { id: "lean-zip", lifecycle: "active" },
      { id: "prettyM", lifecycle: "active" },
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
      "testPackage",
      "title",
    ]);
  }
});

test("materializes the uniform VIR package into the artifact build", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  const example = catalog.examples.find(({ id }) => id === "prettyM");
  const packageSpec = example.packages.find(({ id }) => id === "prettyM");
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  const workload = database.builds.prettyM.components.vir.artifact.workload;
  assert.equal(workload.packageRef, packageSpec.id);
  assert.equal(workload.source.file, packageSpec.target);
  assert.deepEqual(workload.exports, packageSpec.exports);
});

test("keeps the Illuminate package entry aligned with its custom producer", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  const example = catalog.examples.find(({ id }) => id === "illuminate");
  const packageSpec = example.packages.find(({ id }) => id === "player");
  const database = await readBuildDatabase(
    join(appRoot, "artifact-builds.json"),
  );
  assert.equal(
    packageSpec.target,
    "fixtures/illuminate/VirIlluminateAcceptance/Exports.lean",
  );
  assert.deepEqual(packageSpec.exports, [
    database.builds.illuminate.components.vir.artifact.entry,
  ]);
});

test("rejects unsafe or command-shaped example declarations", () => {
  const base = {
    schemaVersion: 1,
    kind: "browser-benchmarks/example",
    id: "small",
    title: "Small",
    summary: "Small example",
    lifecycle: "candidate",
    packages: [{ id: "main", target: "Small.lean", exports: ["Small.run"] }],
    controller: "examples/small/controller.mjs",
    testPackage: "examples/small/tests.json",
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

test("validates self-contained test variants and JavaScript oracles", () => {
  const base = {
    schemaVersion: 1,
    kind: "browser-benchmarks/example-tests",
    example: "small",
    variants: [
      {
        id: "default",
        title: "Default",
        build: "small",
        tests: [
          {
            id: "parity",
            study: "smoke",
            oracle: "js",
            backends: ["js", "vir", "fir"],
            data: { cases: [{ input: 1 }] },
          },
        ],
        benchmark: { study: "suite", data: { studies: ["scaling"] } },
      },
    ],
  };
  base.variants.push({
    id: "html",
    title: "HTML",
    build: "small-html",
    tests: [
      {
        id: "parity",
        study: "smoke",
        oracle: "js",
        backends: ["js", "vir", "fir"],
        data: { cases: [{ input: 2 }] },
      },
    ],
    benchmark: { study: "suite", data: { studies: ["scaling"] } },
  });
  assert.doesNotThrow(() => validateExampleTestPackage(base, "small"));

  const wrongDefault = structuredClone(base);
  wrongDefault.variants.reverse();
  assert.throws(
    () => validateExampleTestPackage(wrongDefault, "small"),
    /must declare default as its first variant/,
  );

  const duplicateVariant = structuredClone(base);
  duplicateVariant.variants[1].id = "default";
  assert.throws(
    () => validateExampleTestPackage(duplicateVariant, "small"),
    /repeats variant default/,
  );

  const duplicateTest = structuredClone(base);
  duplicateTest.variants[0].tests.push(
    structuredClone(duplicateTest.variants[0].tests[0]),
  );
  assert.throws(
    () => validateExampleTestPackage(duplicateTest, "small"),
    /repeats test parity/,
  );

  const duplicateTestStudy = structuredClone(base);
  duplicateTestStudy.variants[0].tests.push({
    ...structuredClone(duplicateTestStudy.variants[0].tests[0]),
    id: "another-test",
  });
  assert.throws(
    () => validateExampleTestPackage(duplicateTestStudy, "small"),
    /repeats study smoke/,
  );

  const duplicateBenchmarkStudy = structuredClone(base);
  duplicateBenchmarkStudy.variants[0].benchmark.study = "smoke";
  assert.throws(
    () => validateExampleTestPackage(duplicateBenchmarkStudy, "small"),
    /repeats study smoke/,
  );

  const missingOracle = structuredClone(base);
  missingOracle.variants[0].tests[0].backends = ["vir", "fir"];
  assert.throws(
    () => validateExampleTestPackage(missingOracle, "small"),
    /oracle is not a required backend/,
  );
  const commandShaped = structuredClone(base);
  commandShaped.variants[0].command = "npm test";
  assert.throws(
    () => validateExampleTestPackage(commandShaped, "small"),
    /unknown property command/,
  );
});
