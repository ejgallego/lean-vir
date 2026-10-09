/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VirRuntimeFactory as RuntimeFactory } from "./runtime/factory.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";

export {
  createVirImports,
  debugWasmUrlFor,
  fetchBytes,
  hasExternrefTableSupport,
  requireExternrefTableSupport,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
  PACKAGE_TARGET_MODE,
  VIR_HOST_DISPOSE,
  VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE,
  formatPackageTarget,
  packageTargetModeLabel,
} from "./runtime/factory.js";

export class VirRuntimeFactory extends RuntimeFactory {
  constructor(options = {}) {
    super({
      ...options,
      defaultHostBindings: options.defaultHostBindings ?? createBrowserHostBindings,
    });
  }
}

export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}

export async function createVirRuntime(options = {}) {
  const { irPackageSet = null, ...factoryOptions } = options;
  return createVirRuntimeFactory(factoryOptions).createRuntime({ irPackageSet });
}
