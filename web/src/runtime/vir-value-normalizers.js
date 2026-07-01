/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  asBytes,
  customInductiveShape,
  customInductiveShapes,
  findCustomInductiveConstructor,
  findTaggedUnionConstructor,
  requireStructureFields,
  requireTaggedUnionConstructors,
  taggedUnionConstructorAt,
} from "./vir-codec.js";
import { WIRE } from "./wire-tags.js";

export function normalizeDecimal(value, label, { signed }) {
  if (typeof value === "bigint") {
    if (!signed && value < 0n) throw new Error(`${label} must be non-negative`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer or decimal string`);
    if (!signed && value < 0) throw new Error(`${label} must be non-negative`);
    return String(value);
  }
  if (typeof value === "string") {
    const pattern = signed ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(value.trim())) throw new Error(`${label} must be a decimal string`);
    return value.trim();
  }
  throw new Error(`${label} must be an integer, BigInt, or decimal string`);
}

export function normalizeBoundedUnsignedDecimal(value, label, max, typeName) {
  const decimal = normalizeDecimal(value, label, { signed: false });
  const normalized = BigInt(decimal);
  if (normalized > max) {
    throw new Error(`${label} is out of range for ${typeName}`);
  }
  return decimal;
}

export function normalizeBoundedUnsignedBigInt(value, label, max, typeName) {
  return BigInt(normalizeBoundedUnsignedDecimal(value, label, max, typeName));
}

export function normalizeFloat(value, label) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`${label} must be a number`);
    }
    if (/^[+-]?nan$/i.test(trimmed)) {
      return Number.NaN;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error(`${label} must be a number`);
    }
    return parsed;
  }
  throw new Error(`${label} must be a number`);
}

export function normalizeInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

export function normalizeArray(value, label) {
  if (value == null || typeof value[Symbol.iterator] !== "function") {
    throw new Error(`${label} must be iterable`);
  }
  return Array.from(value);
}

export function normalizeOption(value, label) {
  if (value == null) return { some: false, value: null };
  if (typeof value === "object") {
    if (value.kind === "none") return { some: false, value: null };
    if (value.kind === "some") return { some: true, value: value.value };
    if (hasOwn(value, "some")) return { some: true, value: value.some };
  }
  return { some: true, value };
}

export function normalizePair(value, label) {
  if (Array.isArray(value)) {
    if (value.length !== 2) throw new Error(`${label} pair array must have exactly two elements`);
    return { fst: value[0], snd: value[1] };
  }
  if (value !== null && typeof value === "object") {
    if (hasOwn(value, "fst") && hasOwn(value, "snd")) {
      return { fst: value.fst, snd: value.snd };
    }
    if (hasOwn(value, "first") && hasOwn(value, "second")) {
      return { fst: value.first, snd: value.second };
    }
  }
  throw new Error(`${label} must be a pair { fst, snd } or a two-element array`);
}

export function normalizeStructure(value, fields, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const normalized = {};
  for (const field of fields) {
    if (hasOwn(value, field.name)) {
      if (field.subobject === true && flattenedSubobjectFieldsPresent(value, field.type)) {
        throw new Error(`${label} mixes ${field.name} with flattened inherited fields`);
      }
      normalized[field.name] = value[field.name];
    } else if (field.subobject === true) {
      normalized[field.name] = normalizeStructure(
        value,
        requireStructureFields(field.type, `${label}.${field.name}`),
        `${label}.${field.name}`,
      );
    } else if (field.type?.wireTag === WIRE.OPTION) {
      normalized[field.name] = null;
    } else {
      throw new Error(`${label} is missing field ${field.name}`);
    }
  }
  return normalized;
}

export function flattenStructureSubobjects(type, value) {
  const fields = requireStructureFields(type, "result");
  const flattened = {};
  for (const field of fields) {
    if (field.subobject === true) {
      const subobject = value[field.name];
      if (subobject === null || typeof subobject !== "object" || Array.isArray(subobject)) {
        throw new Error(`result.${field.name} subobject must decode to an object`);
      }
      Object.assign(flattened, subobject);
    } else {
      flattened[field.name] = value[field.name];
    }
  }
  return flattened;
}

export function normalizeTaggedUnion(value, type, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a tagged-union object`);
  }
  if (hasOwn(value, "tag")) {
    const ctor = taggedUnionConstructorAt(type, value.tag, label);
    if (!hasOwn(value, "value")) {
      throw new Error(`${label}.${ctor.jsName} is missing value`);
    }
    return { index: value.tag, ctor, payload: value.value };
  }
  const text =
    typeof value.kind === "string" ? value.kind :
    typeof value.name === "string" ? value.name :
    typeof value.jsName === "string" ? value.jsName :
    hasOwn(value, "constructor") && typeof value.constructor === "string" ? value.constructor :
    null;
  if (text !== null) {
    const match = findTaggedUnionConstructor(type, text);
    if (match === null) {
      throw new Error(`${label} has unknown tagged-union constructor ${text}`);
    }
    if (!hasOwn(value, "value")) {
      throw new Error(`${label}.${match.ctor.jsName} is missing value`);
    }
    return { ...match, payload: value.value };
  }
  for (const [index, ctor] of requireTaggedUnionConstructors(type, label).entries()) {
    if (hasOwn(value, ctor.jsName)) return { index, ctor, payload: value[ctor.jsName] };
    if (hasOwn(value, ctor.name)) return { index, ctor, payload: value[ctor.name] };
  }
  throw new Error(`${label} must specify a tagged-union constructor`);
}

