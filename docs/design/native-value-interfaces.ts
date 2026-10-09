/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Draft contract, not a runtime module or a supported construction API.
// NativeDescriptor owns ABI facts; ValueInterface owns a chosen JS encoding.

export type Effect = "pure" | "runtime" | "io" | "dom" | "react";
export type UnsignedWidth = 8 | 16 | 32 | 64 | "usize";
export type FloatWidth = 32 | 64;

// Declaration identity. Production encoding follows the package's canonical
// Lean Name encoding; consumers do not derive JS spellings from this identity.
export type DeclarationName = string;

export interface ConstructorStorage {
  readonly objectFieldCount: number;
  readonly usizeFieldCount: number;
  readonly scalarByteSize: number;
}

export type FieldLocation =
  | { readonly tag: "object"; readonly index: number }
  | { readonly tag: "usize"; readonly index: number }
  | { readonly tag: "scalar"; readonly size: number; readonly offset: number };

export interface NativeField {
  readonly name: string;
  readonly type: NativeDescriptor;
}

export interface StoredField extends NativeField {
  readonly location: FieldLocation;
}

interface ConstructorIdentity {
  readonly name: DeclarationName;
}

// The position in constructors is the ordinal. There is no second tag field.
export type ConstructorDescriptor = ConstructorIdentity & (
  | {
      readonly representation: "immediate";
      readonly fields: readonly [];
    }
  | {
      readonly representation: "object";
      readonly storage: ConstructorStorage;
      readonly fields: readonly StoredField[];
    }
  | {
      readonly representation: "identity";
      readonly fields: readonly [NativeField];
    }
);

export interface NativeSignature {
  readonly args: readonly NativeDescriptor[];
  readonly result: NativeDescriptor;
  readonly effect: Effect;
}

export type NativeDescriptor =
  | { readonly tag: "nat" }
  | { readonly tag: "int" }
  | { readonly tag: "string" }
  | { readonly tag: "byteArray" }
  | { readonly tag: "unsigned"; readonly width: UnsignedWidth }
  | { readonly tag: "float"; readonly width: FloatWidth }
  | { readonly tag: "array"; readonly element: NativeDescriptor }
  | {
      readonly tag: "constructors";
      readonly name: DeclarationName;
      readonly constructors: readonly ConstructorDescriptor[];
    }
  | { readonly tag: "recursive"; readonly depth: number }
  | { readonly tag: "jsResource"; readonly name: DeclarationName }
  | { readonly tag: "leanObject" }
  | { readonly tag: "function"; readonly signature: NativeSignature }
  | { readonly tag: "expr" };

export type NativeTag = NativeDescriptor["tag"];

// Field positions are declaration/projection order, never physical slot indices.
// A path crosses native fields, e.g. [0, 1] for an inherited parent's field.
export interface RecordFieldInterface {
  readonly key: string;
  readonly path: readonly number[];
  readonly value: ValueInterface;
}

export type ConstructorInterface = {
  readonly kind: string;
} & (
  | { readonly payload: "none" }
  | { readonly payload: "value"; readonly value: ValueInterface }
  | {
      readonly payload: "fields";
      readonly fields: readonly RecordFieldInterface[];
    }
);

// A linked traversal selects logical constructors and fields. Physical tags,
// object slots and allocation sizes still come exclusively from the descriptor.
export interface ChainTraversal {
  readonly nil: number;
  readonly cons: number;
  readonly head: number;
  readonly tail: number;
}

export type ValueInterface =
  | { readonly tag: "bigint" }
  | { readonly tag: "number" }
  | { readonly tag: "safeInteger" }
  | { readonly tag: "string" }
  | { readonly tag: "bytes" }
  | { readonly tag: "unit" }
  | { readonly tag: "boolean"; readonly false: number; readonly true: number }
  | { readonly tag: "enum"; readonly cases: readonly string[] }
  | { readonly tag: "record"; readonly fields: readonly RecordFieldInterface[] }
  | {
      readonly tag: "variant";
      readonly cases: readonly ConstructorInterface[];
    }
  | {
      readonly tag: "sequence";
      readonly element: ValueInterface;
      readonly chain?: ChainTraversal;
    }
  | { readonly tag: "recursive" }
  | { readonly tag: "jsReference" }
  | { readonly tag: "leanReference" }
  | {
      readonly tag: "function";
      readonly args: readonly ValueInterface[];
      readonly result: ValueInterface;
    }
  | { readonly tag: "expr" };

export type ValueTag = ValueInterface["tag"];

export interface BoundaryInterface {
  readonly native: NativeDescriptor;
  readonly value: ValueInterface;
}

export interface ExportInterface {
  readonly args: readonly BoundaryInterface[];
  readonly result: BoundaryInterface;
  readonly effect: Effect;
}

// Concrete examples use the same native descriptor with different value views.
// These layout facts illustrate the draft, not a replacement metadata producer.
export const optionNatDescriptor: NativeDescriptor = {
  tag: "constructors",
  name: "Option",
  constructors: [
    { name: "Option.none", representation: "immediate", fields: [] },
    {
      name: "Option.some",
      representation: "object",
      storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
      fields: [
        {
          name: "val",
          type: { tag: "nat" },
          location: { tag: "object", index: 0 },
        },
      ],
    },
  ],
};

export const taggedOptionNat: BoundaryInterface = {
  native: optionNatDescriptor,
  value: {
    tag: "variant",
    cases: [
      { kind: "none", payload: "none" },
      { kind: "some", payload: "value", value: { tag: "bigint" } },
    ],
  },
};

// The caller chooses a different spelling, without changing layout metadata.
export const alternateOptionNat: BoundaryInterface = {
  native: optionNatDescriptor,
  value: {
    tag: "variant",
    cases: [
      { kind: "absent", payload: "none" },
      { kind: "present", payload: "value", value: { tag: "bigint" } },
    ],
  },
};

export const listNatDescriptor: NativeDescriptor = {
  tag: "constructors",
  name: "List",
  constructors: [
    { name: "List.nil", representation: "immediate", fields: [] },
    {
      name: "List.cons",
      representation: "object",
      storage: { objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0 },
      fields: [
        {
          name: "head",
          type: { tag: "nat" },
          location: { tag: "object", index: 0 },
        },
        {
          name: "tail",
          type: { tag: "recursive", depth: 0 },
          location: { tag: "object", index: 1 },
        },
      ],
    },
  ],
};

export const arrayListNat: BoundaryInterface = {
  native: listNatDescriptor,
  value: {
    tag: "sequence",
    chain: { nil: 0, cons: 1, head: 0, tail: 1 },
    element: { tag: "bigint" },
  },
};

export const constructorListNat: BoundaryInterface = {
  native: listNatDescriptor,
  value: {
    tag: "variant",
    cases: [
      { kind: "nil", payload: "none" },
      {
        kind: "cons",
        payload: "fields",
        fields: [
          { key: "head", path: [0], value: { tag: "bigint" } },
          { key: "tail", path: [1], value: { tag: "recursive" } },
        ],
      },
    ],
  },
};
