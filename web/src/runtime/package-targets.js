/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const PACKAGE_TARGET_MODE = Object.freeze({
  EXPLICIT: "explicit",
  PACKAGE_ONLY: "packageOnly",
  ALL: "all",
  MARKED: "marked",
  MARKED_MODULE: "markedModule",
});

const PACKAGE_TARGET_MODE_LABEL = Object.freeze({
  [PACKAGE_TARGET_MODE.EXPLICIT]: "explicit roots",
  [PACKAGE_TARGET_MODE.PACKAGE_ONLY]: "package-only roots",
  [PACKAGE_TARGET_MODE.ALL]: "public definitions",
  [PACKAGE_TARGET_MODE.MARKED]: "marked declarations",
  [PACKAGE_TARGET_MODE.MARKED_MODULE]: "marked module",
});

export function packageTargetModeLabel(mode) {
  return PACKAGE_TARGET_MODE_LABEL[mode] ?? null;
}

export function validatePackageTargets(
  targets,
  label,
  { manifestVersion = null } = {},
) {
  if (targets === undefined) return;
  if (!Array.isArray(targets)) {
    throw new Error(`${label} must be an array`);
  }
  targets.forEach((target, index) => {
    const targetLabel = `${label}[${index}]`;
    if (
      target === null ||
      typeof target !== "object" ||
      Array.isArray(target)
    ) {
      throw new Error(`${targetLabel} must be an object`);
    }
    const legacyMarkedModule =
      manifestVersion !== null &&
      manifestVersion < 8 &&
      target.mode === "markedModules";
    if (packageTargetModeLabel(target.mode) === null && !legacyMarkedModule) {
      throw new Error(
        `${targetLabel}.mode must be one of ${Object.values(PACKAGE_TARGET_MODE).join(", ")}`,
      );
    }
    const hasSource = target.source !== undefined;
    const hasModule = target.module !== undefined;
    if (hasSource === hasModule) {
      throw new Error(
        `${targetLabel} must have exactly one of source or module`,
      );
    }
    if (hasSource)
      requireNormalizedString(target.source, `${targetLabel}.source`);
    if (hasModule)
      requireNormalizedString(target.module, `${targetLabel}.module`);
    if (target.mode === PACKAGE_TARGET_MODE.MARKED_MODULE && !hasModule) {
      throw new Error(`${targetLabel}.mode markedModule requires a module`);
    }
    if (target.mode !== PACKAGE_TARGET_MODE.MARKED_MODULE && hasModule) {
      throw new Error(`${targetLabel}.module requires mode markedModule`);
    }
    const roots = requireNameArray(target.roots, `${targetLabel}.roots`);
    requireNameArray(target.resolvedRoots, `${targetLabel}.resolvedRoots`);
    const explicitRoots =
      target.mode === PACKAGE_TARGET_MODE.EXPLICIT ||
      target.mode === PACKAGE_TARGET_MODE.PACKAGE_ONLY;
    if (explicitRoots && roots.length === 0) {
      throw new Error(
        `${targetLabel}.roots must be non-empty for ${target.mode}`,
      );
    }
    if (!explicitRoots && roots.length !== 0) {
      throw new Error(`${targetLabel}.roots must be empty for ${target.mode}`);
    }
  });
}

export function formatPackageTarget(target, { compact = false } = {}) {
  const source =
    typeof target?.module === "string"
      ? `module ${target.module}`
      : typeof target?.source === "string"
        ? target.source
        : "unknown";
  const mode = packageTargetModeLabel(target?.mode) ?? "unknown selection";
  const roots = Array.isArray(target?.resolvedRoots)
    ? target.resolvedRoots
    : [];
  if (compact) {
    return `${source} [${mode}; ${roots.length} root${roots.length === 1 ? "" : "s"}]`;
  }
  return `${source} [${mode}] roots: ${roots.length === 0 ? "(none)" : roots.join(", ")}`;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireNormalizedString(value, label) {
  requireNonEmptyString(value, label);
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be normalized`);
  }
}

function requireNameArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const names = new Set();
  value.forEach((name, index) => {
    requireNormalizedString(name, `${label}[${index}]`);
    if (names.has(name)) {
      throw new Error(`${label}[${index}] duplicates ${JSON.stringify(name)}`);
    }
    names.add(name);
  });
  return value;
}
