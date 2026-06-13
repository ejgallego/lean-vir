/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  BinaryReader,
  BinaryWriter,
  customInductiveConstructorAt,
  decodeTypeDescriptor,
  encodeTypeDescriptor,
  normalizeUint32,
  requireFunctionArgs,
  requireFunctionResult,
  requireStructureFields,
  requireTypeField,
  requireWireTag,
  sameWireType,
  taggedUnionConstructorAt,
} from "./vir-codec.js";
import { decodeExpr, encodeExpr } from "./vir-lean-codec.js";
import {
  asByteArrayBytes,
  enumValue,
  flattenStructureSubobjects,
  normalizeArray,
  normalizeCustomInductive,
  normalizeDecimal,
  normalizeEnum,
  normalizeFloat,
  normalizeInteger,
  normalizeOption,
  normalizePair,
  normalizeHostResource,
  normalizeStructure,
  normalizeTaggedUnion,
} from "./vir-value-normalizers.js";
import { WIRE } from "./wire-tags.js";

export function encodeCallPayload(entry, args, options = {}) {
  const writer = new BinaryWriter();
  writer.u32(args.length);
  entry.args.forEach((arg, index) => {
    encodeValue(writer, arg.type, args[index], `${entry.entry} argument ${arg.name}`, options);
  });
  encodeTypeDescriptor(writer, entry.result, `${entry.entry} result`);
  writer.u8(entry.effect === "io" ? 1 : 0);
  return writer.take();
}

export function encodeClosureCallPayload(type, args, options = {}) {
  const fnArgs = requireFunctionArgs(type, "callback");
  if (args.length !== fnArgs.length) {
    throw new Error(`callback expects ${fnArgs.length} arguments, got ${args.length}`);
  }
  const writer = new BinaryWriter();
  writer.u32(args.length);
  fnArgs.forEach((arg, index) => {
    encodeValue(writer, arg.type, args[index], `callback argument ${arg.name}`, options);
  });
  encodeTypeDescriptor(writer, requireFunctionResult(type, "callback"), "callback result");
  writer.u8(type.effect === "io" ? 1 : 0);
  return writer.take();
}

export function decodeCallResult(type, bytes, options = {}) {
  const reader = new BinaryReader(bytes);
  const actualType = decodeTypeDescriptor(reader);
  if (!sameWireType(type, actualType)) {
    throw new Error(`result wire type mismatch: expected ${type.type ?? requireWireTag(type, "result")}, got tag ${actualType.wireTag}`);
  }
  const value = decodeValuePayload(reader, type, options);
  reader.requireEnd();
  return value;
}

export function decodeHostCallRequest(bytes, entry, options = {}) {
  const reader = new BinaryReader(bytes);
  const argc = reader.u32();
  if (argc !== entry.args.length) {
    throw new Error(`Vir host import ${entry.target} expects ${entry.args.length} arguments, got ${argc}`);
  }
  const args = entry.args.map((arg, index) => {
    const actualType = decodeTypeDescriptor(reader);
    if (!sameWireType(arg.type, actualType)) {
      throw new Error(`Vir host import ${entry.target} argument ${arg.name ?? index} type mismatch`);
    }
    return decodeValuePayload(reader, arg.type, options);
  });
  const actualResult = decodeTypeDescriptor(reader);
  if (!sameWireType(entry.result, actualResult)) {
    throw new Error(`Vir host import ${entry.target} result type mismatch`);
  }
  reader.requireEnd();
  return { args, resultType: entry.result };
}

export function encodeHostCallResult(type, value, entry, options = {}) {
  const writer = new BinaryWriter();
  encodeTypeDescriptor(writer, type, `${entry.target} result`);
  encodeValuePayload(writer, type, value, `${entry.target} result`, options);
  return writer.take();
}

function encodeValue(writer, type, value, label, options) {
  encodeTypeDescriptor(writer, type, label);
  encodeValuePayload(writer, type, value, label, options);
}

