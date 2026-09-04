/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory as createBrowserVirRuntimeFactory } from "./vir-runtime.js";
import {
  createCommonHostBindings,
  createConsoleHostBindings,
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";

export {
  createVirImports,
  debugWasmUrlFor,
  fetchBytes,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
  PACKAGE_TARGET_MODE,
  VIR_HOST_DISPOSE,
  VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE,
  formatPackageTarget,
  packageTargetModeLabel,
} from "./vir-runtime.js";
export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";

export function createVirRuntimeFactory(options = {}) {
  const { hostBindings = null, ...browserOptions } = options;
  return createBrowserVirRuntimeFactory({
    ...browserOptions,
    defaultHostBindings: () => ({
      ...createCommonHostBindings(),
      ...createConsoleHostBindings(),
    }),
    hostBindings,
  });
}

export async function createVirRuntime(options = {}) {
  const { irPackageSet = null, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({ irPackageSet });
}
