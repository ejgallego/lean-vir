/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function normalizeArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function normalizeEnum(value, pair, label) {
  if (typeof value !== "string") throw new Error(`${label} must be an enum string`);
  const index = pair.value.cases.indexOf(value);
  if (index < 0) throw new Error(`${label} has unknown enum constructor ${value}`);
  return index;
}

export function enumValue(pair, index) {
  if (!Number.isInteger(index) || index < 0 || index >= pair.value.cases.length)
    throw new Error("result enum tag is out of range");
  return pair.value.cases[index];
}
