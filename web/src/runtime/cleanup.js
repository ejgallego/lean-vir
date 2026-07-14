/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function collectCleanupError(errors, cleanup) {
  try {
    return { ok: true, value: cleanup() };
  } catch (error) {
    errors.push(asError(error));
    return { ok: false, value: undefined };
  }
}

export function throwCollectedErrors(errors, message) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

export function throwWithCleanup(error, cleanup, message) {
  const errors = [asError(error)];
  collectCleanupError(errors, cleanup);
  throwCollectedErrors(errors, message);
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
