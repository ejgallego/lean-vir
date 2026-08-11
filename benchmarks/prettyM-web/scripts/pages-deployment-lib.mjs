import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { selectBuild } from "./artifact-build-lib.mjs";
import { fileRecord, readJson, safeArchivePath } from "./artifact-set-lib.mjs";
import { readExampleTestPackage } from "./example-catalog-lib.mjs";

const selectionPattern =
  /^([a-zA-Z0-9][a-zA-Z0-9._-]*)=([a-zA-Z0-9][a-zA-Z0-9._-]*)$/;

export function parsePagesDeployment(value) {
  const match = selectionPattern.exec(value ?? "");
  if (!match) throw new Error(`invalid Pages deployment: ${value}`);
  return { example: match[1], variant: match[2] };
}

async function stagedFiles(root, prefix = "") {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const local = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeArchivePath(local);
    const path = resolve(root, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(`staged artifact is a symbolic link: ${local}`);
    }
    if (info.isDirectory()) paths.push(...(await stagedFiles(path, local)));
    else if (info.isFile()) paths.push(local);
    else throw new Error(`staged artifact is not a regular file: ${local}`);
  }
  return paths.sort();
}

async function verifyStagedDeployment(
  appRoot,
  artifactsRoot,
  example,
  variant,
  build,
) {
  const directory = resolve(artifactsRoot, example.id);
  const manifest = await readJson(resolve(directory, "ARTIFACT_SET.json"));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.kind !== "browser-benchmarks/artifact-set" ||
    manifest.example?.id !== example.id ||
    manifest.example?.variant !== variant.id ||
    manifest.setId !== build.artifactSet.setId
  ) {
    throw new Error(
      `staged artifact does not match Pages deployment ${example.id}/${variant.id}`,
    );
  }

  const testPackage = await fileRecord(resolve(appRoot, example.testPackage));
  if (
    manifest.testPackage?.file !== example.testPackage ||
    manifest.testPackage?.bytes !== testPackage.bytes ||
    manifest.testPackage?.sha256 !== testPackage.sha256
  ) {
    throw new Error(
      `staged artifact test package does not match ${example.id}/${variant.id}`,
    );
  }

  const prefix = `${example.id}/`;
  const expected = new Set(["ARTIFACT_SET.json"]);
  const files = Object.entries(manifest.files ?? {});
  if (files.length === 0) {
    throw new Error(`staged artifact has no payload files: ${example.id}`);
  }
  for (const [path, recorded] of files) {
    safeArchivePath(path);
    if (!path.startsWith(prefix)) {
      throw new Error(`staged artifact path is outside ${prefix}: ${path}`);
    }
    const local = safeArchivePath(path.slice(prefix.length));
    const actual = await fileRecord(resolve(directory, local));
    if (
      actual.bytes !== recorded?.bytes ||
      actual.sha256 !== recorded?.sha256
    ) {
      throw new Error(`staged artifact file does not match: ${path}`);
    }
    expected.add(local);
  }
  const actual = await stagedFiles(directory);
  if (
    actual.length !== expected.size ||
    actual.some((path) => !expected.has(path))
  ) {
    throw new Error(`staged artifact contains undeclared files: ${example.id}`);
  }
}

export async function selectPagesCatalog({
  appRoot,
  artifactsRoot,
  catalog,
  database,
  deployments,
}) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("select at least one Pages deployment");
  }
  const selected = new Map();
  for (const deployment of deployments) {
    if (selected.has(deployment.example)) {
      throw new Error(`duplicate Pages example: ${deployment.example}`);
    }
    const example = catalog.examples.find(
      ({ id }) => id === deployment.example,
    );
    if (!example)
      throw new Error(`unknown Pages example: ${deployment.example}`);
    const testPackage = await readExampleTestPackage(appRoot, example);
    const variant = testPackage.variants.find(
      ({ id }) => id === deployment.variant,
    );
    if (!variant) {
      throw new Error(
        `unknown Pages variant: ${deployment.example}/${deployment.variant}`,
      );
    }
    if (testPackage.variants.length !== 1) {
      throw new Error(
        `Pages deployment requires one staged variant for ${example.id}`,
      );
    }
    if (variant.build === null) {
      throw new Error(
        `Pages deployment has no canonical build: ${example.id}/${variant.id}`,
      );
    }
    const build = selectBuild(database, variant.build);
    if (
      build.example.id !== example.id ||
      build.example.variant !== variant.id
    ) {
      throw new Error(
        `Pages deployment build does not match ${example.id}/${variant.id}`,
      );
    }
    await verifyStagedDeployment(
      appRoot,
      artifactsRoot,
      example,
      variant,
      build,
    );
    selected.set(example.id, example);
  }
  return {
    ...catalog,
    examples: catalog.examples.filter(({ id }) => selected.has(id)),
  };
}
