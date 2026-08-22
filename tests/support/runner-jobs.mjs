/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function parseRunnerJobLimit(value, variableName) {
  const text = value ?? "";
  if (text === "") return null;
  if (typeof text !== "string" || !/^[1-9]\d*$/.test(text)) {
    throw new Error(`${variableName} must be a positive integer, got ${JSON.stringify(text)}`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `${variableName} must be a safe positive integer, got ${JSON.stringify(text)}`,
    );
  }
  return parsed;
}
