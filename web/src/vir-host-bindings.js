/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createCommonHostBindings,
  createConsoleHostBindings,
  createHostResourceState,
} from "./vir-browser-host-bindings.js";
import {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
} from "./host/vir-virtual-host-bindings.js";
import { hostResourceOwnerPhase, VIR_HOST_DISPOSE } from "./host-resource.js";

export * from "./vir-browser-host-bindings.js";
export {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  ensureVirtualElementState,
  ensureVirtualElementStates,
  findVirtualReactElementById,
  createVirtualEventState,
  createVirtualEventHostBindings,
  virtualReactElementById,
} from "./host/vir-virtual-host-bindings.js";

export function createNodeHostBindings(
  state = createVirtualDocumentState(),
  resources = state.resources ?? createHostResourceState(),
) {
  const previousResources = state.resources;
  state.resources = resources;
  const bindings = {
    ...createCommonHostBindings(resources),
    ...createConsoleHostBindings(resources),
    ...createVirtualDocumentHostBindings(state, resources),
  };
  const dispose = bindings[VIR_HOST_DISPOSE];
  bindings[VIR_HOST_DISPOSE] = () => {
    try {
      return dispose?.();
    } finally {
      if (state.resources === resources &&
          hostResourceOwnerPhase(previousResources?.owner) === "active") {
        state.resources = previousResources;
      }
    }
  };
  return bindings;
}
