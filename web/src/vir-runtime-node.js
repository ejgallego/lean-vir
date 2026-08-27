/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory as createBrowserVirRuntimeFactory } from "./vir-runtime.js";
import {
  createNodeHostBindings,
} from "./vir-host-bindings.js";
import {
  createHostResourceState,
} from "./vir-browser-host-bindings.js";
import {
  createVirtualDocumentState,
} from "./host/vir-virtual-host-bindings.js";

export {
  createVirImports,
  debugWasmUrlFor,
  fetchBytes,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
  releaseHostResource,
  VIR_HOST_DISPOSE,
  VirCallback,
  VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE,
} from "./vir-runtime.js";
export { createNodeHostBindings } from "./vir-host-bindings.js";
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
export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-browser-host-bindings.js";

export function createVirRuntimeFactory(options = {}) {
  const { hostBindings = null, virtualDocumentState = createVirtualDocumentState(), ...browserOptions } = options;
  let firstGeneration = true;
  return createBrowserVirRuntimeFactory({
    ...browserOptions,
    defaultHostBindings: () => {
      const resources = firstGeneration
        ? virtualDocumentState.resources
        : createHostResourceState();
      firstGeneration = false;
      return createNodeHostBindings(virtualDocumentState, resources);
    },
    hostBindings,
  });
}

export async function createVirRuntime(options = {}) {
  const {
    irPackageSetBytes,
    irPackageSetUrl,
    ...factoryOptions
  } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({
    irPackageSetBytes,
    irPackageSetUrl,
  });
}
