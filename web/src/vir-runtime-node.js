/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory as createBrowserVirRuntimeFactory } from "./vir-runtime.js";
import {
  createNodeHostBindings,
  createVirtualDocumentState,
} from "./vir-host-bindings.js";

export {
  createVirImports,
  fetchBytes,
  roundTripInterfaceTypeDescriptor,
  sameInterfaceWireType,
  VirRuntime,
} from "./vir-runtime.js";
export { createNodeHostBindings, createVirtualDocumentHostBindings, createVirtualDocumentState } from "./vir-host-bindings.js";

export function createVirRuntimeFactory(options = {}) {
  const { hostBindings = null, virtualDocumentState = createVirtualDocumentState(), ...browserOptions } = options;
  return createBrowserVirRuntimeFactory({
    ...browserOptions,
    defaultHostBindings: createNodeHostBindings(virtualDocumentState),
    hostBindings,
  });
}

export async function createVirRuntime(options = {}) {
  const { irPackageBytes, irPackageUrl, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({ irPackageBytes, irPackageUrl });
}
