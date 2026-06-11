/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "./vir-runtime.js";
import {
  createBrowserHostBindings,
  createHostResourceState,
} from "./vir-host-bindings.js";
import { createBrowserReactHostBindings } from "./vir-react-host-bindings.js";

export function createBrowserReactRuntimeFactory(options = {}) {
  return createVirRuntimeFactory({
    ...options,
    defaultHostBindings: () => {
      const resources = createHostResourceState();
      return createBrowserHostBindings({
        resources,
        reactHostBindings: createBrowserReactHostBindings(resources),
      });
    },
  });
}
