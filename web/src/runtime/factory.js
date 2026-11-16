/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { ManagedRuntimeFactory } from "./factory-core.js";
import { VirRuntime } from "./core.js";
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
} from "./factory-core.js";

export class VirRuntimeFactory extends ManagedRuntimeFactory {
  constructor(options = {}) {
    super(VirRuntime, options);
  }
}
export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}
