/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */

// Diagnostics belong to tests; production keeps only the shared ownership set.
export function countLiveCallbacks(state) {
  let count = 0;
  state?.leanObjectHandleCells.forEach(cell => {
    if (cell.live && cell.callType != null) count++;
  });
  return count;
}
