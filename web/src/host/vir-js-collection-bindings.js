/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createJsCollectionHostBindings() {
  return {
    "js.object.empty": () => ({}),
    "js.object.set": (object, name, value) => {
      object[name] = value;
      return undefined;
    },
    "js.function.callVoid": (fn, argument) => {
      fn(argument);
      return undefined;
    },
    "js.array.empty": () => [],
    "js.array.push": (array, value) => array.push(value),
    "js.array.length": (array) => array.length,
    "js.array.item": (array, index) => array[index],
    "js.nodeList.length": (nodeList) => nodeList.length,
    "js.nodeList.item": (nodeList, index) => nodeList.item(index),
    "js.nodeList.toArray": (nodeList) => Array.from(nodeList),
  };
}
