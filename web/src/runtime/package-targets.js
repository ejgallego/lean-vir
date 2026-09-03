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
  MARKED_MODULE: "markedModules",
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

export function validatePackageTargets(targets, label) {
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
    requireNonEmptyString(target.source, `${targetLabel}.source`);
    if (packageTargetModeLabel(target.mode) === null) {
      throw new Error(
        `${targetLabel}.mode must be one of ${Object.values(PACKAGE_TARGET_MODE).join(", ")}`,
      );
    }
    requireNameArray(target.roots, `${targetLabel}.roots`);
    requireNameArray(target.resolvedRoots, `${targetLabel}.resolvedRoots`);
  });
}

export function formatPackageTarget(target, { compact = false } = {}) {
  const source = typeof target?.source === "string" ? target.source : "unknown";
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

function requireNameArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  value.forEach((name, index) =>
    requireNonEmptyString(name, `${label}[${index}]`),
  );
}
