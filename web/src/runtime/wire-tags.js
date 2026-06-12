/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const WIRE = Object.freeze({
  NAT: 0,
  INT: 1,
  BOOL: 2,
  STRING: 3,
  UINT8: 4,
  UINT16: 5,
  UINT32: 6,
  UINT64: 7,
  USIZE: 8,
  BYTE_ARRAY: 9,
  FLOAT: 10,
  FLOAT32: 11,
  SIMPLE_ENUM: 14,
  EXPR: 15,
  ARRAY: 16,
  LIST: 17,
  OPTION: 18,
  PROD: 19,
  STRUCTURE: 20,
  TAGGED_UNION: 21,
  UNIT: 22,
  RESOURCE: 23,
  FUNCTION: 24,
  CUSTOM_INDUCTIVE: 25,
  RECURSIVE_SELF: 26,
});

export const SUPPORTED_WIRE_TAGS = new Set(Object.values(WIRE));

export const JSON_INPUT_WIRE_TAGS = new Set([
  WIRE.EXPR,
  WIRE.ARRAY,
  WIRE.LIST,
  WIRE.OPTION,
  WIRE.PROD,
  WIRE.STRUCTURE,
  WIRE.TAGGED_UNION,
  WIRE.CUSTOM_INDUCTIVE,
]);
