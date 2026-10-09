/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { INTERFACE_TAG } from "../../src/runtime/interface-tags.js";
import { constructorValue } from "../../src/runtime/vir-value-normalizers.js";

const JSON_INPUT_INTERFACE_TAGS = new Set([
  INTERFACE_TAG.EXPR,
  INTERFACE_TAG.ARRAY,
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

export function defaultValueForType(type, bindings = [], depth = 0) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.UNIT:
      return null;
    case INTERFACE_TAG.RECURSIVE_REF:
      return bindings[type.depth] && depth < 2
        ? defaultValueForType(
            bindings[type.depth],
            bindings.slice(type.depth + 1),
            depth + 1,
          )
        : null;
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
      return [];
    case INTERFACE_TAG.STRUCTURE:
      return defaultStructureValue(type, bindings, depth);
    case INTERFACE_TAG.TAGGED_UNION:
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return type.name === "List"
        ? []
        : constructorTemplate(type, type.constructors[0], depth, bindings);
    case INTERFACE_TAG.SIMPLE_ENUM:
      return type.constructors[0].jsName;
    default:
      return "";
  }
}

function defaultStructureValue(type, bindings, depth = 0) {
  const value = {};
  for (const field of type?.fields ?? []) {
    if (field.subobject === true) {
      Object.assign(
        value,
        defaultValueForType(field.type, [type, ...bindings], depth + 1),
      );
    } else {
      value[field.name] = defaultValueForType(
        field.type,
        [type, ...bindings],
        depth + 1,
      );
    }
  }
  return value;
}

// Editable suggestion for admitted descriptors; recursive positions may need edits.
export function constructorTemplate(type, ctor, depth = 0, bindings = []) {
  if (type.interfaceTag === INTERFACE_TAG.TAGGED_UNION) {
    return constructorValue(
      type,
      ctor,
      defaultValueForType(ctor.type, bindings, depth + 1),
    );
  }
  if (ctor.fields.length === 1)
    return constructorValue(
      type,
      ctor,
      defaultValueForType(ctor.fields[0].type, [type, ...bindings], depth + 1),
    );
  const values = Object.fromEntries(
    ctor.fields.map((field) => [
      field.name,
      defaultValueForType(field.type, [type, ...bindings], depth + 1),
    ]),
  );
  return constructorValue(type, ctor, values);
}
