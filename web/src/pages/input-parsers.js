/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function parseDelimitedNumberText(text) {
  return text.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
}

export function parseNatText(text) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  return trimmed;
}

export function parseIntText(text) {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`invalid Int literal: ${text}`);
  }
  return trimmed;
}

export function parseByteArrayInput(text) {
  return parseDelimitedNumberText(text).map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid byte literal: ${part}`);
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("ByteArray values must be in 0..255");
    }
    return value;
  });
}

export function parseFloatText(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("invalid Float literal: empty input");
  }
  if (/^[+-]?nan$/i.test(trimmed)) {
    return Number.NaN;
  }
  const value = Number(trimmed);
  if (Number.isNaN(value)) {
    throw new Error(`invalid Float literal: ${text}`);
  }
  return value;
}

export function clampIntegerInput(value, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

export function parseClampedNatInput(text, max) {
  const nat = parseNatText(text);
  const value = Number(nat);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`invalid Nat literal: ${text}`);
  }
  return clampIntegerInput(value, max);
}
