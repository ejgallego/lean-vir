const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function requireArtifactManifestIdentity(
  manifest,
  { exampleId, variantId, testPackage },
) {
  if (
    manifest?.schemaVersion !== 2 ||
    manifest?.kind !== "browser-benchmarks/artifact-set" ||
    manifest?.example?.id !== exampleId ||
    manifest?.example?.variant !== variantId ||
    typeof manifest?.setId !== "string" ||
    !identifierPattern.test(manifest.setId)
  ) {
    throw new Error("manifest does not match the selected example variant");
  }
  if (
    !manifest.testPackage ||
    manifest.testPackage.file !== testPackage.file ||
    manifest.testPackage.bytes !== testPackage.bytes ||
    manifest.testPackage.sha256 !== testPackage.sha256
  ) {
    throw new Error("manifest test package does not match the selected example");
  }
  return manifest;
}
