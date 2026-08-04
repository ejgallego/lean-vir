/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createNullableValue } from "./vir-js-value-bindings.js";

export function createJsCollectionHostBindings(resources) {
  return {
    "js.array.length": (array) =>
      resources.resourceForValue(BigInt(jsArrayValue(resources, array).length)),
    "js.array.item": (array, index) => {
      const values = jsArrayValue(resources, array);
      return resources.adoptResourceForValue(createNullableValue(values[jsCollectionIndex(resources, index)] ?? null));
    },
    "js.nodeList.length": (nodeList) =>
      resources.resourceForValue(BigInt(jsNodeListValue(resources, nodeList).length)),
    "js.nodeList.item": (nodeList, index) => {
      const value = jsNodeListValue(resources, nodeList).item(jsCollectionIndex(resources, index));
      return resources.adoptResourceForValue(createNullableValue(value ?? null));
    },
    "js.nodeList.toArray": (nodeList) =>
      resources.resourceForValue(Array.from(jsNodeListValue(resources, nodeList))),
  };
}

export function createStaticNodeList(values) {
  const items = Array.from(values);
  return Object.freeze({
    get length() {
      return items.length;
    },
    item(index) {
      return Number.isInteger(index) && index >= 0 && index < items.length
        ? items[index]
        : null;
    },
    [Symbol.iterator]() {
      return items[Symbol.iterator]();
    },
  });
}

function jsArrayValue(resources, resource) {
  const value = resources.resolveResource(resource, "JsArray");
  if (!Array.isArray(value)) {
    throw new Error("JsArray resource must contain a JavaScript Array");
  }
  return value;
}

function jsNodeListValue(resources, resource) {
  const value = resources.resolveResource(resource, "JsNodeList");
  if (value === null || typeof value !== "object" ||
      !Number.isSafeInteger(value.length) || value.length < 0 ||
      typeof value.item !== "function" || typeof value[Symbol.iterator] !== "function") {
    throw new Error("JsNodeList resource must contain an iterable NodeList");
  }
  return value;
}

function jsCollectionIndex(resources, resource) {
  const value = resources.resolveResource(resource, "JsNat");
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("JavaScript collection index must be a Js Nat in the safe integer range");
  }
  return Number(value);
}
