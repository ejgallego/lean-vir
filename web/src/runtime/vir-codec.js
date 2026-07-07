/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  interfaceEffectRuntimeTag,
  requireInterfaceEffect,
  sameRuntimeInterfaceEffect,
} from "./interface-effects.js";
import { INTERFACE_TAG } from "./interface-tags.js";

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

export class BinaryReader {
  constructor(bytes) {
    this.bytes = asBytes(bytes, "result bytes");
    this.offset = 0;
  }

  u8() {
    if (this.offset >= this.bytes.byteLength) {
      throw new Error("unexpected end of type descriptor payload");
    }
    return this.bytes[this.offset++];
  }

  u32() {
    const b0 = this.u8();
    const b1 = this.u8();
    const b2 = this.u8();
    const b3 = this.u8();
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }

  requireEnd() {
    if (this.offset !== this.bytes.byteLength) {
      throw new Error("trailing bytes after type descriptor payload");
    }
  }
}

export function roundTripInterfaceTypeDescriptor(type, label = "interface type") {
  const writer = new BinaryWriter();
  encodeTypeDescriptor(writer, type, label);
  const reader = new BinaryReader(writer.take());
  const decoded = decodeTypeDescriptor(reader);
  reader.requireEnd();
  return decoded;
}

export function sameInterfaceTypeDescriptor(expected, actual) {
  return sameTypeDescriptor(expected, actual);
}

export function encodeTypeDescriptor(writer, type, label) {
  const tag = requireInterfaceTag(type, label);
  writer.u8(tag);
  switch (tag) {
    case INTERFACE_TAG.ARRAY:
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
      encodeTypeDescriptor(writer, requireTypeField(type, "element", label), `${label}.element`);
      return;
    case INTERFACE_TAG.PROD:
      encodeTypeDescriptor(writer, requireTypeField(type, "fst", label), `${label}.fst`);
      encodeTypeDescriptor(writer, requireTypeField(type, "snd", label), `${label}.snd`);
      return;
    case INTERFACE_TAG.STRUCTURE: {
      const fields = requireStructureFields(type, label);
      encodeRuntimeCounts(writer, type, label);
      writer.u32(requireStructureTrivialFieldIndex(type, label));
      writer.u32(fields.length);
      fields.forEach((field) => encodeFieldDescriptor(writer, field, `${label}.${field.name}`));
      return;
    }
    case INTERFACE_TAG.TAGGED_UNION: {
      const constructors = requireTaggedUnionConstructors(type, label);
      writer.u32(constructors.length);
      constructors.forEach((ctor) => {
        encodeRuntimeCounts(writer, ctor, `${label}.${ctor.jsName}`);
        encodeStructureFieldLayout(writer, ctor.layout, `${label}.${ctor.jsName}`);
        encodeTypeDescriptor(writer, ctor.type, `${label}.${ctor.jsName}`);
      });
      return;
    }
    case INTERFACE_TAG.CUSTOM_INDUCTIVE: {
      const constructors = requireCustomInductiveConstructors(type, label);
      writer.u32(constructors.length);
      constructors.forEach((ctor) =>
        encodeCustomInductiveConstructorDescriptor(writer, ctor, `${label}.${ctor.jsName}`));
      return;
    }
    case INTERFACE_TAG.RECURSIVE_SELF:
      return;
    case INTERFACE_TAG.FUNCTION: {
      const args = requireFunctionArgs(type, label);
      writer.u8(interfaceEffectRuntimeTag(type.effect));
      writer.u32(args.length);
      args.forEach((arg, index) => encodeTypeDescriptor(writer, arg.type, `${label}.args[${index}]`));
      encodeTypeDescriptor(writer, requireFunctionResult(type, label), `${label}.result`);
      return;
    }
    default:
      return;
  }
}

function encodeFieldDescriptor(writer, field, label) {
  encodeStructureFieldLayout(writer, field.layout, label);
  encodeTypeDescriptor(writer, field.type, label);
}

function encodeCustomInductiveConstructorDescriptor(writer, ctor, label) {
  encodeRuntimeCounts(writer, ctor, label);
  writer.u32(ctor.fields.length);
  ctor.fields.forEach((field) => encodeFieldDescriptor(writer, field, `${label}.${field.name}`));
}

