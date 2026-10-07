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

function requireStructureCount(type, field, label) {
  const value = type?.[field];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} has invalid manifest structure ${field}`);
  }
  return value;
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

export function requireTaggedUnionConstructors(type, label) {
  if (!Array.isArray(type?.constructors) || type.constructors.length === 0) {
    throw new Error(`${label} is missing manifest tagged-union constructors`);
  }
  for (const ctor of type.constructors) {
    const ctorLabel = requireConstructorHeader(ctor, label, "tagged-union");
    if (!ctor.type ||
        !Number.isInteger(ctor.type.interfaceTag)) {
      throw new Error(`${label} has an invalid manifest tagged-union constructor`);
    }
    requireStructureFieldLayout(ctor.layout, ctorLabel);
  }
  return type.constructors;
}

export function requireCustomInductiveConstructors(type, label) {
  if (!Array.isArray(type?.constructors) || type.constructors.length === 0) {
    throw new Error(`${label} is missing manifest custom inductive constructors`);
  }
  for (const ctor of type.constructors) {
    const ctorLabel = requireConstructorHeader(ctor, label, "custom inductive");
    if (!Array.isArray(ctor.fields)) {
      throw new Error(`${label} has an invalid manifest custom inductive constructor`);
    }
    if (ctor.fields.length === 0 &&
        (ctor.objectFieldCount !== 0 || ctor.usizeFieldCount !== 0 || ctor.scalarByteSize !== 0)) {
      throw new Error(`${ctorLabel} has no fields but non-zero runtime field counts`);
    }
    for (const field of ctor.fields) {
      if (typeof field?.name !== "string" || !field.type || !Number.isInteger(field.type.interfaceTag)) {
        throw new Error(`${ctorLabel} has an invalid manifest custom inductive field`);
      }
      requireStructureFieldLayout(field.layout, `${ctorLabel}.${field.name}`);
    }
  }
  return type.constructors;
}

function requireConstructorHeader(ctor, label, kindLabel) {
  if (typeof ctor?.name !== "string" || typeof ctor?.jsName !== "string") {
    throw new Error(`${label} has an invalid manifest ${kindLabel} constructor`);
  }
  const ctorLabel = `${label}.${ctor.jsName}`;
  requireRuntimeCounts(ctor, ctorLabel);
  return ctorLabel;
}

function requireRuntimeCounts(type, label) {
  requireStructureCount(type, "objectFieldCount", label);
  requireStructureCount(type, "usizeFieldCount", label);
  requireStructureCount(type, "scalarByteSize", label);
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

export function taggedUnionConstructorAt(type, index, label) {
  return constructorAt(type, index, label, requireTaggedUnionConstructors, "tagged-union");
}

export function customInductiveConstructorAt(type, index, label) {
  return constructorAt(type, index, label, requireCustomInductiveConstructors, "custom inductive");
}

function constructorAt(type, index, label, requireConstructors, kindLabel) {
  const constructors = requireConstructors(type, label);
  if (!Number.isInteger(index) || index < 0 || index >= constructors.length) {
    throw new Error(`${label} ${kindLabel} constructor index is out of range`);
  }
  return constructors[index];
}

export function customInductiveShape(ctor) {
  // The normalization plan has already validated the constructor metadata.
  const kind = JSON.stringify(ctor.jsName);
  const fields = ctor.fields;
  if (fields.length === 0) {
    return `{ kind: ${kind} }`;
  }
  if (fields.length === 1) {
    return `{ kind: ${kind}, value }`;
  }
  return `{ kind: ${kind}, fields: { ${fields.map((field) => field.name).join(", ")} } }`;
}

export function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
}
