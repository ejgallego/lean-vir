/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createJsValueHostBindings } from "./vir-js-value-bindings.js";
import { createJsCollectionHostBindings } from "./vir-js-collection-bindings.js";
import { createJsonValueHostBindings } from "./vir-json-value-bindings.js";

export function createCommonHostBindings() {
  return {
    ...createJsValueHostBindings(),
    ...createJsCollectionHostBindings(),
    ...createJsonValueHostBindings(),
  };
}

export function createConsoleHostBindings() {
  return {
    "browser.console.current": () => browserConsole(),
    "browser.console.log": (consoleValue, message) => consoleValue.log(message),
  };
}

function browserConsole() {
  const consoleValue = globalThis.console;
  if (!consoleValue || typeof consoleValue.log !== "function") {
    throw new Error(
      "browser.console host binding requires globalThis.console or explicit hostBindings",
    );
  }
  return consoleValue;
}
