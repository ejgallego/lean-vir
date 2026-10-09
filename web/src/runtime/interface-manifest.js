/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  interfaceEffectRuntimeTag,
  requireInterfaceEffect,
} from "./interface-effects.js";
import { validateBoundaryInterface, boundaryInterfaceShape, formatBoundaryInterface } from "./value-interfaces.js";
import { validatePackageTargets } from "./package-targets.js";
import { requireModuleIdentity } from "./module-name.js";

export const INTERFACE_MANIFEST_ARTIFACT = "lean-vir-ir-package";
export const INTERFACE_MANIFEST_VERSION = 12;
export const HOST_IMPORT_BOUNDARY = Object.freeze({
  HOST_RESOURCE: "hostResource",
  EXPLICIT_CONVERSION: "explicitConversion",
  OBJECT_HANDLE: "objectHandle",
});

export const INTERFACE_MANIFEST_SHAPE_ERROR =
  `embedded interface manifest must be { version: ${INTERFACE_MANIFEST_VERSION}, metadata: {...}, exports: [...] }; ` +
  "regenerate packages with the matching SDK";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireOptionalString(value, label) {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
}

// Machine identity is independent of the public entry text and host display names.
function requireNameKey(value, label) {
  if (typeof value !== "string" || !/^(?:s(?:[0-9a-f]{2})*\/|n(?:0|[1-9][0-9]*)\/)*$/.test(value)) {
    throw new Error(`${label} must be a canonical structural Lean name key`);
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const part of value.split("/")) {
      if (part.startsWith("s")) {
        const bytes = Uint8Array.from(part.slice(1).match(/../g) ?? [], byte => parseInt(byte, 16));
        decoder.decode(bytes);
      }
    }
  } catch {
    throw new Error(`${label} contains invalid UTF-8 in a structural Lean name key`);
  }
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a non-negative 32-bit integer`);
  }
}

export function validateInterfaceManifest(
  manifest,
  { packageFormatVersion = null } = {},
) {
  if (
    !isRecord(manifest) ||
    !Number.isInteger(manifest.version) ||
    manifest.version !== INTERFACE_MANIFEST_VERSION ||
    !isRecord(manifest.metadata) ||
    !Array.isArray(manifest.exports)
  ) {
    throw new Error(INTERFACE_MANIFEST_SHAPE_ERROR);
  }
  if (
    manifest.artifact !== undefined &&
    manifest.artifact !== INTERFACE_MANIFEST_ARTIFACT
  ) {
    throw new Error(
      `embedded interface manifest artifact must be ${INTERFACE_MANIFEST_ARTIFACT}`,
    );
  }
  if (
    manifest.diagnostics !== undefined &&
    !Array.isArray(manifest.diagnostics)
  ) {
    throw new Error("embedded interface manifest diagnostics must be an array");
  }
  if (
    manifest.hostImports !== undefined &&
    !Array.isArray(manifest.hostImports)
  ) {
    throw new Error("embedded interface manifest hostImports must be an array");
  }
  validateManifestMetadata(
    manifest.metadata,
    manifest.version,
    packageFormatVersion,
  );
  const exports = manifest.exports;
  validateManifestExports(exports);
  const hostImports = manifest.hostImports ?? [];
  validateManifestHostImports(hostImports);
  validatePackageSetSurface(
    manifest.metadata.packageSetMember,
    exports,
    hostImports,
  );
  return manifest;
}

function validateManifestMetadata(
  metadata,
  manifestVersion,
  packageFormatVersion,
) {
  const label = "embedded interface manifest metadata";
  for (const field of [
    "generator",
    "leanVersion",
    "leanToolchain",
    "leanGithash",
  ]) {
    if (metadata[field] !== undefined)
      requireString(metadata[field], `${label}.${field}`);
  }
  for (const field of ["packageFormatVersion", "manifestVersion"]) {
    if (metadata[field] !== undefined) {
      requireNonNegativeInteger(metadata[field], `${label}.${field}`);
    }
  }
  if (
    metadata.manifestVersion !== undefined &&
    metadata.manifestVersion !== manifestVersion
  ) {
    throw new Error(`${label}.manifestVersion must match manifest.version`);
  }
  if (
    packageFormatVersion !== null &&
    metadata.packageFormatVersion !== packageFormatVersion
  ) {
    throw new Error(
      `${label}.packageFormatVersion must match package header version ${packageFormatVersion}`,
    );
  }
  validatePackageTargets(metadata.targets, `${label}.targets`);
  validatePackageSetMember(metadata.packageSetMember, metadata.targets, label);
}

function validateManifestExports(exports) {
  const entries = new Set();
  const identities = new Set();
  exports.forEach((entry, index) => {
    const label = `embedded interface manifest exports[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${label} must be an object`);
    }
    requireString(entry.entry, `${label}.entry`);
    requireUnique(entries, entry.entry, `${label}.entry`);
    for (const field of ["id", "jsName"]) {
      if (Object.hasOwn(entry, field)) {
        throw new Error(`${label}.${field} is retired; use the full Lean entry name`);
      }
    }
    requireOptionalString(entry.source, `${label}.source`);
    requireInterfaceEffect(entry.effect, `${label}.effect`);
    if (typeof entry.startup !== "boolean") {
      throw new Error(`${label}.startup must be a boolean`);
    }
    if (!Array.isArray(entry.args)) {
      throw new Error(`${label}.args must be an array`);
    }
    entry.args.forEach((arg, argIndex) => {
      const argLabel = `${label}.args[${argIndex}]`;
      if (!isRecord(arg)) {
        throw new Error(`${argLabel} must be an object`);
      }
      requireString(arg.name, `${argLabel}.name`);
      validateInterfaceRootType(arg.type, `${argLabel}.type`);
    });
    validateInterfaceRootType(entry.result, `${label}.result`);
    requireNameKey(entry.nameKey, `${label}.nameKey`);
    requireUnique(identities, entry.nameKey, `${label}.nameKey`);
  });
}

function validatePackageSetMember(member, targets, metadataLabel) {
  if (member === undefined) return;
  const label = `${metadataLabel}.packageSetMember`;
  if (!isRecord(member)) {
    throw new Error(`${label} must be an object`);
  }
  requireModuleIdentity(member.module, label);
  if (member.role !== "dependency" && member.role !== "root") {
    throw new Error(`${label}.role must be dependency or root`);
  }
  const packageTargets = targets ?? [];
  if (member.role === "dependency" && packageTargets.length !== 0) {
    throw new Error(`${label} dependency members must not have public targets`);
  }
  if (member.role === "root") {
    if (packageTargets.length !== 1) {
      throw new Error(
        `${label} root member must have exactly one public target`,
      );
    }
    const [target] = packageTargets;
    if (target.mode === "markedModule" && target.module !== member.module) {
      throw new Error(
        `${label} root member must match its markedModule target`,
      );
    }
    if (target.mode !== "markedModule" && target.mode !== "marked") {
      throw new Error(
        `${label} root member target must use markedModule or marked mode`,
      );
    }
  }
}

function validatePackageSetSurface(member, exports, hostImports) {
  if (member?.role !== "dependency") return;
  if (exports.length !== 0 || hostImports.length !== 0) {
    throw new Error(
      "embedded interface manifest dependency package-set members must not expose exports or host imports",
    );
  }
}

function validateManifestHostImports(hostImports) {
  const identities = new Set();
  const symbolAliases = new Map();
  hostImports.forEach((entry, index) => {
    const label = `embedded interface manifest hostImports[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${label} must be an object`);
    }
    requireNonNegativeInteger(entry.slot, `${label}.slot`);
    if (entry.slot !== index) {
      throw new Error(`${label}.slot must be ${index}`);
    }
    for (const field of ["name", "source", "target", "symbol"]) {
      requireString(entry[field], `${label}.${field}`);
    }
    for (const alias of [entry.symbol, `${entry.symbol}___boxed`]) {
      const previous = symbolAliases.get(alias);
      if (previous !== undefined && previous !== index) {
        throw new Error(
          `${label}.symbol alias ${JSON.stringify(alias)} belongs to more than one host import (hostImports[${previous}])`,
        );
      }
      symbolAliases.set(alias, index);
    }
    requireNonNegativeInteger(entry.arity, `${label}.arity`);
    requireNonNegativeInteger(
      entry.erasedPrefixArgs,
      `${label}.erasedPrefixArgs`,
    );
    if (!Array.isArray(entry.args)) {
      throw new Error(`${label}.args must be an array`);
    }
    entry.args.forEach((arg, argIndex) => {
      const argLabel = `${label}.args[${argIndex}]`;
      if (!isRecord(arg)) {
        throw new Error(`${argLabel} must be an object`);
      }
      requireString(arg.name, `${argLabel}.name`);
      validateInterfaceRootType(arg.type, `${argLabel}.type`);
    });
    validateInterfaceRootType(entry.result, `${label}.result`);
    requireInterfaceEffect(entry.effect, `${label}.effect`);
    const expectedArity =
      entry.erasedPrefixArgs +
      entry.args.length +
      interfaceEffectRuntimeTag(entry.effect);
    if (entry.arity !== expectedArity) {
      throw new Error(
        `${label}.arity does not match erased arguments, value arguments, and effect (${expectedArity})`,
      );
    }
    requireHostImportBoundary(entry.boundary, `${label}.boundary`);
    requireNameKey(entry.nameKey, `${label}.nameKey`);
    requireUnique(identities, entry.nameKey, `${label}.nameKey`, "host import");
  });
}

function requireHostImportBoundary(value, label) {
  if (!Object.values(HOST_IMPORT_BOUNDARY).includes(value)) {
    throw new Error(
      `${label} must be hostResource, explicitConversion, or objectHandle`,
    );
  }
}

function requireUnique(seen, value, label, owner = "interface export") {
  if (seen.has(value)) {
    throw new Error(`${label} duplicates another ${owner}`);
  }
  seen.add(value);
}

export function validateInterfaceType(type, label = "interface type") {
  return validateBoundaryInterface(type, label);
}

function validateInterfaceRootType(type, label) {
  validateInterfaceType(type, label);
}

export function interfaceSignatureKey({ args, result, effect }) {
  if (!Array.isArray(args)) throw new TypeError("signature.args must be an array");
  requireInterfaceEffect(effect, "signature.effect");
  for (const arg of args) validateInterfaceRootType(arg, "signature argument");
  validateInterfaceRootType(result, "signature.result");
  return JSON.stringify([args.map(boundaryInterfaceShape), boundaryInterfaceShape(result), effect]);
}

export function manifestDiagnostics(manifest) {
  return Array.isArray(manifest?.diagnostics) ? manifest.diagnostics : [];
}

export function formatInterfaceType(type) {
  return formatBoundaryInterface(type);
}