export function normalizeCustomInductive(value, type, label) {
  const expectedShapes = customInductiveShapes(type);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a custom inductive object; expected ${expectedShapes}`);
  }
  if (typeof value.kind !== "string") {
    throw new Error(`${label} must specify custom inductive kind; expected ${expectedShapes}`);
  }

  const match = findCustomInductiveConstructor(type, value.kind);
  if (match === null) {
    throw new Error(`${label} has unknown custom inductive constructor ${value.kind}; expected ${expectedShapes}`);
  }
  const ctorLabel = `${label}.${match.ctor.jsName}`;
  const expectedShape = customInductiveShape(match.ctor);
  if (match.ctor.fields.length === 0) {
    requireOnlyKeys(value, new Set(["kind"]), label, expectedShape);
    return { ...match, fields: {} };
  }
  if (match.ctor.fields.length === 1) {
    requireOnlyKeys(value, new Set(["kind", "value"]), label, expectedShape);
    if (!hasOwn(value, "value")) {
      throw new Error(`${ctorLabel} is missing value; expected ${expectedShape}`);
    }
    return {
      ...match,
      fields: { [match.ctor.fields[0].name]: value.value },
    };
  }
  requireOnlyKeys(value, new Set(["kind", "fields"]), label, expectedShape);
  if (!hasOwn(value, "fields")) {
    throw new Error(`${ctorLabel} is missing fields; expected ${expectedShape}`);
  }
  return {
    ...match,
    fields: normalizeCustomInductiveFields(value.fields, match.ctor, ctorLabel, expectedShape),
  };
}

export function normalizeEnum(value, type, label) {
  const constructors = type?.constructors ?? [];
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value < constructors.length) return value;
    throw new Error(`${label} enum index is out of range`);
  }
  const text =
    typeof value === "string" ? value :
    typeof value === "object" && value !== null ? value.name ?? value.jsName ?? value.constructor : null;
  if (typeof text !== "string") {
    throw new Error(`${label} must be an enum constructor name or index`);
  }
  const index = constructors.findIndex((ctor) => ctor.name === text || ctor.jsName === text);
  if (index < 0) {
    throw new Error(`${label} has unknown enum constructor ${text}`);
  }
  return index;
}

export function enumValue(type, index) {
  const ctor = type?.constructors?.[index];
  if (ctor === undefined) {
    throw new Error(`result enum index ${index} is out of range`);
  }
  return ctor.jsName ?? ctor.name ?? String(index);
}

export function asByteArrayBytes(values) {
  if (values instanceof Uint8Array || values instanceof ArrayBuffer || ArrayBuffer.isView(values)) {
    return asBytes(values, "byte array values");
  }
  if (values == null || typeof values[Symbol.iterator] !== "function") {
    throw new Error("byte array values must be iterable or an ArrayBuffer view");
  }
  return Uint8Array.from(values, (value) => normalizeByte(value));
}

function flattenedSubobjectFieldsPresent(value, type) {
  for (const field of requireStructureFields(type, "subobject")) {
    if (field.subobject === true) {
      if (flattenedSubobjectFieldsPresent(value, field.type)) return true;
    } else if (hasOwn(value, field.name)) {
      return true;
    }
  }
  return false;
}

function requireOnlyKeys(value, allowed, label, expectedShape) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label}.${key} is not supported for this custom inductive constructor shape; expected ${expectedShape}`);
    }
  }
}

function normalizeCustomInductiveFields(payload, ctor, label, expectedShape) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} fields must be an object; expected ${expectedShape}`);
  }
  const expectedNames = new Set(ctor.fields.map((field) => field.name));
  for (const key of Object.keys(payload)) {
    if (!expectedNames.has(key)) {
      throw new Error(`${label}.${key} is not a constructor field; expected ${expectedShape}`);
    }
  }
  const fields = {};
  for (const field of ctor.fields) {
    if (!hasOwn(payload, field.name)) {
      throw new Error(`${label}.${field.name} is missing; expected ${expectedShape}`);
    } else {
      fields[field.name] = payload[field.name];
    }
  }
  return fields;
}

function normalizeByte(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error("byte array values must be integers in 0..255");
  }
  return value;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
