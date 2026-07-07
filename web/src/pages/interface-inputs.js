/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { JSON_INPUT_INTERFACE_TAGS, INTERFACE_TAG } from "../runtime/interface-tags.js";

export function interfaceInputTag(type) {
  if (type?.interfaceTag === INTERFACE_TAG.SIMPLE_ENUM) return "SELECT";
  if (isJsonInputTag(type?.interfaceTag)) return "TEXTAREA";
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
  return JSON_INPUT_INTERFACE_TAGS.has(tag);
}

export function defaultValueForType(type, selfType = null, depth = 0) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.RECURSIVE_SELF:
      return selfType && depth < 2 ? defaultValueForType(selfType, selfType, depth + 1) : null;
    case INTERFACE_TAG.NAT:
    case INTERFACE_TAG.INT:
    case INTERFACE_TAG.UINT8:
    case INTERFACE_TAG.UINT16:
    case INTERFACE_TAG.UINT32:
    case INTERFACE_TAG.UINT64:
    case INTERFACE_TAG.USIZE:
    case INTERFACE_TAG.FLOAT:
    case INTERFACE_TAG.FLOAT32:
      return 0;
    case INTERFACE_TAG.BOOL:
      return false;
    case INTERFACE_TAG.STRING:
      return "";
    case INTERFACE_TAG.BYTE_ARRAY:
      return [];
    case INTERFACE_TAG.EXPR:
      return { kind: "const", name: "Nat", levels: [] };
    case INTERFACE_TAG.ARRAY:
    case INTERFACE_TAG.LIST:
      return [];
    case INTERFACE_TAG.OPTION:
      return null;
    case INTERFACE_TAG.PROD:
      return {
        fst: defaultValueForType(type?.fst, selfType, depth),
        snd: defaultValueForType(type?.snd, selfType, depth),
      };
    case INTERFACE_TAG.STRUCTURE:
      return defaultStructureValue(type, depth);
    case INTERFACE_TAG.TAGGED_UNION:
      return defaultTaggedUnionValue(type);
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return defaultCustomInductiveValue(type, depth);
    case INTERFACE_TAG.SIMPLE_ENUM:
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
