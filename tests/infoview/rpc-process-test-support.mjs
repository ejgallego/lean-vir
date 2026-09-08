/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { waitForChildExit } from "../browser/harness.mjs";

// Called after the LSP shutdown/exit requests and stdin closure. Every fallback
// must observe process exit before the harness can report acceptance success.
export async function finishLeanProcess(child, timeoutMs = 2000) {
  if (!child || (await waitForChildExit(child, timeoutMs))) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    child.kill(signal);
    if (await waitForChildExit(child, timeoutMs)) return;
  }
  throw new Error("Lean process did not exit after SIGKILL");
}
