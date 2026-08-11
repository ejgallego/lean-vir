import { readFile } from "node:fs/promises";

import { fileRecords, sha256 } from "./artifact-set-lib.mjs";

function sameKeys(left, right) {
  return (
    JSON.stringify(Object.keys(left ?? {}).sort()) ===
    JSON.stringify(Object.keys(right ?? {}).sort())
  );
}

function sameRecord(left, right) {
  return left?.bytes === right?.bytes && left?.sha256 === right?.sha256;
}

export async function verifySourceBuildReceipt({
  receiptPath,
  databasePath,
  examplePath,
  exampleId,
  buildId,
  setId,
  sources,
  components,
  seed,
}) {
  const [receiptBytes, databaseBytes, exampleBytes] = await Promise.all([
    readFile(receiptPath),
    readFile(databasePath),
    readFile(examplePath),
  ]);
  const receipt = JSON.parse(receiptBytes);
  if (
    receipt.schemaVersion !== 2 ||
    receipt.kind !== "browser-benchmarks/source-build-receipt" ||
    receipt.build !== buildId ||
    receipt.artifactSet !== setId
  ) {
    throw new Error("source-build receipt identity does not match the build");
  }
  if (
    receipt.database?.sha256 !== sha256(databaseBytes) ||
    receipt.example?.id !== exampleId ||
    receipt.example?.sha256 !== sha256(exampleBytes)
  ) {
    throw new Error("source-build receipt inputs do not match the catalog");
  }

  if (!sameKeys(receipt.sources, sources)) {
    throw new Error("source-build receipt has a different source set");
  }
  for (const [checkoutId, source] of Object.entries(sources)) {
    const recorded = receipt.sources[checkoutId];
    if (
      recorded?.sourceId !== source.id ||
      recorded?.repository !== source.repository ||
      recorded?.revision !== source.revision ||
      Object.hasOwn(recorded ?? {}, "path")
    ) {
      throw new Error(
        `source-build receipt does not match source ${checkoutId}`,
      );
    }
  }

  if (!sameKeys(receipt.components, components)) {
    throw new Error("source-build receipt has a different component set");
  }
  for (const [componentId, component] of Object.entries(components)) {
    const recorded = receipt.components[componentId];
    const paths = Object.values(component.producer.files);
    const files = await fileRecords(seed, paths);
    if (
      recorded?.adapter !== component.producer.adapter ||
      !sameKeys(recorded?.files, files)
    ) {
      throw new Error(
        `source-build receipt does not match component ${componentId}`,
      );
    }
    for (const path of paths) {
      if (!sameRecord(recorded.files[path], files[path])) {
        throw new Error(
          `source-build receipt file changed after validation: ${path}`,
        );
      }
    }
  }
}
