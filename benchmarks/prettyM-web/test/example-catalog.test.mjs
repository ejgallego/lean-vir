import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readBuildDatabase } from "../scripts/artifact-build-lib.mjs";
import {
  discoverExampleCatalog,
  validateExampleManifest,
  validateExampleTestPackage,
} from "../scripts/example-catalog-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("discovers compact example manifests", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  assert.equal(catalog.kind, "browser-benchmarks/example-catalog");
  assert.deepEqual(
    catalog.examples.map(({ id, lifecycle }) => ({ id, lifecycle })),
    [
      { id: "prettyM", lifecycle: "active" },
      { id: "verso-search-json", lifecycle: "candidate" },
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
      "testPackage",
      "title",
    ]);
  }
});

test("materializes the uniform VIR package into the artifact build", async () => {
  const catalog = await discoverExampleCatalog(appRoot);
  const database = await readBuildDatabase(join(appRoot, "artifact-builds.json"));
  for (const { exampleId, packageId, buildId } of [
    { exampleId: "prettyM", packageId: "prettyM", buildId: "prettyM" },
    {
      exampleId: "verso-search-json",
      packageId: "owned",
      buildId: "verso-search-json-owned",
    },
    {
      exampleId: "verso-search-json",
      packageId: "borrowed",
      buildId: "verso-search-json-borrowed",
    },
  ]) {
    const example = catalog.examples.find(({ id }) => id === exampleId);
    const packageSpec = example.packages.find(({ id }) => id === packageId);
    const workload =
      database.builds[buildId].components.vir.artifact.workload;
    assert.equal(workload.packageRef, packageSpec.id);
    assert.equal(workload.source.file, packageSpec.target);
    assert.deepEqual(workload.exports, packageSpec.exports);
  }
});

test("pins the generated Verso xref fixtures and JavaScript oracles", async () => {
  const tests = JSON.parse(
    await readFile(
      join(appRoot, "examples/verso-search-json/tests.json"),
      "utf8",
    ),
  );
  const fixtures = tests.variants[0].tests[0].data.fixtures;
  assert.deepEqual(
    tests.variants[1].tests[0].data,
    tests.variants[0].tests[0].data,
  );
  assert.deepEqual(
    tests.variants[1].benchmark.data,
    tests.variants[0].benchmark.data,
  );
  assert.deepEqual(
    fixtures.map(({ id, searchables }) => ({ id, searchables })),
    [
      { id: "manual", searchables: 295 },
      { id: "literate", searchables: 28 },
    ],
  );
  for (const fixture of fixtures) {
    for (const [pathKey, hashKey] of [
      ["xref", "xrefSha256"],
      ["mapper", "mapperSha256"],
    ]) {
      const bytes = await readFile(join(appRoot, fixture[pathKey]));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        fixture[hashKey],
      );
    }
  }
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
