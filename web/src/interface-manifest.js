/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const INTERFACE_MANIFEST_ARTIFACT = "lean-vir-ir-package";

export const INTERFACE_MANIFEST_SHAPE_ERROR =
  "embedded interface manifest must be { version: 1, metadata: {...}, exports: [...] }";

const SUPPORTED_WIRE_TAGS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  14, 15, 16, 17, 18, 19, 20,
]);

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
  validateManifestExports(manifest.exports);
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
      validateInterfaceType(arg.type, `${argLabel}.type`);
    });
    validateInterfaceType(entry.result, `${label}.result`);
  });
}

function requireUnique(seen, value, label) {
  if (seen.has(value)) {
    throw new Error(`${label} duplicates another interface export`);
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
    case 14:
      validateSimpleEnumType(type, label);
      break;
    case 16:
    case 17:
    case 18:
      validateInterfaceType(type.element, `${label}.element`);
      break;
    case 19:
      validateInterfaceType(type.fst, `${label}.fst`);
      validateInterfaceType(type.snd, `${label}.snd`);
      break;
    case 20:
      validateStructureType(type, label);
      break;
    default:
      break;
  }
  return type;
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
    const ctorLabel = `${label}.constructors[${index}]`;
    if (!isRecord(ctor)) {
      throw new Error(`${ctorLabel} must be an object`);
    }
    requireString(ctor.name, `${ctorLabel}.name`);
    requireString(ctor.jsName, `${ctorLabel}.jsName`);
    if (ctor.tag !== index) {
      throw new Error(`${ctorLabel}.tag must be ${index}`);
    }
    requireUnique(names, ctor.name, `${ctorLabel}.name`);
    requireUnique(jsNames, ctor.jsName, `${ctorLabel}.jsName`);
  });
}

function validateStructureType(type, label) {
  if (type.kind !== "structure") {
    throw new Error(`${label}.kind must be structure`);
  }
  requireString(type.name, `${label}.name`);
  requireNonNegativeInteger(type.objectFieldCount, `${label}.objectFieldCount`);
  requireNonNegativeInteger(type.usizeFieldCount, `${label}.usizeFieldCount`);
  requireNonNegativeInteger(type.scalarByteSize, `${label}.scalarByteSize`);
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
    if (!isRecord(field)) {
      throw new Error(`${fieldLabel} must be an object`);
    }
    requireString(field.name, `${fieldLabel}.name`);
    requireUnique(names, field.name, `${fieldLabel}.name`);
    if (field.subobject !== undefined && typeof field.subobject !== "boolean") {
      throw new Error(`${fieldLabel}.subobject must be a boolean`);
    }
    validateStructureFieldLayout(field.layout, type, `${fieldLabel}.layout`);
    validateInterfaceType(field.type, `${fieldLabel}.type`);
    if (field.subobject === true) {
      if (field.type?.wireTag !== 20) {
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
    case 20:
      return type.type ?? type.name ?? "Structure";
    default:
      return type?.type ?? `wireTag ${type?.wireTag ?? "?"}`;
  }
}