export function decodeTypeDescriptor(reader) {
  const tag = reader.u8();
  switch (tag) {
    case INTERFACE_TAG.ARRAY:
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
      return { interfaceTag: tag, element: decodeTypeDescriptor(reader) };
    case INTERFACE_TAG.PROD:
      return { interfaceTag: tag, fst: decodeTypeDescriptor(reader), snd: decodeTypeDescriptor(reader) };
    case INTERFACE_TAG.STRUCTURE: {
      const counts = decodeRuntimeCounts(reader);
      const trivialFieldIndex = decodeStructureTrivialFieldIndex(reader.u32());
      const len = reader.u32();
      return {
        interfaceTag: tag,
        ...counts,
        ...(trivialFieldIndex === null ? {} : { trivialFieldIndex }),
        fields: decodeFieldDescriptors(reader, len),
      };
    }
    case INTERFACE_TAG.TAGGED_UNION: {
      const len = reader.u32();
      return {
        interfaceTag: tag,
        constructors: Array.from({ length: len }, () => ({
          ...decodeRuntimeCounts(reader),
          layout: decodeStructureFieldLayout(reader),
          type: decodeTypeDescriptor(reader),
        })),
      };
    }
    case INTERFACE_TAG.CUSTOM_INDUCTIVE: {
      const len = reader.u32();
      return {
        interfaceTag: tag,
        constructors: Array.from({ length: len }, () => {
          const counts = decodeRuntimeCounts(reader);
          const fieldLen = reader.u32();
          return {
            ...counts,
            fields: decodeFieldDescriptors(reader, fieldLen),
          };
        }),
      };
    }
    case INTERFACE_TAG.RECURSIVE_SELF:
      return { interfaceTag: tag };
    case INTERFACE_TAG.FUNCTION: {
      // Compact wasm descriptors only need the execution lane distinction:
      // pure callbacks use direct application, every source-level effect label
      // (`runtime`, `io`, `dom`, `react`) uses the effectful callback lane.
      // The JSON manifest preserves the richer label for tooling and review.
      const effect = reader.u8() === 0 ? "pure" : "io";
      const len = reader.u32();
      return {
        interfaceTag: tag,
        effect,
        args: Array.from({ length: len }, (_, index) => ({
          name: `arg${index + 1}`,
          type: decodeTypeDescriptor(reader),
        })),
        result: decodeTypeDescriptor(reader),
      };
    }
    default:
      return { interfaceTag: tag };
  }
}

function decodeFieldDescriptors(reader, len) {
  return Array.from({ length: len }, () => ({
    layout: decodeStructureFieldLayout(reader),
    type: decodeTypeDescriptor(reader),
  }));
}

