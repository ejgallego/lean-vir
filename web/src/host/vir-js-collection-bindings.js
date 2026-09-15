/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// ECMA-262 CreateDataPropertyOrThrow, used by literal lowering, not assignment.
// A null-prototype descriptor cannot inherit getter/setter descriptor fields.
function defineLiteralProperty(object, name, value) {
  Object.defineProperty(object, name, {
    __proto__: null, value, writable: true, enumerable: true, configurable: true,
  });
}

export function createJsCollectionHostBindings() {
  return {
    "js.object.empty": () => ({}),
    "js.construction.field": defineLiteralProperty,
    "js.construction.element": (array, value) => defineLiteralProperty(array, array.length, value),
    "js.object.set": (object, name, value) => {
      object[name] = value;
      return undefined;
    },
    "js.object.get": (object, name) => object[name],
    "js.value.function.unary": (callback) => callback,
    "js.value.function.nullary": (callback) => callback,
    "js.value.function.nullaryVoid": (callback) => callback,
    "js.value.function.binary": (callback) => callback,
    "js.value.function.ternary": (callback) => callback,
    "js.value.function.unaryVoid": (callback) => callback,
    "js.function.call": (fn, argument) => fn(argument),
    "js.function.callVoid": (fn, argument) => {
      fn(argument);
      return undefined;
    },
    "js.promise.thenValue": (promise, onFulfilled) => promise.then(onFulfilled),
    "js.promise.thenPromise": (promise, onFulfilled) => promise.then(onFulfilled),
    "js.promise.thenVoid": (promise, onFulfilled) => promise.then(onFulfilled),
    "js.promise.thenValueWithRejection": (promise, onFulfilled, onRejected) =>
      promise.then(onFulfilled, onRejected),
    "js.promise.thenVoidWithRejection": (promise, onFulfilled, onRejected) =>
      promise.then(onFulfilled, onRejected),
    "js.promise.catchValue": (promise, onRejected) => promise.catch(onRejected),
    "js.array.empty": () => [],
    "js.array.push": (array, value) => array.push(value),
    "js.array.map": (array, callback) => array.map(callback),
    "js.array.length": (array) => array.length,
    "js.array.item": (array, index) => array[index],
    "js.tuple2.first": (tuple) => tuple[0],
    "js.tuple2.second": (tuple) => tuple[1],
    "js.nodeList.length": (nodeList) => nodeList.length,
    "js.nodeList.item": (nodeList, index) => nodeList.item(index),
    "js.nodeList.toArray": (nodeList) => Array.from(nodeList),
  };
}