function encodeValuePayload(writer, type, value, label, options = {}, selfType = null) {
  const tag = requireWireTag(type, label);
  switch (tag) {
    case WIRE.RECURSIVE_SELF:
      if (selfType === null) {
        throw new Error(`${label} has a recursive self reference without an enclosing type`);
      }
      encodeValuePayload(writer, selfType, value, label, options, selfType);
      return;
    case WIRE.UNIT:
      if (value !== undefined && value !== null) throw new Error(`${label} must be undefined or null`);
      return;
    case WIRE.RESOURCE:
      if (typeof options.pushIncomingResource !== "function") {
        throw new Error(`${label} cannot be encoded without an attached resource queue`);
      }
      options.pushIncomingResource(normalizeHostResource(value, label));
      return;
    case WIRE.FUNCTION:
      throw new Error(`${label} cannot be a JavaScript function in v1`);
    case WIRE.NAT:
      writer.string(normalizeDecimal(value, label, { signed: false }));
      return;
    case WIRE.INT:
      writer.string(normalizeDecimal(value, label, { signed: true }));
      return;
    case WIRE.BOOL:
      if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
      writer.u8(value ? 1 : 0);
      return;
    case WIRE.STRING:
      if (typeof value !== "string") throw new Error(`${label} must be a string`);
      writer.string(value);
      return;
    case WIRE.UINT8:
      writer.u8(normalizeInteger(value, label, 0, 0xff));
      return;
    case WIRE.UINT16:
      writer.u32(normalizeInteger(value, label, 0, 0xffff));
      return;
    case WIRE.UINT32:
      writer.u32(normalizeUint32(value, label));
      return;
    case WIRE.UINT64:
    case WIRE.USIZE:
      writer.string(normalizeDecimal(value, label, { signed: false }));
      return;
    case WIRE.BYTE_ARRAY:
      writer.bytesValue(asByteArrayBytes(value));
      return;
    case WIRE.FLOAT:
      writer.f64(normalizeFloat(value, label));
      return;
    case WIRE.FLOAT32:
      writer.f32(normalizeFloat(value, label));
      return;
    case WIRE.SIMPLE_ENUM:
      writer.u32(normalizeEnum(value, type, label));
      return;
    case WIRE.EXPR:
      encodeExpr(writer, value, label);
      return;
    case WIRE.ARRAY:
    case WIRE.LIST:
      encodeSequencePayload(writer, type, value, label, options, selfType);
      return;
    case WIRE.OPTION: {
      const option = normalizeOption(value, label);
      writer.u8(option.some ? 1 : 0);
      if (option.some) {
        encodeValuePayload(writer, requireTypeField(type, "element", label), option.value, `${label}.value`, options, selfType);
      }
      return;
    }
    case WIRE.PROD: {
      const pair = normalizePair(value, label);
      encodeValuePayload(writer, requireTypeField(type, "fst", label), pair.fst, `${label}.fst`, options, selfType);
      encodeValuePayload(writer, requireTypeField(type, "snd", label), pair.snd, `${label}.snd`, options, selfType);
      return;
    }
    case WIRE.STRUCTURE: {
      const fields = requireStructureFields(type, label);
      const record = normalizeStructure(value, fields, label);
      encodeNamedFieldPayloads(writer, fields, record, label, type, options);
      return;
    }
    case WIRE.TAGGED_UNION: {
      const { index, ctor, payload } = normalizeTaggedUnion(value, type, label);
      writer.u32(index);
      encodeValuePayload(writer, ctor.type, payload, `${label}.${ctor.jsName}`, options, selfType);
      return;
    }
    case WIRE.CUSTOM_INDUCTIVE: {
      const { index, ctor, fields } = normalizeCustomInductive(value, type, label);
      writer.u32(index);
      encodeNamedFieldPayloads(writer, ctor.fields, fields, `${label}.${ctor.jsName}`, type, options);
      return;
    }
    default:
      throw new Error(`${label} has unsupported wire tag ${tag}`);
  }
}

function encodeSequencePayload(writer, type, value, label, options, selfType) {
  const values = normalizeArray(value, label);
  writer.u32(values.length);
  const elementType = requireTypeField(type, "element", label);
  values.forEach((item, itemIndex) =>
    encodeValuePayload(writer, elementType, item, `${label}[${itemIndex}]`, options, selfType));
}