export function requireInterfaceTag(type, label) {
  if (!Number.isInteger(type?.interfaceTag)) {
    throw new Error(`${label} is missing a manifest interfaceTag`);
  }
  return type.interfaceTag;
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

function encodeRuntimeCounts(writer, type, label) {
  requireRuntimeCounts(type, label);
  writer.u32(type.objectFieldCount);
  writer.u32(type.usizeFieldCount);
  writer.u32(type.scalarByteSize);
}

function decodeRuntimeCounts(reader) {
  return {
    objectFieldCount: reader.u32(),
    usizeFieldCount: reader.u32(),
    scalarByteSize: reader.u32(),
  };
}

function sameRuntimeCounts(expected, actual, label) {
  return requireStructureCount(expected, "objectFieldCount", label) === actual?.objectFieldCount &&
    requireStructureCount(expected, "usizeFieldCount", label) === actual?.usizeFieldCount &&
    requireStructureCount(expected, "scalarByteSize", label) === actual?.scalarByteSize;
}

function requireStructureTrivialFieldIndex(type, label) {
  const value = type?.trivialFieldIndex;
  const fields = requireStructureFields(type, label);
  return normalizeStructureTrivialFieldIndex(value, fields.length, label);
}

function normalizeStructureTrivialFieldIndex(value, fieldCount, label) {
  if (value === undefined || value === null) {
    return 0xffffffff;
  }
  if (!Number.isInteger(value) || value < 0 || value >= fieldCount) {
    throw new Error(`${label} has invalid manifest structure trivialFieldIndex`);
  }
  return value;
}

function decodeStructureTrivialFieldIndex(value) {
  return value === 0xffffffff ? null : value;
}

function encodeStructureFieldLayout(writer, layout, label) {
  const checked = requireStructureFieldLayout(layout, label);
  writer.u8(checked.tag);
  writer.u32(checked.index ?? 0);
  writer.u32(checked.size ?? 0);
  writer.u32(checked.offset ?? 0);
}

function decodeStructureFieldLayout(reader) {
  const tag = reader.u8();
  const index = reader.u32();
  const size = reader.u32();
  const offset = reader.u32();
  switch (tag) {
    case 0:
      return { kind: "object", index };
    case 1:
      return { kind: "usize", index };
    case 2:
      return { kind: "scalar", size, offset };
    default:
      throw new Error(`unsupported result structure field layout tag ${tag}`);
  }
}

function requireStructureFieldLayout(layout, label) {
  if (layout?.kind === "object" && Number.isInteger(layout.index) && layout.index >= 0) {
    return { tag: 0, index: layout.index };
  }
  if (layout?.kind === "usize" && Number.isInteger(layout.index) && layout.index >= 0) {
    return { tag: 1, index: layout.index };
  }
  if (layout?.kind === "scalar" &&
      Number.isInteger(layout.size) && layout.size > 0 &&
      Number.isInteger(layout.offset) && layout.offset >= 0) {
    return { tag: 2, size: layout.size, offset: layout.offset };
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

function sameTypeDescriptor(expected, actual) {
  if (requireInterfaceTag(expected, "expected result") !== actual?.interfaceTag) return false;
  switch (expected.interfaceTag) {
    case INTERFACE_TAG.ARRAY:
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
      return sameTypeDescriptor(requireTypeField(expected, "element", "expected result"), actual.element);
    case INTERFACE_TAG.PROD:
      return sameTypeDescriptor(requireTypeField(expected, "fst", "expected result"), actual.fst) &&
        sameTypeDescriptor(requireTypeField(expected, "snd", "expected result"), actual.snd);
    case INTERFACE_TAG.STRUCTURE: {
      const fields = requireStructureFields(expected, "expected result");
      if (!Array.isArray(actual?.fields) || fields.length !== actual.fields.length) return false;
      if (!sameRuntimeCounts(expected, actual, "expected result") ||
          requireStructureTrivialFieldIndex(expected, "expected result") !==
            normalizeStructureTrivialFieldIndex(actual?.trivialFieldIndex, actual.fields.length, "actual result")) {
        return false;
      }
      return fields.every((field, index) =>
        sameStructureFieldLayout(field.layout, actual.fields[index]?.layout) &&
        sameTypeDescriptor(field.type, actual.fields[index]?.type));
    }
    case INTERFACE_TAG.TAGGED_UNION: {
      const constructors = requireTaggedUnionConstructors(expected, "expected result");
      if (!Array.isArray(actual?.constructors) || constructors.length !== actual.constructors.length) return false;
      return constructors.every((ctor, index) => {
        const actualCtor = actual.constructors[index];
        return sameRuntimeCounts(ctor, actualCtor, "expected result") &&
          sameStructureFieldLayout(ctor.layout, actualCtor?.layout) &&
          sameTypeDescriptor(ctor.type, actualCtor?.type);
      });
    }
    case INTERFACE_TAG.CUSTOM_INDUCTIVE: {
      const constructors = requireCustomInductiveConstructors(expected, "expected result");
      if (!Array.isArray(actual?.constructors) || constructors.length !== actual.constructors.length) return false;
      return constructors.every((ctor, index) => {
        const actualCtor = actual.constructors[index];
        if (!sameRuntimeCounts(ctor, actualCtor, "expected result") ||
            !Array.isArray(actualCtor?.fields) ||
            ctor.fields.length !== actualCtor.fields.length) {
          return false;
        }
        return ctor.fields.every((field, fieldIndex) =>
          sameStructureFieldLayout(field.layout, actualCtor.fields[fieldIndex]?.layout) &&
          sameTypeDescriptor(field.type, actualCtor.fields[fieldIndex]?.type));
      });
    }
    case INTERFACE_TAG.RECURSIVE_SELF:
      return true;
    case INTERFACE_TAG.FUNCTION: {
      const args = requireFunctionArgs(expected, "expected result");
      if (!sameRuntimeInterfaceEffect(expected.effect, actual?.effect) ||
          !Array.isArray(actual?.args) ||
          args.length !== actual.args.length) {
        return false;
      }
      return args.every((arg, index) => sameTypeDescriptor(arg.type, actual.args[index]?.type)) &&
        sameTypeDescriptor(requireFunctionResult(expected, "expected result"), actual.result);
    }
    default:
      return true;
  }
}

function sameStructureFieldLayout(expected, actual) {
  const lhs = requireStructureFieldLayout(expected, "expected result field");
  const rhs = requireStructureFieldLayout(actual, "actual result field");
  return lhs.tag === rhs.tag &&
    (lhs.index ?? 0) === (rhs.index ?? 0) &&
    (lhs.size ?? 0) === (rhs.size ?? 0) &&
    (lhs.offset ?? 0) === (rhs.offset ?? 0);
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

export function findTaggedUnionConstructor(type, text) {
  return findConstructor(type, text, requireTaggedUnionConstructors, "tagged union");
}

export function findCustomInductiveConstructor(type, text) {
  return findConstructor(type, text, requireCustomInductiveConstructors, "custom inductive");
}

function constructorAt(type, index, label, requireConstructors, kindLabel) {
  const constructors = requireConstructors(type, label);
  if (!Number.isInteger(index) || index < 0 || index >= constructors.length) {
    throw new Error(`${label} ${kindLabel} constructor index is out of range`);
  }
  return constructors[index];
}

function findConstructor(type, text, requireConstructors, kindLabel) {
  const constructors = requireConstructors(type, kindLabel);
  const index = constructors.findIndex((ctor) => ctor.name === text || ctor.jsName === text);
  return index < 0 ? null : { index, ctor: constructors[index] };
}

export function customInductiveShape(ctor) {
  const kind = JSON.stringify(ctor.jsName ?? ctor.name ?? "?");
  const fields = ctor.fields ?? [];
  if (fields.length === 0) {
    return `{ kind: ${kind} }`;
  }
  if (fields.length === 1) {
    return `{ kind: ${kind}, value }`;
  }
  return `{ kind: ${kind}, fields: { ${fields.map((field) => field.name).join(", ")} } }`;
}

export function customInductiveShapes(type) {
  return requireCustomInductiveConstructors(type, "custom inductive")
    .map((ctor) => customInductiveShape(ctor))
    .join(" | ");
}

export function normalizeUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer in 0..4294967295`);
  }
  return value >>> 0;
}
