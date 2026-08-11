/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const SURFACE_REPORT_FORMAT = "lean-vir-library-surface";
export const CURRENT_SURFACE_REPORT_VERSION = 3;
export const SUPPORTED_SURFACE_REPORT_VERSIONS = [2, CURRENT_SURFACE_REPORT_VERSION];

export function hasCompleteBlockerFrontier(report) {
  return report?.definition?.completeBlockerFrontier === true
    && Array.isArray(report.reachableBlockers);
}

export function validateSurfaceReport(
  value,
  { label = "surface report", versions = SUPPORTED_SURFACE_REPORT_VERSIONS } = {},
) {
  if (value?.format !== SURFACE_REPORT_FORMAT) {
    throw new Error(
      `${label}: expected ${SURFACE_REPORT_FORMAT}, got ${JSON.stringify(value?.format)}`,
    );
  }
  if (!versions.includes(value.version)) {
    throw new Error(
      `${label}: expected ${SURFACE_REPORT_FORMAT} version ${versionList(versions)}, `
        + `got ${JSON.stringify(value.version)}`,
    );
  }
  for (const field of ["selectedModules", "modules", "declarations", "libraries", "primaryBlockers"]) {
    if (!Array.isArray(value[field])) {
      throw new Error(`${label}: field ${JSON.stringify(field)} must be an array`);
    }
  }
  if (value.externs !== undefined && !Array.isArray(value.externs)) {
    throw new Error(`${label}: field "externs" must be an array when present`);
  }
  if (value.selectedDeclarations !== undefined && !Array.isArray(value.selectedDeclarations)) {
    throw new Error(`${label}: field "selectedDeclarations" must be an array when present`);
  }
  if (!value.counts || !value.lean || !value.definition || !value.runtimeCapabilities) {
    throw new Error(`${label}: missing counts, Lean identity, definition, or capabilities`);
  }
  if (value.version >= 3 && value.closure === undefined) {
    throw new Error(`${label}: version 3 is missing closure metadata`);
  }
  if (value.version >= 3 && typeof value.definition.completeBlockerFrontier !== "boolean") {
    throw new Error(`${label}: version 3 is missing complete-blocker-frontier semantics`);
  }
  if (value.version >= 3) {
    const stringSemantics = [
      "headline", "primaryBlockerPolicy", "blockerCoverage", "externScope", "missingNodeKind",
    ];
    const booleanSemantics = [
      "encodingIsGate", "interfaceCallabilityIsGate", "dynamicValidationIsGate",
      "hostProvisioningVerified",
    ];
    if (stringSemantics.some((field) => typeof value.definition[field] !== "string")
        || booleanSemantics.some((field) => typeof value.definition[field] !== "boolean")) {
      throw new Error(`${label}: version 3 is missing analysis-definition semantics`);
    }
    const primitiveNamespaces = value.runtimeCapabilities.primitiveNamespaces;
    if (!Array.isArray(primitiveNamespaces)
        || primitiveNamespaces.some((namespace) => typeof namespace !== "string")) {
      throw new Error(`${label}: version 3 is missing primitive-namespace policy`);
    }
  }
  if (value.closure !== undefined) {
    const { selectedRoots, capturedNodes, rootReachableNodes, supportOnlyNodes } = value.closure;
    if (![selectedRoots, capturedNodes, rootReachableNodes, supportOnlyNodes]
      .every((entry) => Number.isInteger(entry) && entry >= 0)
      || selectedRoots !== value.counts.total
      || rootReachableNodes > capturedNodes
      || supportOnlyNodes !== capturedNodes - rootReachableNodes) {
      throw new Error(`${label}: inconsistent closure counts`);
    }
  }
  const completeFrontier = value.definition.completeBlockerFrontier === true;
  if (completeFrontier !== Array.isArray(value.reachableBlockers)) {
    throw new Error(`${label}: complete-frontier semantics do not match reachable blockers`);
  }
  if (value.counts.total !== value.declarations.length) {
    throw new Error(
      `${label}: ${value.counts.total} counted functions but ${value.declarations.length} records`,
    );
  }
  return value;
}

function versionList(versions) {
  if (versions.length === 1) return String(versions[0]);
  return `${versions.slice(0, -1).join(", ")} or ${versions.at(-1)}`;
}