function encodeNamedFieldPayloads(writer, fields, values, label, selfType, options) {
  fields.forEach((field) =>
    encodeValuePayload(writer, field.type, values[field.name], `${label}.${field.name}`, options, selfType));
}

function decodeValuePayload(reader, type, options = {}, selfType = null) {
  const expectedTag = requireWireTag(type, "result");
  let value;
  switch (expectedTag) {
    case WIRE.RECURSIVE_SELF:
      if (selfType === null) {
        throw new Error("recursive self result decoded without an enclosing type");
      }
      value = decodeValuePayload(reader, selfType, options, selfType);
      break;
    case WIRE.UNIT:
      value = undefined;
      break;
    case WIRE.RESOURCE:
      if (typeof options.takeOutgoingResource !== "function") {
        throw new Error("resource value decoded without an attached resource queue");
      }
      value = options.takeOutgoingResource("resource result");
      break;
    case WIRE.FUNCTION:
      if (typeof options.createCallback !== "function") {
        throw new Error("function value decoded without an attached VirRuntime");
      }
      if (typeof options.takeOutgoingClosureRootId !== "function") {
        throw new Error("function value decoded without an attached closure root queue");
      }
      value = options.createCallback(options.takeOutgoingClosureRootId("function result"), type);
      break;
    case WIRE.NAT:
    case WIRE.INT:
    case WIRE.UINT64:
    case WIRE.USIZE:
      value = reader.string();
      break;
    case WIRE.BOOL:
      value = reader.u8() !== 0;
      break;
    case WIRE.STRING:
      value = reader.string();
      break;
    case WIRE.UINT8:
      value = reader.u8();
      break;
    case WIRE.UINT16:
    case WIRE.UINT32:
      value = reader.u32();
      break;
    case WIRE.BYTE_ARRAY:
      value = reader.bytesValue();
      break;
    case WIRE.FLOAT:
      value = reader.f64();
      break;
    case WIRE.FLOAT32:
      value = reader.f32();
      break;
    case WIRE.SIMPLE_ENUM:
      value = enumValue(type, reader.u32());
      break;
    case WIRE.EXPR:
      value = decodeExpr(reader);
      break;
    case WIRE.ARRAY:
    case WIRE.LIST:
      value = decodeSequencePayload(reader, type, options, selfType);
      break;
    case WIRE.OPTION:
      value = reader.u8() === 0 ? null : decodeValuePayload(reader, requireTypeField(type, "element", "result"), options, selfType);
      break;
    case WIRE.PROD:
      value = {
        fst: decodeValuePayload(reader, requireTypeField(type, "fst", "result"), options, selfType),
        snd: decodeValuePayload(reader, requireTypeField(type, "snd", "result"), options, selfType),
      };
      break;
    case WIRE.STRUCTURE: {
      value = decodeNamedFieldPayloads(reader, requireStructureFields(type, "result"), options, type);
      value = flattenStructureSubobjects(type, value);
      break;
    }
    case WIRE.TAGGED_UNION: {
      const index = reader.u32();
      const ctor = taggedUnionConstructorAt(type, index, "result");
      value = {
        kind: ctor.jsName,
        value: decodeValuePayload(reader, ctor.type, options, selfType),
      };
      break;
    }
    case WIRE.CUSTOM_INDUCTIVE: {
      const index = reader.u32();
      const ctor = customInductiveConstructorAt(type, index, "result");
      const fields = decodeNamedFieldPayloads(reader, ctor.fields, options, type);
      value = ctor.fields.length === 0 ? { kind: ctor.jsName } : {
        kind: ctor.jsName,
        ...(ctor.fields.length === 1 ? { value: fields[ctor.fields[0].name] } : { fields }),
      };
      break;
    }
    default:
      throw new Error(`unsupported result wire tag ${expectedTag}`);
  }
  return value;
}

function decodeSequencePayload(reader, type, options, selfType) {
  const len = reader.u32();
  const elementType = requireTypeField(type, "element", "result");
  return Array.from({ length: len }, () => decodeValuePayload(reader, elementType, options, selfType));
}

function decodeNamedFieldPayloads(reader, fields, options, selfType) {
  const values = {};
  for (const field of fields) {
    values[field.name] = decodeValuePayload(reader, field.type, options, selfType);
  }
  return values;
}
