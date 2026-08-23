/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const SURFACE_REPORT_FORMAT = "lean-vir-library-surface";
export const CURRENT_SURFACE_REPORT_VERSION = 3;
export const SURFACE_SIZE_LINKS_FORMAT = "lean-vir-surface-size-links";
export const CURRENT_SURFACE_SIZE_LINKS_VERSION = 2;
const SUPPORTED_SURFACE_REPORT_VERSIONS = [2, CURRENT_SURFACE_REPORT_VERSION];

const COUNT_FIELDS = [
  "total", "runnable", "blocked", "publicTotal", "publicRunnable",
  "privateTotal", "boxedTotal", "generatedTotal",
];
const DECLARATION_KINDS = new Set([
  "publicConstant", "privateConstant", "boxed", "generated",
]);
const BLOCKER_KINDS = new Set([
  "missingExtern", "incompatibleExtern", "missingDecl", "unsupportedInitGlobal",
]);
const EXTERN_STATUSES = new Set(["native", "host", "missing", "incompatible"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isSurfaceAbi(abi) {
  return abi && Array.isArray(abi.params)
    && abi.params.every((param) => typeof param?.borrow === "boolean"
      && typeof param.type === "string" && param.type.length > 0)
    && typeof abi.resultType === "string"
    && abi.resultType.length > 0;
}

export function surfaceAbiMatchesCapability(abi, capability) {
  return isSurfaceAbi(abi)
    && abi.resultType === capability?.resultType
    && Array.isArray(capability?.params)
    && abi.params.length === capability.params.length
    && abi.params.every((param, index) => param.borrow === capability.params[index].borrow
      && param.type === capability.params[index].type);
}

export function aggregateSurfaceDeclarations(declarations) {
  const counts = emptySurfaceCounts();
  const byModule = new Map();
  for (const declaration of declarations) {
    addDeclarationCount(counts, declaration);
    const moduleCounts = byModule.get(declaration.module) ?? emptySurfaceCounts();
    addDeclarationCount(moduleCounts, declaration);
    byModule.set(declaration.module, moduleCounts);
  }
  const modules = [...byModule]
    .map(([name, moduleCounts]) => ({ name, counts: moduleCounts }))
    .sort((lhs, rhs) => compareText(lhs.name, rhs.name));
  const byLibrary = new Map();
  for (const module of modules) {
    const name = module.name.split(".", 1)[0];
    const library = byLibrary.get(name) ?? {
      name,
      modulesWithFunctions: 0,
      counts: emptySurfaceCounts(),
    };
    library.modulesWithFunctions += 1;
    addCounts(library.counts, module.counts);
    byLibrary.set(name, library);
  }
  const libraries = [...byLibrary.values()]
    .sort((lhs, rhs) => compareText(lhs.name, rhs.name));
  return { counts, modules, libraries };
}

export function emptySurfaceCounts() {
  return Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0]));
}

