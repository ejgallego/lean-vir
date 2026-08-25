import { catalogVariantBuilds } from "./artifact-build-lib.mjs";
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

function requireReadyDeployment(example, variant, build) {
  const availability = example.availability;
  if (
    availability?.status !== "ready" ||
    availability.variant !== variant.id ||
    availability.build !== variant.build ||
    availability.setId !== build.artifactSet.setId
  ) {
    const detail =
      typeof availability?.reason === "string"
        ? `: ${availability.reason}`
        : "";
    throw new Error(
      `staged artifact does not match Pages deployment ${example.id}/${variant.id}${detail}`,
    );
  }
}

export async function selectPagesCatalog({
  appRoot,
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
    requireReadyDeployment(example, variant, build);
    selected.add(example.id);
  }
  return {
    ...catalog,
    examples: catalog.examples.filter(({ id }) => selected.has(id)),
  };
}
