/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/*
The serialized manifest field is still named `wireTag` for package
compatibility. These numeric tags now describe the interface value codec, not
the ordinary host-import `wire` boundary.
*/
export const INTERFACE_TAG = Object.freeze({
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
  LEAN_OBJECT: 27,
});

// Backward-compatible SDK alias. Prefer INTERFACE_TAG in new runtime code.
export const WIRE = INTERFACE_TAG;

export const SUPPORTED_INTERFACE_TAGS = new Set(Object.values(INTERFACE_TAG));

// Backward-compatible SDK alias.
export const SUPPORTED_WIRE_TAGS = SUPPORTED_INTERFACE_TAGS;

export const JSON_INPUT_INTERFACE_TAGS = new Set([
  INTERFACE_TAG.EXPR,
  INTERFACE_TAG.ARRAY,
  INTERFACE_TAG.LIST,
  INTERFACE_TAG.OPTION,
  INTERFACE_TAG.PROD,
  INTERFACE_TAG.STRUCTURE,
  INTERFACE_TAG.TAGGED_UNION,
  INTERFACE_TAG.CUSTOM_INDUCTIVE,
]);

// Backward-compatible SDK alias.
export const JSON_INPUT_WIRE_TAGS = JSON_INPUT_INTERFACE_TAGS;
