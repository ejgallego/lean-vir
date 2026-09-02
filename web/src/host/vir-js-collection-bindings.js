/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createNullableValue } from "./vir-js-value-bindings.js";

export function createJsCollectionHostBindings() {
  return {
    "js.array.empty": () => [],
    "js.array.push": (array, value) => jsArrayValue(array).push(value),
    "js.array.length": (array) => jsArrayValue(array).length,
    "js.array.item": (array, index) => {
      const values = jsArrayValue(array);
      return values[jsCollectionIndex(index)];
    },
    "js.nodeList.length": (nodeList) => jsNodeListValue(nodeList).length,
    "js.nodeList.item": (nodeList, index) => {
      const value = jsNodeListValue(nodeList).item(jsCollectionIndex(index));
      return createNullableValue(value ?? null);
    },
    "js.nodeList.toArray": (nodeList) => Array.from(jsNodeListValue(nodeList)),
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

function jsArrayValue(value) {
  if (!Array.isArray(value)) {
    throw new Error("JsArray resource must contain a JavaScript Array");
  }
  return value;
}

function jsNodeListValue(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.length) ||
    value.length < 0 ||
    typeof value.item !== "function" ||
    typeof value[Symbol.iterator] !== "function"
  ) {
    throw new Error("JsNodeList resource must contain an iterable NodeList");
  }
  return value;
}

function jsCollectionIndex(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "JavaScript collection index must be a non-negative safe-integer Number",
    );
  }
  return value;
}
