/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function collectCleanupError(errors, cleanup) {
  try {
    return { ok: true, value: cleanup() };
  } catch (error) {
    errors.push(error);
    return { ok: false, value: undefined };
  }
}

export function throwCollectedErrors(errors, message) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

export function throwWithCleanup(error, cleanup, message) {
  // Cleanup preserves raw failures. Only an owning boundary may inspect them,
  // after committing its quarantine or retirement state.
  const errors = [error];
  collectCleanupError(errors, cleanup);
  throwCollectedErrors(errors, message);
}

// No coercion of caller-owned objects. Even instanceof may invoke a proxy's
// getPrototypeOf trap, so failure owners must latch their state before calling.
export function asError(error, message = "JavaScript exception") {
  try {
    if (error instanceof Error) return error;
    if (error === null || (typeof error !== "object" && typeof error !== "function")) {
      return new Error(String(error), { cause: error });
    }
  } catch {
    // Preserve unusual/revoked proxies as raw causes, without inspecting them.
  }
  return new Error(message, { cause: error });
}
