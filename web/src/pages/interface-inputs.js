/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { JSON_INPUT_WIRE_TAGS, WIRE } from "../runtime/wire-tags.js";

export function interfaceInputTag(type) {
  if (type?.wireTag === WIRE.SIMPLE_ENUM) return "SELECT";
  if (isJsonInputTag(type?.wireTag)) return "TEXTAREA";
  return "INPUT";
}

export function inputDefault(input) {
  const value = defaultValueForType(input.type);
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function parseBoolText(text) {
  if (text === true || text === false) return text;
  if (String(text).trim() === "true") return true;
  if (String(text).trim() === "false") return false;
  return false;
}

export function isJsonInputTag(tag) {
  return JSON_INPUT_WIRE_TAGS.has(tag);
}

export function defaultValueForType(type, selfType = null, depth = 0) {
  switch (type?.wireTag) {
    case WIRE.RECURSIVE_SELF:
      return selfType && depth < 2 ? defaultValueForType(selfType, selfType, depth + 1) : null;
    case WIRE.NAT:
    case WIRE.INT:
    case WIRE.UINT8:
    case WIRE.UINT16:
    case WIRE.UINT32:
    case WIRE.UINT64:
    case WIRE.USIZE:
    case WIRE.FLOAT:
    case WIRE.FLOAT32:
      return 0;
    case WIRE.BOOL:
      return false;
    case WIRE.STRING:
      return "";
    case WIRE.BYTE_ARRAY:
      return [];
    case WIRE.EXPR:
      return { kind: "const", name: "Nat", levels: [] };
    case WIRE.ARRAY:
    case WIRE.LIST:
      return [];
    case WIRE.OPTION:
      return null;
    case WIRE.PROD:
      return {
        fst: defaultValueForType(type?.fst, selfType, depth),
        snd: defaultValueForType(type?.snd, selfType, depth),
      };
    case WIRE.STRUCTURE:
      return defaultStructureValue(type, depth);
    case WIRE.TAGGED_UNION:
      return defaultTaggedUnionValue(type);
    case WIRE.CUSTOM_INDUCTIVE:
      return defaultCustomInductiveValue(type, depth);
    case WIRE.SIMPLE_ENUM:
      return type?.constructors?.[0]?.jsName ?? "";
    default:
      return "";
  }
}

function defaultStructureValue(type, depth = 0) {
  const value = {};
  for (const field of type?.fields ?? []) {
    if (field.subobject === true) {
      Object.assign(value, defaultValueForType(field.type, type, depth + 1));
    } else {
      value[field.name] = defaultValueForType(field.type, type, depth + 1);
    }
  }
  return value;
}

function defaultTaggedUnionValue(type) {
  const ctor = type?.constructors?.[0];
  if (!ctor) return { kind: "", value: null };
  return {
    kind: ctor.jsName ?? ctor.name,
    value: defaultValueForType(ctor.type),
  };
}

function defaultCustomInductiveValue(type, depth = 0) {
  const ctor = type?.constructors?.[0];
  if (!ctor) return { kind: "", value: null };
  const kind = ctor.jsName ?? ctor.name;
  if ((ctor.fields ?? []).length === 0) {
    return { kind };
  }
  if ((ctor.fields ?? []).length === 1) {
    return {
      kind,
      value: defaultValueForType(ctor.fields[0].type, type, depth + 1),
    };
  }
  const fields = {};
  for (const field of ctor.fields ?? []) {
    fields[field.name] = defaultValueForType(field.type, type, depth + 1);
  }
  return { kind, fields };
}
