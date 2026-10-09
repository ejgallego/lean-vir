/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Draft contract, not a runtime module or a supported construction API.
// NativeType is the core boundary. Compiler metadata feeds optional codecs;
// ValueInterface chooses a JS encoding without changing that boundary.

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
  readonly type: DescriptorRef;
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

// These primitive kinds select scalar, text and byte operations. Array storage
// is Lean-object storage; its element fact belongs to optional codec metadata.
export type PrimitiveType =
  | { readonly tag: "nat" }
  | { readonly tag: "int" }
  | { readonly tag: "string" }
  | { readonly tag: "byteArray" }
  | { readonly tag: "unsigned"; readonly width: UnsignedWidth }
  | { readonly tag: "float"; readonly width: FloatWidth };

export type NativeType = PrimitiveType
  | { readonly tag: "leanObject" }
  | { readonly tag: "resource" };

export type NativeTag = NativeType["tag"];

// A reference in compiler metadata, not a native type or a runtime capability.
// Its depth is relative to enclosing constructor descriptions.
export interface RecursiveDescriptorRef {
  readonly ref: number;
}
export type DescriptorRef = NativeDescriptor | RecursiveDescriptorRef;

export interface NativeSignature {
  readonly args: readonly DescriptorRef[];
  readonly result: DescriptorRef;
  readonly effect: Effect;
}

// Facts for optional codec binding. This is not another native-kind union:
// opaque object passage needs none of these fields. A structural codec requires
// constructors, an array codec requires arrayElement, a callable requires signature.
// Admission checks facts against the producer's type and the selected operation.
export interface CompilerMetadata {
  readonly declaration?: DeclarationName;
  readonly constructors?: readonly ConstructorDescriptor[];
  // Present only for compiler-confirmed native Lean Array storage.
  readonly arrayElement?: DescriptorRef;
  readonly signature?: NativeSignature;
}

export interface NativeDescriptor {
  readonly type: NativeType;
  readonly metadata?: CompilerMetadata;
}

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
  readonly native: DescriptorRef;
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
  type: { tag: "leanObject" },
  metadata: {
    declaration: "Option",
    constructors: [
      { name: "Option.none", representation: "immediate", fields: [] },
      {
        name: "Option.some", representation: "object",
        storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
        fields: [{
          name: "val", type: { type: { tag: "nat" } },
          location: { tag: "object", index: 0 },
        }],
      },
    ],
  },
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
  type: { tag: "leanObject" },
  metadata: {
    declaration: "List",
    constructors: [
      { name: "List.nil", representation: "immediate", fields: [] },
      {
        name: "List.cons", representation: "object",
        storage: { objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0 },
        fields: [
          { name: "head", type: { type: { tag: "nat" } }, location: { tag: "object", index: 0 } },
          { name: "tail", type: { ref: 0 }, location: { tag: "object", index: 1 } },
        ],
      },
    ],
  },
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

// Retaining a Lean object does not require its constructor layout. Metadata can
// later serve a selected structural codec without adding another core tag.
export const opaqueObject: BoundaryInterface = {
  native: { type: { tag: "leanObject" } },
  value: { tag: "leanReference" },
};

export const exactJsResource: BoundaryInterface = {
  native: { type: { tag: "resource" } },
  value: { tag: "jsReference" },
};

export const arrayNat: BoundaryInterface = {
  native: { type: { tag: "leanObject" }, metadata: { arrayElement: { type: { tag: "nat" } } } },
  value: { tag: "sequence", element: { tag: "bigint" } },
};

// Callability is an operation plus compiler-owned signature, not an object kind.
export const callableObject: BoundaryInterface = {
  native: {
    type: { tag: "leanObject" },
    metadata: { signature: {
      args: [{ type: { tag: "nat" } }],
      result: { type: { tag: "nat" } }, effect: "pure",
    } },
  },
  value: { tag: "function", args: [{ tag: "bigint" }], result: { tag: "bigint" } },
};

// Specialized Expr conversion is an optional operation. Its nominal type must
// be admitted as compatible before binding; the core only retains an object.
export const expressionObject: BoundaryInterface = {
  native: { type: { tag: "leanObject" }, metadata: { declaration: "Lean.Expr" } },
  value: { tag: "expr" },
};
