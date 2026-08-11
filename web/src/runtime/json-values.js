/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { INTERFACE_TAG } from "./interface-tags.js";
import { readObjectScalarField, writeObjectScalarField } from "./object-abi.js";

export const JSON_MAX_DEPTH = 256;

const BOOL_TYPE = Object.freeze({ interfaceTag: INTERFACE_TAG.BOOL });
const FLOAT_TYPE = Object.freeze({ interfaceTag: INTERFACE_TAG.FLOAT });
const BOOL_LAYOUT = Object.freeze({ kind: "scalar", size: 1, offset: 0 });
const FLOAT_LAYOUT = Object.freeze({ kind: "scalar", size: 8, offset: 0 });
const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
const propertyIsEnumerable = Function.call.bind(Object.prototype.propertyIsEnumerable);

export function makeJsonObjectValue(runtime, value, label) {
  return lowerJson(runtime, value, label, 0, new Set());
}

function lowerJson(runtime, value, label, depth, ancestors) {
  requireJsonDepth(depth, label);
  if (value === null) return runtime.makeObjectScalar(0, label);
  switch (typeof value) {
    case "boolean":
      return makeScalarConstructor(runtime, 1, BOOL_TYPE, BOOL_LAYOUT, value, label);
    case "number":
      requireJsonNumber(value, label);
      return makeScalarConstructor(runtime, 2, FLOAT_TYPE, FLOAT_LAYOUT, value, label);
    case "string": {
      const fields = [runtime.makeObjectString(value, label)];
      try {
        return runtime.makeObjectCtorFromOwnedFields(3, fields, label);
      } finally {
        runtime.releaseOwnedObjects(fields);
      }
    }
    case "object":
      return withJsonContainer(value, label, ancestors, () =>
        Array.isArray(value)
          ? lowerJsonArray(runtime, value, label, depth, ancestors)
          : lowerJsonObject(runtime, value, label, depth, ancestors));
    default:
      throw new TypeError(`${label} must be an ordinary JSON value; found ${typeof value}`);
  }
}

function lowerJsonArray(runtime, value, label, depth, ancestors) {
  requireNoEnumerableSymbolProperties(value, label);
  const elements = [];
  try {
    for (let index = 0; index < value.length; index++) {
      if (!hasOwn(value, index)) {
        throw new TypeError(`${label}[${index}] is an array hole, not a JSON value`);
      }
      elements.push(lowerJson(runtime, value[index], `${label}[${index}]`, depth + 1, ancestors));
    }
    const array = runtime.makeObjectArrayFromOwnedElements(elements, label);
    const fields = [array];
    try {
      return runtime.makeObjectCtorFromOwnedFields(4, fields, label);
    } finally {
      runtime.releaseOwnedObjects(fields);
    }
  } finally {
    runtime.releaseOwnedObjects(elements);
  }
}

function lowerJsonObject(runtime, value, label, depth, ancestors) {
  requirePlainJsonObject(value, label);
  const entries = [];
  try {
    for (const key of Object.keys(value)) {
      const childLabel = jsonObjectPath(label, key);
      const fields = [];
      try {
        fields.push(runtime.makeObjectString(key, `${childLabel} key`));
        fields.push(lowerJson(runtime, value[key], childLabel, depth + 1, ancestors));
        entries.push(runtime.makeObjectCtorFromOwnedFields(0, fields, `${childLabel} entry`));
      } finally {
        runtime.releaseOwnedObjects(fields);
      }
    }
    const array = runtime.makeObjectArrayFromOwnedElements(entries, label);
    const fields = [array];
    try {
      return runtime.makeObjectCtorFromOwnedFields(5, fields, label);
    } finally {
      runtime.releaseOwnedObjects(fields);
    }
  } finally {
    runtime.releaseOwnedObjects(entries);
  }
}

function makeScalarConstructor(runtime, tag, type, layout, value, label) {
  const scalarBytes = new Uint8Array(layout.size);
  writeObjectScalarField(scalarBytes, type, layout, value, label);
  return runtime.makeObjectCtorFromOwnedLayout(tag, {
    objectFields: [],
    usizeFields: [],
    scalarBytes,
  }, label);
}

function withJsonContainer(value, label, ancestors, run) {
  if (ancestors.has(value)) {
    throw new TypeError(`${label} contains a JSON cycle`);
  }
  ancestors.add(value);
  try {
    return run();
  } finally {
    ancestors.delete(value);
  }
}

