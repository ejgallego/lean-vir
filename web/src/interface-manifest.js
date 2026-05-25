/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const INTERFACE_MANIFEST_ARTIFACT = "lean-vir-ir-package";

export const INTERFACE_MANIFEST_SHAPE_ERROR =
  "embedded interface manifest must be { version: 1, metadata: {...}, exports: [...] }";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateInterfaceManifest(manifest) {
  if (!isRecord(manifest) ||
      manifest.version !== 1 ||
      !isRecord(manifest.metadata) ||
      !Array.isArray(manifest.exports)) {
    throw new Error(INTERFACE_MANIFEST_SHAPE_ERROR);
  }
  if (manifest.artifact !== undefined && manifest.artifact !== INTERFACE_MANIFEST_ARTIFACT) {
    throw new Error(`embedded interface manifest artifact must be ${INTERFACE_MANIFEST_ARTIFACT}`);
  }
  if (manifest.diagnostics !== undefined && !Array.isArray(manifest.diagnostics)) {
    throw new Error("embedded interface manifest diagnostics must be an array");
  }
  return manifest;
}

export function manifestDiagnostics(manifest) {
  return Array.isArray(manifest?.diagnostics) ? manifest.diagnostics : [];
}

export function formatInterfaceType(type) {
  switch (type?.wireTag) {
    case 14:
      return type.type ?? "Enum";
    case 16:
      return `Array<${formatInterfaceType(type.element)}>`;
    case 17:
      return `List<${formatInterfaceType(type.element)}>`;
    case 18:
      return `Option<${formatInterfaceType(type.element)}>`;
    case 19:
      return `Prod<${formatInterfaceType(type.fst)}, ${formatInterfaceType(type.snd)}>`;
    default:
      return type?.type ?? `wireTag ${type?.wireTag ?? "?"}`;
  }
}
