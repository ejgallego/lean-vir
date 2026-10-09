/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory as createRuntimeFactory } from "./runtime/factory.js";
import {
  createCommonHostBindings,
  createConsoleHostBindings,
} from "./host/vir-common-host-bindings.js";

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
} from "./runtime/factory.js";
export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./host-boundary.js";

export function createVirRuntimeFactory(options = {}) {
  const { hostBindings = null, ...factoryOptions } = options;
  return createRuntimeFactory({
    ...factoryOptions,
    defaultHostBindings: options.defaultHostBindings ?? (() => ({
      ...createCommonHostBindings(),
      ...createConsoleHostBindings(),
    })),
    hostBindings,
  });
}

export async function createVirRuntime(options = {}) {
  const { irPackageSet = null, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({ irPackageSet });
}
