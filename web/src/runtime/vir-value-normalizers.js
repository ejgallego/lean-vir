/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  customInductiveShape,
  requireCustomInductiveConstructors,
  requireStructureFields,
  requireTaggedUnionConstructors,
} from "./vir-codec.js";
import { INTERFACE_TAG } from "./interface-tags.js";

const customInductiveNormalizationPlanCache = new WeakMap();

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
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

export function normalizeInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

export function normalizeArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

export function normalizeOption(value, _label) {
  if (value == null) return { some: false, value: null };
  return { some: true, value };
}

export function normalizePair(value, label) {
  if (value !== null && typeof value === "object" && !Array.isArray(value) &&
      hasOwn(value, "fst") && hasOwn(value, "snd")) {
    return { fst: value.fst, snd: value.snd };
  }
  throw new Error(`${label} must be a pair { fst, snd }`);
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
    } else if (field.type?.interfaceTag === INTERFACE_TAG.OPTION) {
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
  if (typeof value.kind !== "string") {
    throw new Error(`${label} must specify tagged-union kind`);
  }
  const constructors = requireTaggedUnionConstructors(type, label);
  const index = constructors.findIndex(
    (ctor) => (ctor.jsName ?? ctor.name) === value.kind,
  );
  if (index < 0) {
    throw new Error(`${label} has unknown tagged-union constructor ${value.kind}`);
  }
  const match = { index, ctor: constructors[index] };
  if (!hasOwn(value, "value")) {
    throw new Error(`${label}.${match.ctor.jsName} is missing value`);
  }
  return { ...match, payload: value.value };
}

export function normalizeCustomInductive(value, type, label) {
  const normalizationPlan = customInductiveNormalizationPlan(type);
  const expectedShapes = normalizationPlan.expectedShapes;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a custom inductive object; expected ${expectedShapes}`);
  }
  if (typeof value.kind !== "string") {
    throw new Error(`${label} must specify custom inductive kind; expected ${expectedShapes}`);
  }

  const constructorPlan = normalizationPlan.constructorsByName.get(value.kind);
  if (constructorPlan === undefined) {
    throw new Error(`${label} has unknown custom inductive constructor ${value.kind}; expected ${expectedShapes}`);
  }
  const { index, ctor, expectedShape } = constructorPlan;
  const ctorLabel = `${label}.${ctor.jsName}`;
  if (ctor.fields.length === 0) {
    requireOnlyKeys(value, constructorPlan.allowedKeys, label, expectedShape);
    return { index, ctor, fields: {} };
  }
  if (ctor.fields.length === 1) {
    requireOnlyKeys(value, constructorPlan.allowedKeys, label, expectedShape);
    if (!hasOwn(value, "value")) {
      throw new Error(`${ctorLabel} is missing value; expected ${expectedShape}`);
    }
    return {
      index,
      ctor,
      fields: { [ctor.fields[0].name]: value.value },
    };
  }
  requireOnlyKeys(value, constructorPlan.allowedKeys, label, expectedShape);
  if (!hasOwn(value, "fields")) {
    throw new Error(`${ctorLabel} is missing fields; expected ${expectedShape}`);
  }
  return {
    index,
    ctor,
    fields: normalizeCustomInductiveFields(value.fields, constructorPlan, ctorLabel),
  };
}

function customInductiveNormalizationPlan(type) {
  const cached = customInductiveNormalizationPlanCache.get(type);
  if (cached?.constructors === type?.constructors) {
    return cached;
  }

  const constructors = requireCustomInductiveConstructors(type, "custom inductive");
  const constructorPlans = constructors.map((ctor, index) => {
    const fieldCount = ctor.fields.length;
    return {
      index,
      ctor,
      expectedShape: customInductiveShape(ctor),
      allowedKeys: new Set(
        fieldCount === 0 ? ["kind"] : fieldCount === 1 ? ["kind", "value"] : ["kind", "fields"],
      ),
      expectedFieldNames: fieldCount > 1
        ? new Set(ctor.fields.map((field) => field.name))
        : null,
    };
  });
  const constructorsByName = new Map();
  for (const constructorPlan of constructorPlans) {
    constructorsByName.set(
      constructorPlan.ctor.jsName ?? constructorPlan.ctor.name,
      constructorPlan,
    );
  }
  const plan = {
    constructors,
    constructorsByName,
    expectedShapes: constructorPlans.map(({ expectedShape }) => expectedShape).join(" | "),
  };
  customInductiveNormalizationPlanCache.set(type, plan);
  return plan;
}

export function normalizeEnum(value, type, label) {
  const constructors = type?.constructors ?? [];
  if (typeof value !== "string") {
    throw new Error(`${label} must be an enum constructor name`);
  }
  const index = constructors.findIndex(
    (ctor) => (ctor.jsName ?? ctor.name) === value,
  );
  if (index < 0) {
    throw new Error(`${label} has unknown enum constructor ${value}`);
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

export function requireByteArrayBytes(values) {
  if (!(values instanceof Uint8Array)) {
    throw new Error("byte array values must be a Uint8Array");
  }
  return values;
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

function normalizeCustomInductiveFields(payload, constructorPlan, label) {
  const { ctor, expectedFieldNames, expectedShape } = constructorPlan;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} fields must be an object; expected ${expectedShape}`);
  }
  for (const key of Object.keys(payload)) {
    if (!expectedFieldNames.has(key)) {
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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
