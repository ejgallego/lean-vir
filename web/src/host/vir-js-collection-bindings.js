/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Literal lowering needs own data properties, not assignment through inherited
// setters. This uses the mutable JS Object.defineProperty function, not the
// unobservable ECMA-262 CreateDataPropertyOrThrow abstract operation: a caller
// that replaces the function can observe or interrupt construction.
// A null-prototype descriptor cannot inherit getter/setter descriptor fields.
function defineLiteralProperty(object, name, value) {
  Object.defineProperty(object, name, {
    __proto__: null, value, writable: true, enumerable: true, configurable: true,
  });
}

// JSX compiler lowering only. Structural argument lifting creates the fresh
// dense native array after all child actions; publishing it makes no copy.
// A lifting failure can therefore follow effects from later children than in
// the former per-child construction path.
function arrayFromLiteralValues(values) {
  return values;
}

function objectFromLiteralFields(fields) {
  const object = {};
  // The compiler-owned buffer is dense. Do not use for...of: a replaced
  // Array.prototype iterator must not omit/reorder props that a JS object
  // literal would define without consulting an array iterator.
  for (let index = 0; index < fields.length; index++) {
    const { fst: name, snd: value } = fields[index];
    defineLiteralProperty(object, name, value);
  }
  return object;
}

export function createJsCollectionHostBindings() {
  return {
    "js.object.empty": () => ({}),
    "js.construction.field": defineLiteralProperty,
    "js.construction.element": (array, value) => defineLiteralProperty(array, array.length, value),
    "js.construction.arrayFromValues": arrayFromLiteralValues,
    "js.construction.objectFromFields": objectFromLiteralFields,
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
    "js.value.function.binaryVoid": (callback) => callback,
    "js.value.function.ternaryVoid": (callback) => callback,
    "js.value.function.unaryVoid": (callback) => callback,
    "js.function.call": (fn, argument) => fn(argument),
    "js.function.callVoid": (fn, argument) => {
      fn(argument);
      return undefined;
    },
    "js.function.call0": (fn) => fn(),
    "js.function.call0Void": (fn) => {
      fn();
      return undefined;
    },
    "js.function.call2": (fn, first, second) => fn(first, second),
    "js.function.call2Void": (fn, first, second) => {
      fn(first, second);
      return undefined;
    },
    "js.function.call3": (fn, first, second, third) => fn(first, second, third),
    "js.function.call3Void": (fn, first, second, third) => {
      fn(first, second, third);
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
    "js.array.filter": (array, callback) => array.filter(callback),
    "js.array.find": (array, callback) => array.find(callback),
    "js.array.some": (array, callback) => array.some(callback),
    "js.array.every": (array, callback) => array.every(callback),
    "js.array.forEach": (array, callback) => array.forEach(callback),
    "js.array.join": (array, separator) => array.join(separator),
    "js.array.length": (array) => array.length,
    "js.array.item": (array, index) => array[index],
    "js.tuple2.first": (tuple) => tuple[0],
    "js.tuple2.second": (tuple) => tuple[1],
    "js.nodeList.length": (nodeList) => nodeList.length,
    "js.nodeList.item": (nodeList, index) => nodeList.item(index),
    "js.nodeList.toArray": (nodeList) => Array.from(nodeList),
  };
}
