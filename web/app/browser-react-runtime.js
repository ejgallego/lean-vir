/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "../src/vir-runtime.js";
import { createBrowserHostBindings } from "../src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../src/vir-react-host-bindings.js";

export function createBrowserReactRuntimeFactory(options = {}) {
  return createVirRuntimeFactory({
    ...options,
    defaultHostBindings: () =>
      createBrowserHostBindings({
        reactHostBindings: createBrowserReactHostBindings,
      }),
  });
}
