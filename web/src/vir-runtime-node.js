/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory as createBrowserVirRuntimeFactory } from "./vir-runtime.js";
import {
  createNodeHostBindings,
  createHostLifecycle,
  createVirtualDocumentState,
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";

export {
  createVirImports,
  debugWasmUrlFor,
  fetchBytes,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
  VIR_HOST_DISPOSE,
  VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE,
} from "./vir-runtime.js";
export {
  createNodeHostBindings,
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  ensureVirtualElementState,
  ensureVirtualElementStates,
  createVirtualEventState,
  createVirtualEventHostBindings,
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";

export function createVirRuntimeFactory(options = {}) {
  const {
    hostBindings = null,
    virtualDocumentState = createVirtualDocumentState(),
    ...browserOptions
  } = options;
  let firstGeneration = true;
  return createBrowserVirRuntimeFactory({
    ...browserOptions,
    defaultHostBindings: () => {
      const resources = firstGeneration
        ? virtualDocumentState.resources
        : createHostLifecycle();
      firstGeneration = false;
      return createNodeHostBindings(virtualDocumentState, resources);
    },
    hostBindings,
  });
}

export async function createVirRuntime(options = {}) {
  const { irPackageSetBytes, irPackageSetUrl, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({
    irPackageSetBytes,
    irPackageSetUrl,
  });
}
