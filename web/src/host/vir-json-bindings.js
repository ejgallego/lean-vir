/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { hostResourceValue, releaseHostResource } from "../host-resource.js";
import {
  JSON_MAX_DEPTH,
  jsonArrayPath,
  jsonObjectPath,
  requireNoEnumerableSymbolProperties,
  requireJsonDepth,
  requireJsonNumber,
  requirePlainJsonObject,
} from "../runtime/json-values.js";

export const VIR_JSON_BORROW = Symbol.for("lean-vir.jsonBorrow");
export const VIR_JSON_VALUE = Symbol.for("lean-vir.jsonValue");

const JSON_HANDLE_BRAND = Symbol("lean-vir.jsonHandle");
const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);

export function createJsonHostBindings(resources) {
  const borrow = (value) => createJsonHandleResource(resources, value, null, "borrowed JSON");
  const value = (resource) => jsonHandlePayload(resources, resource, "JSON handle").value;
  return {
    "js.json.handle": borrow,
    "js.json.value": value,
    "js.json.inspect": (resource) => inspectJsonHandle(resources, resource),
    "js.json.array": (items) => buildJsonArray(resources, items),
    "js.json.object": (entries) => buildJsonObject(resources, entries),
    [VIR_JSON_BORROW]: borrow,
    [VIR_JSON_VALUE]: value,
  };
}

function buildJsonArray(resources, items) {
  if (!Array.isArray(items)) throw new TypeError("JSON handle array builder requires an array");
  return createJsonHandleResource(
    resources,
    items.map((item, index) => jsonHandlePayload(resources, item, `JSON array item ${index}`).value),
    null,
    "JSON handle array",
  );
}

function buildJsonObject(resources, entries) {
  if (!Array.isArray(entries)) throw new TypeError("JSON handle object builder requires an array");
  const value = {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === null || typeof entry !== "object" || typeof entry.fst !== "string") {
      throw new TypeError(`JSON object entry ${index} must be a string/handle pair`);
    }
    if (hasOwn(value, entry.fst)) {
      throw new TypeError(`JSON object builder contains duplicate key ${JSON.stringify(entry.fst)}`);
    }
    Object.defineProperty(value, entry.fst, {
      configurable: true,
      enumerable: true,
      value: jsonHandlePayload(resources, entry.snd, `JSON object entry ${index}`).value,
      writable: true,
    });
  }
  return createJsonHandleResource(resources, value, null, "JSON handle object");
}

export function isJsonHandleResource(resource) {
  return hostResourceValue(resource)?.[JSON_HANDLE_BRAND] === true;
}

export function jsonHandleValue(resource) {
  const payload = hostResourceValue(resource);
  if (payload?.[JSON_HANDLE_BRAND] !== true) {
    throw new TypeError("value must be a live VIR JSON handle");
  }
  return payload.value;
}

function createJsonHandleResource(resources, value, parent, label) {
  return resources.ownedResourceForValue(createJsonHandlePayload(value, parent, label), {
    label: "JsonHandle",
  });
}

function createJsonHandlePayload(value, parent, label) {
  const depth = parent === null ? 0 : parent.depth + 1;
  requireJsonDepth(depth, label);
  requireShallowJsonValue(value, label);
  if (value !== null && typeof value === "object") {
    for (let ancestor = parent; ancestor !== null; ancestor = ancestor.parent) {
      if (ancestor.value === value) {
        throw new TypeError(`${label} contains a JSON cycle`);
      }
    }
  }
  return Object.freeze({
    [JSON_HANDLE_BRAND]: true,
    depth,
    parent,
    path: label,
    value,
  });
}

function jsonHandlePayload(resources, resource, label) {
  const payload = resources.resolveResource(resource, label);
  if (payload?.[JSON_HANDLE_BRAND] !== true) {
    throw new TypeError(`${label} must contain a VIR borrowed JSON value`);
  }
  return payload;
}

function inspectJsonHandle(resources, resource) {
  const payload = jsonHandlePayload(resources, resource, "JSON handle");
  const value = payload.value;
  if (value === null) return { kind: "null" };
  switch (typeof value) {
    case "boolean":
      return { kind: "bool", value };
    case "number":
      return { kind: "number", value: requireJsonNumber(value, payload.path) };
    case "string":
      return { kind: "string", value };
    case "object":
      return Array.isArray(value)
        ? inspectJsonArray(resources, value, payload)
        : inspectJsonObject(resources, value, payload);
    default:
      throw new TypeError(`${payload.path} contains unsupported ${typeof value} value`);
  }
}

function inspectJsonArray(resources, value, parent) {
  requireNoEnumerableSymbolProperties(value, parent.path);
  const owned = [];
  try {
    for (let index = 0; index < value.length; index++) {
      const childPath = jsonArrayPath(parent.path, index);
      if (!hasOwn(value, index)) {
        throw new TypeError(`${childPath} is an array hole, not a JSON value`);
      }
      owned.push(createJsonHandleResource(resources, value[index], parent, childPath));
    }
    return { kind: "array", value: owned };
  } catch (error) {
    releaseJsonHandleResources(owned);
    throw error;
  }
}

function inspectJsonObject(resources, value, parent) {
  requirePlainJsonObject(value, parent.path);
  const owned = [];
  try {
    const entries = Object.keys(value).map((key) => {
      const child = createJsonHandleResource(resources, value[key], parent, jsonObjectPath(parent.path, key));
      owned.push(child);
      return { fst: key, snd: child };
    });
    return { kind: "object", value: entries };
  } catch (error) {
    releaseJsonHandleResources(owned);
    throw error;
  }
}

function releaseJsonHandleResources(resources) {
  const errors = [];
  for (const resource of resources) {
    try {
      releaseHostResource(resource);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "borrowed JSON child cleanup failed");
  }
}

function requireShallowJsonValue(value, label) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return requireJsonNumber(value, label);
  if (Array.isArray(value)) return requireNoEnumerableSymbolProperties(value, label);
  if (value !== null && typeof value === "object") return requirePlainJsonObject(value, label);
  throw new TypeError(`${label} must be an ordinary JSON value; found ${typeof value}`);
}

export { JSON_MAX_DEPTH };
