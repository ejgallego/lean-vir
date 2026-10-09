/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  formatInterfaceEffectPrefix,
  interfaceEffectRuntimeTag,
  requireInterfaceEffect,
} from "./interface-effects.js";
import { SUPPORTED_INTERFACE_TAGS, INTERFACE_TAG } from "./interface-tags.js";
import { validatePackageTargets } from "./package-targets.js";
import { requireModuleIdentity } from "./module-name.js";

export const INTERFACE_MANIFEST_ARTIFACT = "lean-vir-ir-package";
export const INTERFACE_MANIFEST_VERSION = 10;
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

// Machine identity is independent of the user-facing display/call aliases.
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
  const aliases = new Map();
  const identities = new Set();
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
    if (typeof entry.startup !== "boolean") {
      throw new Error(`${label}.startup must be a boolean`);
    }
    // call(name) shares one namespace across all three spellings. Repeating a
    // spelling for the same export is fine; selecting two exports is ambiguous.
    for (const field of ["entry", "id", "jsName"]) {
      const alias = entry[field];
      if (alias === undefined || alias === "") continue;
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== index) {
        throw new Error(
          `${label}.${field} duplicates another interface export alias ${JSON.stringify(alias)} (exports[${previous}])`,
        );
      }
      aliases.set(alias, index);
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
  validateTypeDescriptor(type, label);
  validateRecursiveReferences(type, [], label);
  return type;
}

function validateTypeDescriptor(type, label) {
  if (!isRecord(type)) {
    throw new Error(`${label} must be an object`);
  }
  requireString(type.type, `${label}.type`);
  if (
    !Number.isInteger(type.interfaceTag) ||
    !SUPPORTED_INTERFACE_TAGS.has(type.interfaceTag)
  ) {
    throw new Error(`${label}.interfaceTag is not supported`);
  }
  switch (type.interfaceTag) {
    case INTERFACE_TAG.SIMPLE_ENUM:
      validateSimpleEnumType(type, label);
      break;
    case INTERFACE_TAG.ARRAY:
      validateTypeDescriptor(type.element, `${label}.element`);
      break;
    case INTERFACE_TAG.STRUCTURE:
      validateStructureType(type, label);
      break;
    case INTERFACE_TAG.TAGGED_UNION:
      validateTaggedUnionType(type, label);
      break;
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      validateCustomInductiveType(type, label);
      break;
    case INTERFACE_TAG.RECURSIVE_REF:
      validateRecursiveRefType(type, label);
      break;
    case INTERFACE_TAG.RESOURCE:
      validateResourceType(type, label);
      break;
    case INTERFACE_TAG.FUNCTION:
      validateFunctionType(type, label);
      break;
    case INTERFACE_TAG.LEAN_OBJECT:
      validateLeanObjectType(type, label);
      break;
    default:
      break;
  }
  return type;
}

function validateInterfaceRootType(type, label) {
  validateInterfaceType(type, label);
}

// A comparison key for the existing callable ABI, not a second type grammar.
// Keep validation here beside the format authority. Parameter display names and
// diagnostic extensions are not ABI identity; ordered fields/layouts are.
export function interfaceSignatureKey({ args, result, effect }) {
  if (!Array.isArray(args)) throw new TypeError("signature.args must be an array");
  requireInterfaceEffect(effect, "signature.effect");
  for (const arg of args) validateInterfaceRootType(arg, "signature argument");
  validateInterfaceRootType(result, "signature.result");
  return JSON.stringify([args.map(interfaceTypeShape), interfaceTypeShape(result), effect]);
}

