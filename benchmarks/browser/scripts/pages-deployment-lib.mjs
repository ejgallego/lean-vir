import { resolve } from "node:path";

import { catalogVariantBuilds } from "./artifact-build-lib.mjs";
import {
  fileRecord,
  verifyStagedArtifactSet,
} from "./artifact-set-lib.mjs";
import { isIdentifier } from "./validation-utils.mjs";

export function parsePagesDeployment(value) {
  const parts = typeof value === "string" ? value.split("=") : [];
  if (parts.length !== 2 || !parts.every(isIdentifier)) {
    throw new Error(`invalid Pages deployment: ${value}`);
  }
  return { example: parts[0], variant: parts[1] };
}

function resolvePagesVariant({ variants, example, variantId }) {
  const choices = variants.filter(
    ({ example: candidate }) => candidate.id === example.id,
  );
  if (choices.length !== 1) {
    throw new Error(`Pages example must declare one variant: ${example.id}`);
  }
  const selected =
    variantId === undefined
      ? choices[0]
      : choices.find(({ variant }) => variant.id === variantId);
  if (!selected) {
    throw new Error(`unknown Pages variant: ${example.id}/${variantId}`);
  }
  if (selected.build === null) {
    throw new Error(
      `Pages deployment has no canonical build: ${example.id}/${selected.variant.id}`,
    );
  }
  return selected;
}

export async function activePagesDeployments({ appRoot, catalog, database }) {
  const variants = await catalogVariantBuilds({ appRoot, catalog, database });
  const deployments = [];
  for (const example of catalog.examples) {
    if (example.lifecycle !== "active") continue;
    const { variant } = resolvePagesVariant({
      variants,
      example,
    });
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
  const variants = await catalogVariantBuilds({ appRoot, catalog, database });
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
    const { variant, build } = resolvePagesVariant({
      variants,
      example,
      variantId: deployment.variant,
    });
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