export function compareText(lhs, rhs) {
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

export function validateSurfaceSizeLinks(value, { label = "surface size links" } = {}) {
  if (value?.format !== SURFACE_SIZE_LINKS_FORMAT
      || value.version !== CURRENT_SURFACE_SIZE_LINKS_VERSION) {
    throw new Error(
      `${label}: expected ${SURFACE_SIZE_LINKS_FORMAT} version ${CURRENT_SURFACE_SIZE_LINKS_VERSION}`,
    );
  }
  if (!Array.isArray(value.externs)) {
    throw new Error(`${label}: field "externs" must be an array`);
  }
  validateUniqueStrings(
    value.externs.map((entry) => entry?.name),
    `${label}: extern names`,
  );
  for (const entry of value.externs) {
    if (typeof entry.module !== "string" || entry.module.length === 0
        || !EXTERN_STATUSES.has(entry.status)
        || !Number.isInteger(entry.primaryRoots) || entry.primaryRoots < 0
        || !Number.isInteger(entry.primaryPublicRoots) || entry.primaryPublicRoots < 0
        || entry.primaryPublicRoots > entry.primaryRoots
        || !Array.isArray(entry.frontierCosts)
        || !Array.isArray(entry.targets)
        || entry.targets.some((target) => typeof target !== "string" || target.length === 0)) {
      throw new Error(`${label}: invalid extern link ${JSON.stringify(entry.name)}`);
    }
  }
  return value;
}

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
  validateCounts(value.counts, label);
  if (value.version >= 3 && value.closure === undefined) {
    throw new Error(`${label}: version 3 is missing closure metadata`);
  }
  if (value.version >= 3 && typeof value.definition.completeBlockerFrontier !== "boolean") {
    throw new Error(`${label}: version 3 is missing complete-blocker-frontier semantics`);
  }
  if (value.version >= 3) {
    if (!Array.isArray(value.selectedDeclarations) || !Array.isArray(value.externs)) {
      throw new Error(`${label}: version 3 is missing selected declarations or externs`);
    }
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
    const nativeExterns = value.runtimeCapabilities.nativeExterns;
    const nativeExternCount = value.runtimeCapabilities.nativeExternCount;
    if (!Array.isArray(primitiveNamespaces)
        || primitiveNamespaces.some((namespace) => typeof namespace !== "string")
        || !Array.isArray(nativeExterns)
        || !Number.isInteger(nativeExternCount)
        || nativeExternCount !== nativeExterns.length) {
      throw new Error(`${label}: version 3 is missing runtime-capability policy`);
    }
    validateUniqueStrings(value.selectedModules, `${label}: selected modules`);
    validateUniqueStrings(value.selectedDeclarations, `${label}: selected declarations`);
    validateUniqueStrings(primitiveNamespaces, `${label}: primitive namespaces`);
    validateNativeExterns(nativeExterns, label);
    if (value.capture !== undefined) validateCapture(value.capture, nativeExterns, label);
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
  if (value.version >= 3) {
    const { declarationNames, primaryBlockers, reachableBlockers } = validateDeclarations(
      value.declarations,
      completeFrontier,
      value.counts,
      label,
    );
    if (value.selectedDeclarations.length > 0) {
      if (value.selectedDeclarations.length !== value.counts.total) {
        throw new Error(`${label}: selected declarations do not cover every declaration record`);
      }
      for (const name of value.selectedDeclarations) {
        if (!declarationNames.has(name)) {
          throw new Error(`${label}: selected declaration ${JSON.stringify(name)} is missing`);
        }
      }
    }
    if (completeFrontier && value.selectedDeclarations.length !== value.counts.total) {
      throw new Error(`${label}: complete frontier does not cover every selected declaration`);
    }
    validateBlockerSummaries(value.primaryBlockers, primaryBlockers, "primary blockers", label);
    if (completeFrontier) {
      validateBlockerSummaries(
        value.reachableBlockers,
        reachableBlockers,
        "reachable blockers",
        label,
      );
    }
    validateExterns(value.externs, value.runtimeCapabilities.nativeExterns, label);
    validateAggregateRecords(value, label);
  }
  return value;
}

function validateCounts(counts, label) {
  if (!COUNT_FIELDS.every((field) => Number.isInteger(counts[field]) && counts[field] >= 0)
      || counts.runnable + counts.blocked !== counts.total
      || counts.publicRunnable > counts.publicTotal
      || counts.publicRunnable > counts.runnable
      || counts.publicTotal + counts.privateTotal + counts.boxedTotal + counts.generatedTotal
        !== counts.total) {
    throw new Error(`${label}: inconsistent declaration counts`);
  }
}

function validateUniqueStrings(values, label) {
  if (values.some((value) => typeof value !== "string" || value.length === 0)
      || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique non-empty strings`);
  }
}

function validateNativeExterns(nativeExterns, label) {
  validateUniqueStrings(nativeExterns.map((entry) => entry?.name), `${label}: native extern names`);
  for (const entry of nativeExterns) {
    const paramIndices = Array.isArray(entry.params)
      ? entry.params.map((param) => param?.index)
      : [];
    if (typeof entry.symbol !== "string" || entry.symbol.length === 0
        || typeof entry.generateBoxedWrapper !== "boolean"
        || !Array.isArray(entry.params)
        || entry.params.some((param) => !Number.isInteger(param?.index) || param.index < 0
          || typeof param.borrow !== "boolean"
          || typeof param.type !== "string" || param.type.length === 0)
        || new Set(paramIndices).size !== paramIndices.length
        || typeof entry.resultType !== "string" || entry.resultType.length === 0
        || !Array.isArray(entry.deps)
        || entry.deps.some((dependency) => typeof dependency !== "string"
          || dependency.length === 0)
        || new Set(entry.deps).size !== entry.deps.length) {
      throw new Error(`${label}: native extern ${JSON.stringify(entry.name)} has invalid ABI metadata`);
    }
  }
}

function validateDeclarations(declarations, completeFrontier, expectedCounts, label) {
  const declarationNames = new Set();
  const primaryBlockers = new Map();
  const reachableBlockers = new Map();
  for (const declaration of declarations) {
    if (typeof declaration?.name !== "string" || declaration.name.length === 0
        || typeof declaration.module !== "string" || declaration.module.length === 0
        || !DECLARATION_KINDS.has(declaration.kind)
        || typeof declaration.runnable !== "boolean"
        || !Array.isArray(declaration.blockerPath)
        || !nullableString(declaration.type)
        || !nullableString(declaration.doc)) {
      throw new Error(`${label}: invalid declaration record ${JSON.stringify(declaration?.name)}`);
    }
    if (declarationNames.has(declaration.name)) {
      throw new Error(`${label}: declaration names must be unique`);
    }
    declarationNames.add(declaration.name);
    if (declaration.runnable) {
      if (declaration.blocker !== null || declaration.blockerPath.length !== 0) {
        throw new Error(`${label}: declaration ${JSON.stringify(declaration.name)} has inconsistent runnable status`);
      }
    } else {
      validateBlockerPath(declaration.blocker, declaration.blockerPath, declaration.name, label);
      incrementBlockerCount(primaryBlockers, declaration.blocker, declaration.kind);
    }
    if (completeFrontier) {
      if (!Array.isArray(declaration.blockers)) {
        throw new Error(
          `${label}: selected declaration ${JSON.stringify(declaration.name)} is missing its complete blocker set`,
        );
      }
      if (declaration.runnable !== (declaration.blockers.length === 0)) {
        throw new Error(
          `${label}: selected declaration ${JSON.stringify(declaration.name)} has inconsistent blocker status`,
        );
      }
      const seen = new Set();
      for (const entry of declaration.blockers) {
        validateBlockerPath(entry?.blocker, entry?.path, declaration.name, label);
        const key = blockerKey(entry.blocker);
        if (seen.has(key)) {
          throw new Error(`${label}: declaration ${JSON.stringify(declaration.name)} repeats a blocker`);
        }
        seen.add(key);
        incrementBlockerCount(reachableBlockers, entry.blocker, declaration.kind);
      }
      if (!declaration.runnable
          && blockerKey(declaration.blocker) !== blockerKey(declaration.blockers[0]?.blocker)) {
        throw new Error(`${label}: declaration ${JSON.stringify(declaration.name)} has inconsistent primary blocker`);
      }
    }
  }
  const actualCounts = aggregateSurfaceDeclarations(declarations).counts;
  if (!sameCounts(actualCounts, expectedCounts)) {
    throw new Error(`${label}: declaration records do not match aggregate counts`);
  }
  return { declarationNames, primaryBlockers, reachableBlockers };
}

function validateExterns(externs, nativeExterns, label) {
  validateUniqueStrings(externs.map((entry) => entry?.name), `${label}: extern names`);
  const nativeByName = new Map(nativeExterns.map((entry) => [entry.name, entry]));
  for (const entry of externs) {
    const capability = nativeByName.get(entry.name);
    const capabilityStatus = entry.status === "native" || entry.status === "incompatible";
    if (typeof entry.module !== "string" || entry.module.length === 0
        || !EXTERN_STATUSES.has(entry.status)
        || !Array.isArray(entry.targets)
        || entry.targets.some((target) => !validExternTarget(target))
        || !nullableString(entry.type)
        || !nullableString(entry.doc)
        || capabilityStatus !== Boolean(capability)
        || (entry.status === "incompatible"
          && (!isSurfaceAbi(entry.targetAbi)
            || !surfaceAbiMatchesCapability(entry.capabilityAbi, capability)))) {
      throw new Error(`${label}: invalid extern record ${JSON.stringify(entry.name)}`);
    }
  }
}

function validateBlockerSummaries(summaries, expected, description, label) {
  const seen = new Set();
  for (const summary of summaries) {
    const blocker = summary?.blocker;
    const key = blockerKey(blocker);
    if (!validBlocker(blocker)
        || seen.has(key)
        || !Number.isInteger(summary.roots) || summary.roots <= 0
        || !Number.isInteger(summary.publicRoots) || summary.publicRoots < 0
        || summary.publicRoots > summary.roots
        || typeof summary.exampleRoot !== "string" || summary.exampleRoot.length === 0
        || !validPath(summary.examplePath, summary.exampleRoot, blocker.name)) {
      throw new Error(`${label}: invalid ${description} summary`);
    }
    seen.add(key);
    const counts = expected.get(key);
    if (!counts || counts.roots !== summary.roots || counts.publicRoots !== summary.publicRoots) {
      throw new Error(`${label}: ${description} do not match declaration records`);
    }
  }
  if (seen.size !== expected.size) {
    throw new Error(`${label}: ${description} do not cover every declaration blocker`);
  }
}

function validateBlockerPath(blocker, path, root, label) {
  if (!validBlocker(blocker) || !validPath(path, root, blocker.name)) {
    throw new Error(`${label}: declaration ${JSON.stringify(root)} has an invalid blocker path`);
  }
}

function validBlocker(blocker) {
  return BLOCKER_KINDS.has(blocker?.kind)
    && typeof blocker.name === "string"
    && blocker.name.length > 0;
}

function validPath(path, root, blocker) {
  return Array.isArray(path)
    && path.length > 0
    && path.every((name) => typeof name === "string" && name.length > 0)
    && path[0] === root
    && path.at(-1) === blocker;
}

function validExternTarget(target) {
  if (target?.kind === "standard" || target?.kind === "inline") {
    return typeof target.backend === "string" && target.backend.length > 0
      && typeof target.value === "string" && target.value.length > 0;
  }
  if (target?.kind === "adhoc") {
    return typeof target.backend === "string" && target.backend.length > 0
      && target.value === null;
  }
  return target?.kind === "opaque" && target.backend === null && target.value === null;
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function incrementBlockerCount(counts, blocker, declarationKind) {
  const key = blockerKey(blocker);
  const current = counts.get(key) ?? { roots: 0, publicRoots: 0 };
  current.roots += 1;
  if (declarationKind === "publicConstant") current.publicRoots += 1;
  counts.set(key, current);
}

function blockerKey(blocker) {
  return `${blocker?.kind}\u0000${blocker?.name}`;
}

function validateCapture(capture, nativeExterns, label) {
  if (capture?.mode !== "targetToolchainSource") {
    throw new Error(`${label}: unsupported capture mode ${JSON.stringify(capture?.mode)}`);
  }
  for (const field of ["source", "module", "graphFormat"]) {
    if (typeof capture[field] !== "string" || capture[field].length === 0) {
      throw new Error(`${label}: target capture is missing ${field}`);
    }
  }
  for (const field of ["sourceSha256", "graphSha256", "rootGraphSha256"]) {
    if (!isSha256(capture[field])) {
      throw new Error(`${label}: target capture has invalid ${field}`);
    }
  }
  if (!Number.isInteger(capture.graphVersion) || capture.graphVersion <= 0
      || !Array.isArray(capture.supportRoots)
      || capture.supportRoots.some((root) => typeof root !== "string")) {
    throw new Error(`${label}: target capture has invalid graph metadata`);
  }
  validateUniqueStrings(capture.supportRoots, `${label}: capture support roots`);
  if (capture.clientNativeExternManifest !== undefined) {
    const profile = capture.clientNativeExternManifest;
    if (typeof profile?.source !== "string" || profile.source.length === 0
        || !isSha256(profile.sha256)
        || !Array.isArray(profile.externs)) {
      throw new Error(`${label}: invalid client-native extern manifest provenance`);
    }
    validateUniqueStrings(profile.externs, `${label}: client-native extern manifest`);
    const capabilities = new Map(nativeExterns.map((entry) => [entry.name, entry]));
    if (profile.externs.length === 0 || profile.externs.some((name) =>
      capabilities.get(name)?.generateBoxedWrapper !== true)) {
      throw new Error(`${label}: client-native extern manifest does not match capabilities`);
    }
  }
}

function validateAggregateRecords(report, label) {
  const expected = aggregateSurfaceDeclarations(report.declarations);
  validateNamedCounts(report.modules, expected.modules, "module", label);
  validateNamedCounts(report.libraries, expected.libraries, "library", label, true);
}

function validateNamedCounts(actual, expected, kind, label, libraries = false) {
  validateUniqueStrings(actual.map((entry) => entry?.name), `${label}: ${kind} names`);
  const expectedByName = new Map(expected.map((entry) => [entry.name, entry]));
  if (actual.length !== expected.length || actual.some((entry) => {
    const expectedEntry = expectedByName.get(entry.name);
    return !entry?.counts || !expectedEntry || !sameCounts(entry.counts, expectedEntry.counts)
      || (libraries && entry.modulesWithFunctions !== expectedEntry.modulesWithFunctions);
  })) {
    throw new Error(`${label}: ${kind} aggregates do not match declaration records`);
  }
}

function addDeclarationCount(counts, declaration) {
  counts.total += 1;
  if (declaration.runnable) {
    counts.runnable += 1;
  } else {
    counts.blocked += 1;
  }
  const field = {
    publicConstant: "publicTotal",
    privateConstant: "privateTotal",
    boxed: "boxedTotal",
    generated: "generatedTotal",
  }[declaration.kind];
  if (field === undefined) throw new Error(`unknown declaration kind ${JSON.stringify(declaration.kind)}`);
  counts[field] += 1;
  if (declaration.runnable && declaration.kind === "publicConstant") counts.publicRunnable += 1;
}

function addCounts(target, source) {
  for (const field of COUNT_FIELDS) target[field] += source[field];
}

function sameCounts(lhs, rhs) {
  return COUNT_FIELDS.every((field) => lhs[field] === rhs[field]);
}

function versionList(versions) {
  if (versions.length === 1) return String(versions[0]);
  return `${versions.slice(0, -1).join(", ")} or ${versions.at(-1)}`;
}
