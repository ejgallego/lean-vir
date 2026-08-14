import { resolve } from "node:path";

import { selectBuild } from "./artifact-build-lib.mjs";
import {
  fileRecord,
  verifyStagedArtifactSet,
} from "./artifact-set-lib.mjs";
import { readExampleTestPackage } from "./example-catalog-lib.mjs";
import { isIdentifier } from "./validation-utils.mjs";

export function parsePagesDeployment(value) {
  const parts = typeof value === "string" ? value.split("=") : [];
  if (parts.length !== 2 || !parts.every(isIdentifier)) {
    throw new Error(`invalid Pages deployment: ${value}`);
  }
  return { example: parts[0], variant: parts[1] };
}

export async function activePagesDeployments({ appRoot, catalog, database }) {
  const deployments = [];
  for (const example of catalog.examples) {
    if (example.lifecycle !== "active") continue;
    const testPackage = await readExampleTestPackage(appRoot, example);
    if (testPackage.variants.length !== 1) {
      throw new Error(
        `active Pages example must declare one variant: ${example.id}`,
      );
    }
    const variant = testPackage.variants[0];
    if (variant.build === null) {
      throw new Error(
        `active Pages example has no canonical build: ${example.id}/${variant.id}`,
      );
    }
    const build = selectBuild(database, variant.build);
    if (
      build.example.id !== example.id ||
      build.example.variant !== variant.id
    ) {
      throw new Error(
        `active Pages build does not match ${example.id}/${variant.id}`,
      );
    }
    deployments.push({
      example: example.id,
      variant: variant.id,
      build: variant.build,
    });
  }
  if (deployments.length === 0) {
    throw new Error("catalog has no active Pages examples");
  }
  return deployments;
}

async function verifyStagedDeployment(
  appRoot,
  artifactsRoot,
  example,
  variant,
  build,
) {
  const directory = resolve(artifactsRoot, example.id);
  const manifest = await verifyStagedArtifactSet(directory);
  if (
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
  const selected = new Set();
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
    selected.add(example.id);
  }
  return {
    ...catalog,
    examples: catalog.examples.filter(({ id }) => selected.has(id)),
  };
}
