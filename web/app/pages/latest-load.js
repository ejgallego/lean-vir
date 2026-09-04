/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/** A monotonic token gate for latest-request-wins UI loads. */
export function createLatestLoadGate() {
  let generation = 0;
  return Object.freeze({
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    discardStale(token, discard) {
      if (token === generation) return false;
      discard();
      return true;
    },
  });
}
