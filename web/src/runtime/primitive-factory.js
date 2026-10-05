/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { ManagedRuntimeFactory } from "./factory-core.js";
import { ManagedRuntime } from "./managed-core.js";
export { VIR_HOST_DISPOSE } from "./factory-core.js";

// Internal only: no additional public package entry or construction contract.
export function createPrimitiveRuntimeFactory(options = {}) {
  return new ManagedRuntimeFactory(ManagedRuntime, options);
}
