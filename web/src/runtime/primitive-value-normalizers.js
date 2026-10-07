/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function normalizeDecimal(value, label, { signed }) {
  return String(normalizeIntegerInput(value, label, { signed }));
}

function normalizeIntegerInput(value, label, { signed }) {
  if (typeof value === "bigint") {
    if (!signed && value < 0n) throw new Error(`${label} must be non-negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error(`${label} must be a safe integer or decimal string`);
    if (!signed && value < 0) throw new Error(`${label} must be non-negative`);
    return value;
  }
  if (typeof value === "string") {
    const decimal = value.trim();
    const pattern = signed ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(decimal))
      throw new Error(`${label} must be a decimal string`);
    return decimal;
  }
  throw new Error(`${label} must be an integer, BigInt, or decimal string`);
}

export function normalizeBoundedUnsignedDecimal(value, label, max, typeName) {
  const decimal = normalizeDecimal(value, label, { signed: false });
  requireUnsignedBound(BigInt(decimal), label, max, typeName);
  return decimal;
}

export function normalizeBoundedUnsignedBigInt(value, label, max, typeName) {
  const normalized = BigInt(
    normalizeIntegerInput(value, label, { signed: false }),
  );
  return requireUnsignedBound(normalized, label, max, typeName);
}

function requireUnsignedBound(value, label, max, typeName) {
  if (value > max) {
    throw new Error(`${label} is out of range for ${typeName}`);
  }
  return value;
}

export function normalizeFloat(value, label) {
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

export function normalizeInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

export function requireByteArrayBytes(values) {
  if (!(values instanceof Uint8Array)) {
    throw new Error("byte array values must be a Uint8Array");
  }
  return values;
}
