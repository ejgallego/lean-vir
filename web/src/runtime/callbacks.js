/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { throwWithCleanup } from "./cleanup.js";

// Callable conversion specializes invocation, while object-core owns the same
// retained Lean value and weak finalizer used by JSL carriers.
export function createVirCallback(runtime, object, type) {
  const cell = runtime.makeLeanObjectHandleCell(object, "callback", type);
  try {
    const callback = function virCallback(...args) {
      if (!cell.live)
        throw new Error("Vir callback belongs to a disposed runtime");
      return cell.runtime.callClosure(cell, cell.callType, args);
    };
    return runtime.attachLeanObjectHandle(cell, callback);
  } catch (error) {
    throwWithCleanup(
      error, () => runtime.releaseLeanObjectHandleCell(cell),
      "Lean callback creation failed",
    );
  }
}
