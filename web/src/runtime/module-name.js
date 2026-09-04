/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/** Validate the opaque module identity emitted by Lean's `Name.toString`. */
export function requireModuleIdentity(moduleName, label) {
  if (
    typeof moduleName !== "string" ||
    moduleName.trim() === "" ||
    moduleName !== moduleName.trim() ||
    /[\u0000-\u001f\u007f]/u.test(moduleName)
  ) {
    throw new Error(
      `${label}.module must be a non-empty module identity, be trimmed, and contain no control characters`,
    );
  }
}
