/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { INTERFACE_TAG } from "../../src/runtime/interface-tags.js";

const JSON_INPUT_INTERFACE_TAGS = new Set([
  INTERFACE_TAG.EXPR,
  INTERFACE_TAG.ARRAY,
  INTERFACE_TAG.LIST,
  INTERFACE_TAG.OPTION,
  INTERFACE_TAG.PROD,
  INTERFACE_TAG.STRUCTURE,
  INTERFACE_TAG.TAGGED_UNION,
  INTERFACE_TAG.CUSTOM_INDUCTIVE,
]);

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
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return constructorTemplate(type, type.constructors[0], depth);
    case INTERFACE_TAG.SIMPLE_ENUM:
      return type.constructors[0].jsName;
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

// Editable suggestion for admitted descriptors; recursive positions may need edits.
export function constructorTemplate(type, ctor, depth = 0) {
  const kind = ctor.jsName;
  if (type.interfaceTag === INTERFACE_TAG.TAGGED_UNION) {
    return { kind, value: defaultValueForType(ctor.type) };
  }
  const fields = ctor.fields;
  if (fields.length === 0) {
    return { kind };
  }
  if (fields.length === 1) {
    return {
      kind,
      value: defaultValueForType(fields[0].type, type, depth + 1),
    };
  }
  const values = {};
  for (const field of fields) {
    values[field.name] = defaultValueForType(field.type, type, depth + 1);
  }
  return { kind, fields: values };
}
