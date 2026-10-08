/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { requireInterfaceEffect } from "./interface-effects.js";

export function asBytes(bytes, label) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new Error(`${label} must be an ArrayBuffer or Uint8Array`);
}

export class BinaryWriter {
  constructor() {
    this.bytes = [];
  }

  u8(value) {
    this.bytes.push(value & 0xff);
  }

  u32(value) {
    const normalized = normalizeUint32(value, "u32");
    this.bytes.push(
      normalized & 0xff,
      (normalized >>> 8) & 0xff,
      (normalized >>> 16) & 0xff,
      (normalized >>> 24) & 0xff,
    );
  }

  take() {
    return Uint8Array.from(this.bytes);
  }
}

export function requireTypeField(type, field, label) {
  const child = type?.[field];
  if (!child || !Number.isInteger(child.interfaceTag)) {
    throw new Error(`${label} is missing manifest type field ${field}`);
  }
  return child;
}

function requireStructureFieldLayout(layout, label) {
  if (layout?.kind === "object" && Number.isInteger(layout.index) && layout.index >= 0) {
    return;
  }
  if (layout?.kind === "usize" && Number.isInteger(layout.index) && layout.index >= 0) {
    return;
  }
  if (layout?.kind === "scalar" &&
      Number.isInteger(layout.size) && layout.size > 0 &&
      Number.isInteger(layout.offset) && layout.offset >= 0) {
    return;
  }
  throw new Error(`${label} has an invalid manifest structure field layout`);
}

export function requireStructureFields(type, label) {
  if (!Array.isArray(type?.fields)) {
    throw new Error(`${label} is missing manifest structure fields`);
  }
  for (const field of type.fields) {
    if (typeof field?.name !== "string" || !field.type || !Number.isInteger(field.type.interfaceTag)) {
      throw new Error(`${label} has an invalid manifest structure field`);
    }
    requireStructureFieldLayout(field.layout, `${label}.${field.name}`);
  }
  return type.fields;
}

export function requireFunctionArgs(type, label) {
  requireInterfaceEffect(type?.effect, `${label} effect`);
  if (!Array.isArray(type?.args)) {
    throw new Error(`${label} is missing manifest function args`);
  }
  for (const arg of type.args) {
    if (typeof arg?.name !== "string" || !arg.type || !Number.isInteger(arg.type.interfaceTag)) {
      throw new Error(`${label} has an invalid manifest function argument`);
    }
  }
  return type.args;
}

export function requireFunctionResult(type, label) {
  const result = type?.result;
  if (!result || !Number.isInteger(result.interfaceTag)) {
    throw new Error(`${label} is missing manifest function result`);
  }
  return result;
}

// Admitted constructor tables are immutable; only the result ordinal is dynamic.
export function taggedUnionConstructorAt(type, index, label) {
  return constructorAt(type, index, label, "tagged-union");
}

export function customInductiveConstructorAt(type, index, label) {
  return constructorAt(type, index, label, "custom inductive");
}

function constructorAt(type, index, label, kindLabel) {
  const constructors = type.constructors;
  if (!Number.isInteger(index) || index < 0 || index >= constructors.length) {
    throw new Error(`${label} ${kindLabel} constructor index is out of range`);
  }
  return constructors[index];
}

export function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
}
