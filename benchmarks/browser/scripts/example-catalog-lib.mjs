import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fileRecord, verifyStagedArtifactSet } from "./artifact-set-lib.mjs";
import {
  exactProperties,
  identifier,
  object,
  string,
} from "./validation-utils.mjs";

const lifecycles = new Set([
  "active",
  "candidate",
  "rehearsal",
  "queued",
  "archived",
]);
const lifecycleOrder = new Map([
  ["active", 0],
  ["candidate", 1],
  ["rehearsal", 2],
  ["queued", 3],
  ["archived", 4],
]);

function webPath(value, label) {
  const selected = string(value, label);
  if (
    selected.startsWith("/") ||
    selected.includes("\\") ||
    selected.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} is not a safe relative web path`);
  }
  return selected;
}

export function validateExampleManifest(manifest, { directory = null } = {}) {
  object(manifest, "example manifest");
  exactProperties(
    manifest,
    new Set([
      "schemaVersion",
      "kind",
      "id",
      "title",
      "summary",
      "lifecycle",
      "packages",
      "controller",
      "testPackage",
    ]),
    "example manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "browser-benchmarks/example"
  ) {
    throw new Error("unsupported example manifest");
  }
  const id = identifier(manifest.id, "example ID");
  if (directory !== null && directory !== id) {
    throw new Error(`example directory ${directory} does not match ID ${id}`);
  }
  if (!lifecycles.has(manifest.lifecycle)) {
    throw new Error(`example ${id} has an unsupported lifecycle`);
  }
  string(manifest.title, `example ${id} title`);
  string(manifest.summary, `example ${id} summary`);
  const controller = webPath(manifest.controller, `example ${id} controller`);
  if (controller !== `examples/${id}/controller.mjs`) {
    throw new Error(
      `example ${id} controller must be examples/${id}/controller.mjs`,
    );
  }
  const testPackage = webPath(
    manifest.testPackage,
    `example ${id} test package`,
  );
  if (testPackage !== `examples/${id}/tests.json`) {
    throw new Error(
      `example ${id} test package must be examples/${id}/tests.json`,
    );
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error(`example ${id} must declare at least one VIR package`);
  }
  const packageIds = new Set();
  for (const [index, item] of manifest.packages.entries()) {
    const packageSpec = object(item, `example ${id} packages[${index}]`);
    exactProperties(
      packageSpec,
      new Set(["id", "target", "exports"]),
      `example ${id} packages[${index}]`,
    );
    const packageId = identifier(packageSpec.id, `example ${id} package ID`);
    if (packageIds.has(packageId)) {
      throw new Error(`example ${id} repeats package ${packageId}`);
    }
    packageIds.add(packageId);
    const target = webPath(
      packageSpec.target,
      `example ${id} package ${packageId} target`,
    );
    if (!target.endsWith(".lean")) {
      throw new Error(`example ${id} package ${packageId} target must be a Lean source`);
    }
    if (!Array.isArray(packageSpec.exports) || packageSpec.exports.length === 0) {
      throw new Error(`example ${id} package ${packageId} must export a declaration`);
    }
    const exports = new Set();
    for (const [exportIndex, declaration] of packageSpec.exports.entries()) {
      string(declaration, `example ${id} package ${packageId} exports[${exportIndex}]`);
      if (exports.has(declaration)) {
        throw new Error(`example ${id} package ${packageId} repeats export ${declaration}`);
      }
      exports.add(declaration);
    }
  }
  return manifest;
}

export function validateExampleTestPackage(value, exampleId) {
  const testPackage = object(value, `example ${exampleId} test package`);
  exactProperties(
    testPackage,
    new Set(["schemaVersion", "kind", "example", "variants"]),
    `example ${exampleId} test package`,
  );
  if (
    testPackage.schemaVersion !== 1 ||
    testPackage.kind !== "browser-benchmarks/example-tests" ||
    testPackage.example !== exampleId
  ) {
    throw new Error(`unsupported test package for example ${exampleId}`);
  }
  if (!Array.isArray(testPackage.variants) || testPackage.variants.length === 0) {
    throw new Error(`example ${exampleId} must declare a test variant`);
  }
  const variantIds = new Set();
  for (const [variantIndex, item] of testPackage.variants.entries()) {
    const label = `example ${exampleId} variants[${variantIndex}]`;
    const variant = object(item, label);
    exactProperties(
      variant,
      new Set(["id", "title", "build", "tests", "benchmark"]),
      label,
    );
    const variantId = identifier(variant.id, `${label} ID`);
    if (variantIds.has(variantId)) {
      throw new Error(`example ${exampleId} repeats variant ${variantId}`);
    }
    variantIds.add(variantId);
    string(variant.title, `${label} title`);
    if (variant.build !== null) identifier(variant.build, `${label} build`);
    if (!Array.isArray(variant.tests) || variant.tests.length === 0) {
      throw new Error(`${label} must declare a differential test`);
    }
    const testIds = new Set();
    const studyIds = new Set();
    for (const [testIndex, testItem] of variant.tests.entries()) {
      const testLabel = `${label} tests[${testIndex}]`;
      const test = object(testItem, testLabel);
      exactProperties(
        test,
        new Set(["id", "study", "oracle", "backends", "data"]),
        testLabel,
      );
      const testId = identifier(test.id, `${testLabel} ID`);
      if (testIds.has(testId)) {
        throw new Error(`${label} repeats test ${testId}`);
      }
      testIds.add(testId);
      const studyId = identifier(test.study, `${testLabel} study`);
      if (studyIds.has(studyId)) {
        throw new Error(`${label} repeats study ${studyId}`);
      }
      studyIds.add(studyId);
      if (!Array.isArray(test.backends) || test.backends.length < 2) {
        throw new Error(`${testLabel} must require at least two backends`);
      }
      const backends = new Set();
      for (const [backendIndex, backend] of test.backends.entries()) {
        const backendId = identifier(
          backend,
          `${testLabel} backends[${backendIndex}]`,
        );
        if (backends.has(backendId)) {
          throw new Error(`${testLabel} repeats backend ${backendId}`);
        }
        backends.add(backendId);
      }
      if (test.oracle !== null) {
        const oracle = identifier(test.oracle, `${testLabel} oracle`);
        if (!backends.has(oracle)) {
          throw new Error(`${testLabel} oracle is not a required backend`);
        }
      }
      object(test.data, `${testLabel} data`);
    }
    const benchmark = object(variant.benchmark, `${label} benchmark`);
    exactProperties(
      benchmark,
      new Set(["study", "data"]),
      `${label} benchmark`,
    );
    const benchmarkStudyId = identifier(
      benchmark.study,
      `${label} benchmark study`,
    );
    if (studyIds.has(benchmarkStudyId)) {
      throw new Error(`${label} repeats study ${benchmarkStudyId}`);
    }
    object(benchmark.data, `${label} benchmark data`);
  }
  if (testPackage.variants[0].id !== "default") {
    throw new Error(`example ${exampleId} must declare default as its first variant`);
  }
  return testPackage;
}

export async function readExampleTestPackage(appRoot, example) {
  const path = resolve(appRoot, example.testPackage);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`example ${example.id} test package is missing: ${example.testPackage}`);
  }
  return validateExampleTestPackage(
    JSON.parse(await readFile(path, "utf8")),
    example.id,
  );
}

async function inspectArtifactAvailability(appRoot, artifactsRoot, example) {
  const testPackage = await readExampleTestPackage(appRoot, example);
  const defaultVariant = testPackage.variants[0].id;
  const directory = resolve(artifactsRoot, example.id);
  const directoryInfo = await stat(directory).catch(() => null);
  if (!directoryInfo) {
    return { status: "not-built", variant: defaultVariant };
  }
  if (!directoryInfo.isDirectory()) {
    return {
      status: "invalid",
      variant: defaultVariant,
      reason: "staged artifact path is not a directory",
    };
  }
  const manifestInfo = await stat(
    resolve(directory, "ARTIFACT_SET.json"),
  ).catch(() => null);
  if (!manifestInfo?.isFile()) {
    return {
      status: "invalid",
      variant: defaultVariant,
      reason: "staged artifact set omits ARTIFACT_SET.json",
    };
  }

  try {
    const manifest = await verifyStagedArtifactSet(directory);
    const variant = testPackage.variants.find(
      ({ id }) => id === manifest.example?.variant,
    );
    if (manifest.example?.id !== example.id || !variant) {
      throw new Error("manifest does not match a declared example variant");
    }
    const testPackageRecord = await fileRecord(
      resolve(appRoot, example.testPackage),
    );
    if (
      manifest.testPackage?.file !== example.testPackage ||
      manifest.testPackage?.bytes !== testPackageRecord.bytes ||
      manifest.testPackage?.sha256 !== testPackageRecord.sha256
    ) {
      throw new Error("manifest test package does not match the example");
    }
    return {
      status: "ready",
      variant: variant.id,
      setId: manifest.setId,
    };
  } catch (error) {
    return {
      status: "invalid",
      variant: defaultVariant,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function catalogWithArtifactAvailability({
  appRoot,
  artifactsRoot,
  catalog,
}) {
  return {
    ...catalog,
    examples: await Promise.all(
      catalog.examples.map(async (example) => ({
        ...example,
        availability: await inspectArtifactAvailability(
          appRoot,
          artifactsRoot,
          example,
        ),
      })),
    ),
  };
}

export async function discoverExampleCatalog(appRoot) {
  const examplesRoot = join(appRoot, "examples");
  const entries = await readdir(examplesRoot, { withFileTypes: true });
  const examples = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(examplesRoot, entry.name, "example.json");
    if (!(await stat(manifestPath).catch(() => null))?.isFile()) continue;
    const manifest = validateExampleManifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
      { directory: entry.name },
    );
    const controllerPath = resolve(appRoot, manifest.controller);
    if (!(await stat(controllerPath).catch(() => null))?.isFile()) {
      throw new Error(`example ${manifest.id} controller is missing: ${manifest.controller}`);
    }
    const testPackage = await readExampleTestPackage(appRoot, manifest);
    const controller = await import(pathToFileURL(controllerPath).href);
    const studies = new Set(
      (controller.view?.studies ?? []).map((study) => study?.id),
    );
    for (const variant of testPackage.variants) {
      for (const test of variant.tests) {
        if (!studies.has(test.study)) {
          throw new Error(
            `example ${manifest.id} variant ${variant.id} references unknown study ${test.study}`,
          );
        }
      }
      if (!studies.has(variant.benchmark.study)) {
        throw new Error(
          `example ${manifest.id} variant ${variant.id} references unknown benchmark ${variant.benchmark.study}`,
        );
      }
    }
    examples.push(manifest);
  }
  if (examples.length === 0) throw new Error("example catalog is empty");
  const ids = new Set();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`duplicate example ID: ${example.id}`);
    ids.add(example.id);
  }
  examples.sort(
    (left, right) =>
      lifecycleOrder.get(left.lifecycle) - lifecycleOrder.get(right.lifecycle) ||
      left.id.localeCompare(right.id),
  );
  return {
    schemaVersion: 1,
    kind: "browser-benchmarks/example-catalog",
    examples,
  };
}
