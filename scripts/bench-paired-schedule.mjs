/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function pairedBenchmarkSchedule(passCount) {
  if (!Number.isSafeInteger(passCount) || passCount < 1) {
    throw new TypeError("paired benchmark pass count must be a positive integer");
  }
  const schedule = [];
  for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
    const sides = passIndex % 2 === 0 ? ["before", "after"] : ["after", "before"];
    for (let position = 0; position < sides.length; position += 1) {
      schedule.push({
        pass: passIndex + 1,
        sequence: passIndex % 2 === 0 ? "AB" : "BA",
        position: position + 1,
        side: sides[position],
      });
    }
  }
  return schedule;
}

export function pairedPercentDeltas(beforeValues, afterValues) {
  if (!Array.isArray(beforeValues) || !Array.isArray(afterValues) ||
      beforeValues.length === 0 || beforeValues.length !== afterValues.length) {
    throw new TypeError("paired benchmark values must be nonempty arrays of equal length");
  }
  return beforeValues.map((before, index) => {
    const after = afterValues[index];
    if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) {
      throw new TypeError("paired benchmark values must be finite and baselines must be positive");
    }
    return (after - before) / before * 100;
  });
}
