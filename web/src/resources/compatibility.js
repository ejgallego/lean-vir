/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VIR_COMPATIBILITY_VERSION } from "../runtime/versions.js";

// Compiler identity is checked separately against the actual program/build.
export function assertResourceCompatibility(profile) {
  if (
    !profile ||
    Object.keys(profile).sort().join(",") !== "leanRevision,virVersion" ||
    typeof profile.leanRevision !== "string" || !profile.leanRevision.length ||
    profile.virVersion !== VIR_COMPATIBILITY_VERSION
  ) {
    throw new Error(
      `unsupported resource runtime compatibility: expected leanRevision and VIR version ${VIR_COMPATIBILITY_VERSION}`,
    );
  }
}