function interfaceTypeShape(type) {
  const counts = owner => [owner.objectFieldCount, owner.usizeFieldCount, owner.scalarByteSize];
  const layout = value => [value.kind, value.index ?? null, value.offset ?? null, value.size ?? null];
  const header = ctor => [ctor.name, ctor.jsName, ctor.tag];
  const fields = owner => owner.fields.map(field => [field.name,
    interfaceTypeShape(field.type), layout(field.layout), field.subobject === true]);
  const base = [type.type, type.interfaceTag];
  switch (type.interfaceTag) {
    case INTERFACE_TAG.SIMPLE_ENUM:
      return [...base, type.kind, type.constructors.map(header)];
    case INTERFACE_TAG.ARRAY:
      return [...base, interfaceTypeShape(type.element)];
    case INTERFACE_TAG.STRUCTURE:
      return [...base, type.kind, type.name, counts(type), type.trivialFieldIndex ?? null, fields(type)];
    case INTERFACE_TAG.TAGGED_UNION:
      return [...base, type.kind, type.name, type.constructors.map(ctor =>
        [header(ctor), counts(ctor), layout(ctor.layout), interfaceTypeShape(ctor.type)])];
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return [...base, type.kind, type.name, type.constructors.map(ctor =>
        [header(ctor), counts(ctor), fields(ctor)])];
    case INTERFACE_TAG.RECURSIVE_REF:
      return [...base, type.kind, type.name, type.depth];
    case INTERFACE_TAG.RESOURCE:
      return [...base, type.kind, type.name];
    case INTERFACE_TAG.FUNCTION:
      return [...base, type.kind, type.effect,
        type.args.map(arg => interfaceTypeShape(arg.type)), interfaceTypeShape(type.result)];
    case INTERFACE_TAG.LEAN_OBJECT:
      return [...base, type.kind];
    case INTERFACE_TAG.NAT:
    case INTERFACE_TAG.INT:
    case INTERFACE_TAG.BOOL:
    case INTERFACE_TAG.STRING:
    case INTERFACE_TAG.UINT8:
    case INTERFACE_TAG.UINT16:
    case INTERFACE_TAG.UINT32:
    case INTERFACE_TAG.UINT64:
    case INTERFACE_TAG.USIZE:
    case INTERFACE_TAG.BYTE_ARRAY:
    case INTERFACE_TAG.FLOAT:
    case INTERFACE_TAG.FLOAT32:
    case INTERFACE_TAG.EXPR:
    case INTERFACE_TAG.UNIT:
      return base;
    default:
      throw new Error("signature comparison does not support this interface tag");
  }
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
    if (
      !Number.isInteger(type.trivialFieldIndex) ||
      type.trivialFieldIndex < 0 ||
      type.trivialFieldIndex >= type.fields.length
    ) {
      throw new Error(`${label}.trivialFieldIndex is out of range`);
    }
  }
  const names = new Set();
  type.fields.forEach((field, index) => {
    const fieldLabel = `${label}.fields[${index}]`;
    validateInterfaceField(field, fieldLabel, names, type);
    if (field.subobject !== undefined && typeof field.subobject !== "boolean") {
      throw new Error(`${fieldLabel}.subobject must be a boolean`);
    }
    if (field.subobject === true) {
      if (field.type?.interfaceTag !== INTERFACE_TAG.STRUCTURE) {
        throw new Error(
          `${fieldLabel}.subobject field type must be a structure`,
        );
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
      if (
        layout.index < structureType.objectFieldCount ||
        layout.index >=
          structureType.objectFieldCount + structureType.usizeFieldCount
      ) {
        throw new Error(`${label}.index is outside usize slot range`);
      }
      break;
    case "scalar":
      requireNonNegativeInteger(layout.size, `${label}.size`);
      requireNonNegativeInteger(layout.offset, `${label}.offset`);
      if (
        layout.size === 0 ||
        layout.offset + layout.size > structureType.scalarByteSize
      ) {
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
    const ctorLabel = validateConstructorHeader(
      ctor,
      index,
      label,
      names,
      jsNames,
    );
    validateRuntimeCounts(ctor, ctorLabel);
    validateStructureFieldLayout(ctor.layout, ctor, `${ctorLabel}.layout`);
    validateTypeDescriptor(ctor.type, `${ctorLabel}.type`);
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
    const ctorLabel = validateConstructorHeader(
      ctor,
      index,
      label,
      names,
      jsNames,
    );
    validateRuntimeCounts(ctor, ctorLabel);
    if (!Array.isArray(ctor.fields)) {
      throw new Error(`${ctorLabel}.fields must be an array`);
    }
    if (
      ctor.fields.length === 0 &&
      (ctor.objectFieldCount !== 0 ||
        ctor.usizeFieldCount !== 0 ||
        ctor.scalarByteSize !== 0)
    ) {
      throw new Error(
        `${ctorLabel} with no fields must have zero runtime field counts`,
      );
    }
    const fieldNames = new Set();
    ctor.fields.forEach((field, fieldIndex) => {
      const fieldLabel = `${ctorLabel}.fields[${fieldIndex}]`;
      validateInterfaceField(field, fieldLabel, fieldNames, ctor);
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

function validateInterfaceField(
  field,
  fieldLabel,
  names,
  layoutOwner,
) {
  if (!isRecord(field)) {
    throw new Error(`${fieldLabel} must be an object`);
  }
  requireString(field.name, `${fieldLabel}.name`);
  requireUnique(names, field.name, `${fieldLabel}.name`, "field");
  validateStructureFieldLayout(
    field.layout,
    layoutOwner,
    `${fieldLabel}.layout`,
  );
  validateTypeDescriptor(field.type, `${fieldLabel}.type`);

}

function validateRecursiveRefType(type, label) {
  if (type.kind !== "recursiveRef") {
    throw new Error(`${label}.kind must be recursiveRef`);
  }
  requireString(type.name, `${label}.name`);
  requireNonNegativeInteger(type.depth, `${label}.depth`);
}

// One lexical ownership check at admission. Complete aggregates bind a type;
// transparent arrays/Sum/Except keep the enclosing scopes. Callback signatures
// must be closed independently of the object that captures the callback.
function validateRecursiveReferences(type, owners, label) {
  switch (type.interfaceTag) {
    case INTERFACE_TAG.RECURSIVE_REF: {
      const owner = owners[type.depth];
      if (owner === undefined) throw new Error(`${label}.depth has no enclosing recursive descriptor`);
      if (owner.name !== type.name) throw new Error(`${label}.name must match ${owner.name}`);
      break;
    }
    case INTERFACE_TAG.ARRAY:
      validateRecursiveReferences(type.element, owners, `${label}.element`);
      break;
    case INTERFACE_TAG.STRUCTURE:
      for (const field of type.fields) validateRecursiveReferences(field.type, [type, ...owners], `${label}.${field.name}`);
      break;
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      for (const ctor of type.constructors) for (const field of ctor.fields)
        validateRecursiveReferences(field.type, [type, ...owners], `${label}.${ctor.jsName}.${field.name}`);
      break;
    case INTERFACE_TAG.TAGGED_UNION:
      for (const ctor of type.constructors) validateRecursiveReferences(ctor.type, owners, `${label}.${ctor.jsName}`);
      break;
    case INTERFACE_TAG.FUNCTION:
      for (const arg of type.args) validateRecursiveReferences(arg.type, [], `${label}.${arg.name}`);
      validateRecursiveReferences(type.result, [], `${label}.result`);
      break;
  }
}

function validateResourceType(type, label) {
  if (type.kind !== "resource") {
    throw new Error(`${label}.kind must be resource`);
  }
  requireString(type.name, `${label}.name`);
}

function validateLeanObjectType(type, label) {
  if (type.kind !== "leanObject") {
    throw new Error(`${label}.kind must be leanObject`);
  }
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
    validateTypeDescriptor(arg.type, `${argLabel}.type`);
  });
  validateTypeDescriptor(type.result, `${label}.result`);
}

function validateFlattenedStructureFields(type, label) {
  const names = new Set();
  type.fields.forEach((field, index) => {
    const fieldLabel = `${label}.fields[${index}]`;
    if (field.subobject === true) {
      for (const name of flattenedStructureFieldNames(field.type)) {
        requireUniqueStructureField(
          names,
          name,
          `${fieldLabel}.subobject.${name}`,
        );
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
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.UNIT:
      return "Unit";
    case INTERFACE_TAG.SIMPLE_ENUM:
      return type.type ?? "Enum";
    case INTERFACE_TAG.ARRAY:
      return `Array<${formatInterfaceType(type.element)}>`;
    case INTERFACE_TAG.STRUCTURE:
      return type.type ?? type.name ?? "Structure";
    case INTERFACE_TAG.TAGGED_UNION:
      return type.type ?? type.name ?? "TaggedUnion";
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
    case INTERFACE_TAG.RECURSIVE_REF:
      return type.type ?? type.name ?? "Recursive";
    case INTERFACE_TAG.RESOURCE:
      return type.type ?? type.name ?? "Resource";
    case INTERFACE_TAG.LEAN_OBJECT:
      return type.type ?? "LeanObject";
    case INTERFACE_TAG.FUNCTION:
      return `(${(type.args ?? []).map((arg) => formatInterfaceType(arg.type)).join(", ")}) -> ${formatInterfaceEffectPrefix(type.effect)}${formatInterfaceType(type.result)}`;
    default:
      return type?.type ?? `interfaceTag ${type?.interfaceTag ?? "?"}`;
  }
}
