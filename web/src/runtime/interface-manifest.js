/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { formatInterfaceEffectPrefix, requireInterfaceEffect } from "./interface-effects.js";
import { SUPPORTED_WIRE_TAGS, WIRE } from "./wire-tags.js";

export const INTERFACE_MANIFEST_ARTIFACT = "lean-vir-ir-package";
export const INTERFACE_MANIFEST_VERSION = 2;
export const HOST_IMPORT_BOUNDARY = Object.freeze({
  WIRE: "wire",
  CONVERSION: "conversion",
});

export const INTERFACE_MANIFEST_SHAPE_ERROR =
  "embedded interface manifest must be { version: 2, metadata: {...}, exports: [...] }";

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

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a non-negative 32-bit integer`);
  }
}

export function validateInterfaceManifest(manifest) {
  if (!isRecord(manifest) ||
      manifest.version !== INTERFACE_MANIFEST_VERSION ||
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
  if (manifest.hostImports !== undefined && !Array.isArray(manifest.hostImports)) {
    throw new Error("embedded interface manifest hostImports must be an array");
  }
  validateManifestExports(manifest.exports);
  validateManifestHostImports(manifest.hostImports ?? []);
  return manifest;
}

function validateManifestExports(exports) {
  const entries = new Set();
  const ids = new Set();
  const jsNames = new Set();
  exports.forEach((entry, index) => {
    const label = `embedded interface manifest exports[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${label} must be an object`);
    }
    requireString(entry.entry, `${label}.entry`);
    requireOptionalString(entry.id, `${label}.id`);
    requireOptionalString(entry.jsName, `${label}.jsName`);
    requireOptionalString(entry.source, `${label}.source`);
    requireInterfaceEffect(entry.effect, `${label}.effect`);
    requireUnique(entries, entry.entry, `${label}.entry`);
    if (entry.id !== undefined) requireUnique(ids, entry.id, `${label}.id`);
    if (entry.jsName !== undefined) requireUnique(jsNames, entry.jsName, `${label}.jsName`);
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
  });
}

function validateManifestHostImports(hostImports) {
  hostImports.forEach((entry, index) => {
    const label = `embedded interface manifest hostImports[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${label} must be an object`);
    }
    requireInterfaceEffect(entry.effect, `${label}.effect`);
    requireHostImportBoundary(entry.boundary, `${label}.boundary`);
  });
}

function requireHostImportBoundary(value, label) {
  if (!Object.values(HOST_IMPORT_BOUNDARY).includes(value)) {
    throw new Error(`${label} must be wire or conversion`);
  }
}

function requireUnique(seen, value, label, owner = "interface export") {
  if (seen.has(value)) {
    throw new Error(`${label} duplicates another ${owner}`);
  }
  seen.add(value);
}

export function validateInterfaceType(type, label = "interface type") {
  if (!isRecord(type)) {
    throw new Error(`${label} must be an object`);
  }
  requireString(type.type, `${label}.type`);
  if (!Number.isInteger(type.wireTag) || !SUPPORTED_WIRE_TAGS.has(type.wireTag)) {
    throw new Error(`${label}.wireTag is not supported`);
  }
  switch (type.wireTag) {
    case WIRE.SIMPLE_ENUM:
      validateSimpleEnumType(type, label);
      break;
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
      validateInterfaceType(type.element, `${label}.element`);
      break;
    case WIRE.PROD:
      validateInterfaceType(type.fst, `${label}.fst`);
      validateInterfaceType(type.snd, `${label}.snd`);
      break;
    case WIRE.STRUCTURE:
      validateStructureType(type, label);
      break;
    case WIRE.TAGGED_UNION:
      validateTaggedUnionType(type, label);
      break;
    case WIRE.CUSTOM_INDUCTIVE:
      validateCustomInductiveType(type, label);
      break;
    case WIRE.RECURSIVE_SELF:
      validateRecursiveSelfType(type, label);
      break;
    case WIRE.RESOURCE:
      validateResourceType(type, label);
      break;
    case WIRE.FUNCTION:
      validateFunctionType(type, label);
      break;
    default:
      break;
  }
  return type;
}

function validateInterfaceRootType(type, label) {
  validateInterfaceType(type, label);
  validateNoDanglingRecursiveSelf(type, label);
}

function validateSimpleEnumType(type, label) {
  if (type.kind !== "simpleEnum") {
    throw new Error(`${label}.kind must be simpleEnum`);
  }
  if (!Array.isArray(type.constructors) || type.constructors.length === 0) {
    throw new Error(`${label}.constructors must be a non-empty array`);
  }
  const names = new Set();
  const jsNames = new Set();
  type.constructors.forEach((ctor, index) => {
    validateConstructorHeader(ctor, index, label, names, jsNames);
  });
}

function validateStructureType(type, label) {
  if (type.kind !== "structure") {
    throw new Error(`${label}.kind must be structure`);
  }
  requireString(type.name, `${label}.name`);
  validateRuntimeCounts(type, label);
  if (!Array.isArray(type.fields) || type.fields.length === 0) {
    throw new Error(`${label}.fields must be a non-empty array`);
  }
  if (type.trivialFieldIndex !== undefined) {
    if (!Number.isInteger(type.trivialFieldIndex) ||
        type.trivialFieldIndex < 0 ||
        type.trivialFieldIndex >= type.fields.length) {
      throw new Error(`${label}.trivialFieldIndex is out of range`);
    }
  }
  const names = new Set();
  type.fields.forEach((field, index) => {
    const fieldLabel = `${label}.fields[${index}]`;
    validateInterfaceField(field, fieldLabel, names, type, type.name);
    if (field.subobject !== undefined && typeof field.subobject !== "boolean") {
      throw new Error(`${fieldLabel}.subobject must be a boolean`);
    }
    if (field.subobject === true) {
      if (field.type?.wireTag !== WIRE.STRUCTURE) {
        throw new Error(`${fieldLabel}.subobject field type must be a structure`);
      }
      if (field.layout?.kind !== "object") {
        throw new Error(`${fieldLabel}.subobject field layout must be object`);
      }
    }
  });
  validateFlattenedStructureFields(type, label);
}

function validateStructureFieldLayout(layout, structureType, label) {
  if (!isRecord(layout)) {
    throw new Error(`${label} must be an object`);
  }
  switch (layout.kind) {
    case "object":
      requireNonNegativeInteger(layout.index, `${label}.index`);
      if (layout.index >= structureType.objectFieldCount) {
        throw new Error(`${label}.index is outside objectFieldCount`);
      }
      break;
    case "usize":
      requireNonNegativeInteger(layout.index, `${label}.index`);
      if (layout.index < structureType.objectFieldCount ||
          layout.index >= structureType.objectFieldCount + structureType.usizeFieldCount) {
        throw new Error(`${label}.index is outside usize slot range`);
      }
      break;
    case "scalar":
      requireNonNegativeInteger(layout.size, `${label}.size`);
      requireNonNegativeInteger(layout.offset, `${label}.offset`);
      if (layout.size === 0 || layout.offset + layout.size > structureType.scalarByteSize) {
        throw new Error(`${label} is outside scalarByteSize`);
      }
      break;
    default:
      throw new Error(`${label}.kind is not supported`);
  }
}

function validateTaggedUnionType(type, label) {
  if (type.kind !== "taggedUnion") {
    throw new Error(`${label}.kind must be taggedUnion`);
  }
  requireString(type.name, `${label}.name`);
  if (!Array.isArray(type.constructors) || type.constructors.length === 0) {
    throw new Error(`${label}.constructors must be a non-empty array`);
  }
  const names = new Set();
  const jsNames = new Set();
  type.constructors.forEach((ctor, index) => {
    const ctorLabel = validateConstructorHeader(ctor, index, label, names, jsNames);
    validateRuntimeCounts(ctor, ctorLabel);
    validateStructureFieldLayout(ctor.layout, ctor, `${ctorLabel}.layout`);
    validateInterfaceType(ctor.type, `${ctorLabel}.type`);
  });
}

function validateCustomInductiveType(type, label) {
  if (type.kind !== "customInductive") {
    throw new Error(`${label}.kind must be customInductive`);
  }
  requireString(type.name, `${label}.name`);
  if (!Array.isArray(type.constructors) || type.constructors.length === 0) {
    throw new Error(`${label}.constructors must be a non-empty array`);
  }
  const names = new Set();
  const jsNames = new Set();
  type.constructors.forEach((ctor, index) => {
    const ctorLabel = validateConstructorHeader(ctor, index, label, names, jsNames);
    validateRuntimeCounts(ctor, ctorLabel);
    if (!Array.isArray(ctor.fields)) {
      throw new Error(`${ctorLabel}.fields must be an array`);
    }
    if (ctor.fields.length === 0 &&
        (ctor.objectFieldCount !== 0 || ctor.usizeFieldCount !== 0 || ctor.scalarByteSize !== 0)) {
      throw new Error(`${ctorLabel} with no fields must have zero runtime field counts`);
    }
    const fieldNames = new Set();
    ctor.fields.forEach((field, fieldIndex) => {
      const fieldLabel = `${ctorLabel}.fields[${fieldIndex}]`;
      validateInterfaceField(field, fieldLabel, fieldNames, ctor, type.name);
    });
  });
}

function validateConstructorHeader(ctor, index, label, names, jsNames) {
  const ctorLabel = `${label}.constructors[${index}]`;
  if (!isRecord(ctor)) {
    throw new Error(`${ctorLabel} must be an object`);
  }
  requireString(ctor.name, `${ctorLabel}.name`);
  requireString(ctor.jsName, `${ctorLabel}.jsName`);
  if (ctor.tag !== index) {
    throw new Error(`${ctorLabel}.tag must be ${index}`);
  }
  requireUnique(names, ctor.name, `${ctorLabel}.name`, "constructor");
  requireUnique(jsNames, ctor.jsName, `${ctorLabel}.jsName`, "constructor");
  return ctorLabel;
}

function validateRuntimeCounts(type, label) {
  requireNonNegativeInteger(type.objectFieldCount, `${label}.objectFieldCount`);
  requireNonNegativeInteger(type.usizeFieldCount, `${label}.usizeFieldCount`);
  requireNonNegativeInteger(type.scalarByteSize, `${label}.scalarByteSize`);
}

function validateInterfaceField(field, fieldLabel, names, layoutOwner, recursiveOwnerName) {
  if (!isRecord(field)) {
    throw new Error(`${fieldLabel} must be an object`);
  }
  requireString(field.name, `${fieldLabel}.name`);
  requireUnique(names, field.name, `${fieldLabel}.name`, "field");
  validateStructureFieldLayout(field.layout, layoutOwner, `${fieldLabel}.layout`);
  validateInterfaceType(field.type, `${fieldLabel}.type`);
  validateRecursiveSelfOwner(field.type, recursiveOwnerName, `${fieldLabel}.type`);
}

function validateRecursiveSelfType(type, label) {
  if (type.kind !== "recursiveSelf") {
    throw new Error(`${label}.kind must be recursiveSelf`);
  }
  requireString(type.name, `${label}.name`);
}

function validateRecursiveSelfOwner(type, ownerName, label) {
  switch (type?.wireTag) {
    case WIRE.RECURSIVE_SELF:
      if (type.name !== ownerName) {
        throw new Error(`${label}.name must match ${ownerName}`);
      }
      break;
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
      validateRecursiveSelfOwner(type.element, ownerName, `${label}.element`);
      break;
    case WIRE.PROD:
      validateRecursiveSelfOwner(type.fst, ownerName, `${label}.fst`);
      validateRecursiveSelfOwner(type.snd, ownerName, `${label}.snd`);
      break;
    case WIRE.STRUCTURE:
      // A complete nested structure descriptor owns any recursiveSelf markers
      // below it; validateStructureType has already checked that owner locally.
      break;
    case WIRE.TAGGED_UNION:
      for (const ctor of type.constructors ?? []) {
        validateRecursiveSelfOwner(ctor.type, ownerName, `${label}.${ctor.jsName}`);
      }
      break;
    case WIRE.CUSTOM_INDUCTIVE:
      // A complete nested custom inductive descriptor owns any recursiveSelf
      // markers below it; validateCustomInductiveType has checked them locally.
      break;
    case WIRE.FUNCTION:
      for (const arg of type.args ?? []) {
        validateRecursiveSelfOwner(arg.type, ownerName, `${label}.${arg.name}`);
      }
      validateRecursiveSelfOwner(type.result, ownerName, `${label}.result`);
      break;
    default:
      break;
  }
}

function validateNoDanglingRecursiveSelf(type, label) {
  switch (type?.wireTag) {
    case WIRE.RECURSIVE_SELF:
      throw new Error(`${label} cannot be recursiveSelf outside a recursive descriptor`);
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
      validateNoDanglingRecursiveSelf(type.element, `${label}.element`);
      break;
    case WIRE.PROD:
      validateNoDanglingRecursiveSelf(type.fst, `${label}.fst`);
      validateNoDanglingRecursiveSelf(type.snd, `${label}.snd`);
      break;
    case WIRE.TAGGED_UNION:
      for (const ctor of type.constructors ?? []) {
        validateNoDanglingRecursiveSelf(ctor.type, `${label}.${ctor.jsName}`);
      }
      break;
    case WIRE.FUNCTION:
      for (const arg of type.args ?? []) {
        validateNoDanglingRecursiveSelf(arg.type, `${label}.${arg.name}`);
      }
      validateNoDanglingRecursiveSelf(type.result, `${label}.result`);
      break;
    default:
      break;
  }
}

function validateResourceType(type, label) {
  if (type.kind !== "resource") {
    throw new Error(`${label}.kind must be resource`);
  }
  requireString(type.name, `${label}.name`);
}

function validateFunctionType(type, label) {
  if (type.kind !== "function") {
    throw new Error(`${label}.kind must be function`);
  }
  requireInterfaceEffect(type.effect, `${label}.effect`);
  if (!Array.isArray(type.args)) {
    throw new Error(`${label}.args must be an array`);
  }
  type.args.forEach((arg, index) => {
    const argLabel = `${label}.args[${index}]`;
    if (!isRecord(arg)) {
      throw new Error(`${argLabel} must be an object`);
    }
    requireString(arg.name, `${argLabel}.name`);
    validateInterfaceType(arg.type, `${argLabel}.type`);
  });
  validateInterfaceType(type.result, `${label}.result`);
}

function validateFlattenedStructureFields(type, label) {
  const names = new Set();
  type.fields.forEach((field, index) => {
    const fieldLabel = `${label}.fields[${index}]`;
    if (field.subobject === true) {
      for (const name of flattenedStructureFieldNames(field.type)) {
        requireUniqueStructureField(names, name, `${fieldLabel}.subobject.${name}`);
      }
    } else {
      requireUniqueStructureField(names, field.name, `${fieldLabel}.name`);
    }
  });
}

function flattenedStructureFieldNames(type) {
  const names = [];
  for (const field of type?.fields ?? []) {
    if (field.subobject === true) {
      names.push(...flattenedStructureFieldNames(field.type));
    } else {
      names.push(field.name);
    }
  }
  return names;
}

function requireUniqueStructureField(seen, value, label) {
  if (seen.has(value)) {
    throw new Error(`${label} duplicates another flattened structure field`);
  }
  seen.add(value);
}

export function manifestDiagnostics(manifest) {
  return Array.isArray(manifest?.diagnostics) ? manifest.diagnostics : [];
}

export function formatInterfaceType(type) {
  switch (type?.wireTag) {
    case WIRE.UNIT:
      return "Unit";
    case WIRE.SIMPLE_ENUM:
      return type.type ?? "Enum";
    case WIRE.ARRAY:
      return `Array<${formatInterfaceType(type.element)}>`;
    case WIRE.LIST:
      return `List<${formatInterfaceType(type.element)}>`;
    case WIRE.OPTION:
      return `Option<${formatInterfaceType(type.element)}>`;
    case WIRE.PROD:
      return `Prod<${formatInterfaceType(type.fst)}, ${formatInterfaceType(type.snd)}>`;
    case WIRE.STRUCTURE:
      return type.type ?? type.name ?? "Structure";
    case WIRE.TAGGED_UNION:
      return type.type ?? type.name ?? "TaggedUnion";
    case WIRE.CUSTOM_INDUCTIVE:
    case WIRE.RECURSIVE_SELF:
      return type.type ?? type.name ?? "Recursive";
    case WIRE.RESOURCE:
      return type.type ?? type.name ?? "Resource";
    case WIRE.FUNCTION:
      return `(${(type.args ?? []).map((arg) => formatInterfaceType(arg.type)).join(", ")}) -> ${formatInterfaceEffectPrefix(type.effect)}${formatInterfaceType(type.result)}`;
    default:
      return type?.type ?? `wireTag ${type?.wireTag ?? "?"}`;
  }
}