export function liftJsonObjectValue(runtime, obj, label) {
  return liftJson(runtime, obj, label, 0);
}

function liftJson(runtime, obj, label, depth) {
  requireJsonDepth(depth, label);
  if (runtime.exports.vir_obj_is_scalar(obj) !== 0) {
    const tag = runtime.exports.vir_obj_scalar_value(obj) >>> 0;
    if (tag === 0) return null;
    throw new Error(`${label} has unsupported Lean.Vir.Json scalar tag ${tag}`);
  }
  const tag = runtime.exports.vir_obj_tag(obj) >>> 0;
  switch (tag) {
    case 1:
      return readJsonScalar(runtime, obj, BOOL_TYPE, BOOL_LAYOUT, label);
    case 2: {
      const value = readJsonScalar(runtime, obj, FLOAT_TYPE, FLOAT_LAYOUT, label);
      requireJsonNumber(value, label);
      return value;
    }
    case 3:
      return runtime.withOwnedObjectField(obj, 0, label, (field) => runtime.readObjectString(field));
    case 4:
      return runtime.withOwnedObjectField(obj, 0, label, (field) =>
        liftJsonArray(runtime, field, label, depth));
    case 5:
      return runtime.withOwnedObjectField(obj, 0, label, (field) =>
        liftJsonObject(runtime, field, label, depth));
    default:
      throw new Error(`${label} has unsupported Lean.Vir.Json constructor tag ${tag}`);
  }
}

function readJsonScalar(runtime, obj, type, layout, label) {
  const data = runtime.exports.vir_obj_ctor_scalar_data(obj, 0);
  if (data === 0) {
    throw new Error(`${label} JSON scalar payload is unavailable`);
  }
  return readObjectScalarField(
    new DataView(runtime.exports.memory.buffer, data, layout.size),
    type,
    layout,
    label,
  );
}

function liftJsonArray(runtime, array, label, depth) {
  const length = runtime.exports.vir_obj_array_size(array);
  const values = [];
  for (let index = 0; index < length; index++) {
    const element = runtime.exports.vir_obj_array_get(array, index);
    if (element === 0) throw new Error(`${label}[${index}] is unavailable`);
    try {
      values.push(liftJson(runtime, element, `${label}[${index}]`, depth + 1));
    } finally {
      runtime.exports.vir_obj_dec(element);
    }
  }
  return values;
}

function liftJsonObject(runtime, entries, label, depth) {
  const length = runtime.exports.vir_obj_array_size(entries);
  const value = {};
  for (let index = 0; index < length; index++) {
    const entry = runtime.exports.vir_obj_array_get(entries, index);
    if (entry === 0) throw new Error(`${label} entry ${index} is unavailable`);
    try {
      runtime.withOwnedObjectFields(entry, [0, 1], `${label} entry ${index}`, ([keyObj, valueObj]) => {
        const key = runtime.readObjectString(keyObj);
        if (hasOwn(value, key)) {
          throw new Error(`${label} contains duplicate JSON object key ${JSON.stringify(key)}`);
        }
        Object.defineProperty(value, key, {
          configurable: true,
          enumerable: true,
          value: liftJson(runtime, valueObj, jsonObjectPath(label, key), depth + 1),
          writable: true,
        });
      });
    } finally {
      runtime.exports.vir_obj_dec(entry);
    }
  }
  return value;
}

export function requireJsonNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite JSON number`);
  }
  return value;
}

export function requirePlainJsonObject(value, label) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
  requireNoEnumerableSymbolProperties(value, label);
  return value;
}

export function requireNoEnumerableSymbolProperties(value, label) {
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (propertyIsEnumerable(value, symbol)) {
      throw new TypeError(`${label} has an enumerable symbol property, which JSON cannot represent`);
    }
  }
  return value;
}

export function jsonArrayPath(label, index) {
  return `${label}[${index}]`;
}

export function jsonObjectPath(label, key) {
  return `${label}[${JSON.stringify(key)}]`;
}

export function requireJsonDepth(depth, label) {
  if (depth > JSON_MAX_DEPTH) {
    throw new RangeError(`${label} exceeds the maximum JSON depth ${JSON_MAX_DEPTH}`);
  }
}
