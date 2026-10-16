/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Type grammar, including the pending JSON-safe codec format extension.
// The published manifest-12/runtime-6 pair does not support these additions.
// Normative constraints: docs/reference/IRPKG_FORMAT.md#interface-descriptors.
// This is neither a runtime module nor a public descriptor-construction API.
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
  | { readonly tag: "scalar"; readonly size: 1 | 2 | 4 | 8; readonly offset: number };

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
      // Private pure codec operation nameKey for computed constructor storage.
      readonly operation?: string;
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
  // Callable positions start closed roots; refs occur only inside their metadata.
  readonly args: readonly NativeDescriptor[];
  readonly result: NativeDescriptor;
  readonly effect: Effect;
}

// Facts for optional codec binding. This is not another native-kind union:
// opaque object passage needs none of these fields. A structural codec requires
// constructors, an array codec requires arrayElement, a callable requires signature.
// Admission checks facts against the producer's type and the selected operation.
interface DeclarationMetadata {
  readonly declaration?: DeclarationName;
}

// Storage forms are mutually exclusive. Primitives/resources may carry identity
// only; layout, array and callable facts belong exclusively to Lean objects.
type IdentityMetadata = DeclarationMetadata & {
  readonly constructors?: never;
  readonly arrayElement?: never;
  readonly signature?: never;
  readonly adapter?: never;
};
export type CompilerMetadata = DeclarationMetadata & (
  | IdentityMetadata
  | {
      readonly constructors: readonly [ConstructorDescriptor, ...ConstructorDescriptor[]];
      readonly arrayElement?: never;
      readonly signature?: never;
      readonly adapter?: never;
    }
  | {
      readonly constructors?: never;
      readonly arrayElement: DescriptorRef;
      readonly signature?: never;
      readonly adapter?: never;
    }
  | {
      readonly constructors?: never;
      readonly arrayElement?: never;
      readonly signature: NativeSignature;
      readonly adapter?: never;
    }
  | {
      readonly constructors?: never;
      readonly arrayElement?: never;
      readonly signature?: never;
      readonly adapter: {
        // A complete closed domain; it cannot capture enclosing recursive owners.
        readonly wire: NativeDescriptor;
        readonly decode: string; // private operation nameKey
        readonly encode: string; // private operation nameKey
      };
    }
);

export type NativeDescriptor =
  | {
      readonly type: PrimitiveType | { readonly tag: "resource" };
      readonly metadata?: IdentityMetadata;
    }
  | {
      readonly type: { readonly tag: "leanObject" };
      readonly metadata?: CompilerMetadata;
    };

// Field positions are declaration/projection order, never physical slot indices.
// A path crosses native fields, e.g. [0, 1] for an inherited parent's field.
export interface RecordFieldInterface {
  readonly key: string;
  readonly path: readonly [number, ...number[]];
  readonly value: ValueInterface;
  readonly check?:
    | { readonly tag: "unicodeScalar" }
    | { readonly tag: "natLt"; readonly bound: string };
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
  | { readonly tag: "string" }
  | { readonly tag: "bytes" }
  | { readonly tag: "unit" }
  | { readonly tag: "boolean"; readonly false: number; readonly true: number }
  | { readonly tag: "enum"; readonly cases: readonly [string, ...string[]] }
  | { readonly tag: "record"; readonly fields: readonly RecordFieldInterface[] }
  | {
      readonly tag: "variant";
      readonly cases: readonly [ConstructorInterface, ...ConstructorInterface[]];
    }
  | {
      readonly tag: "sequence";
      readonly element: ValueInterface;
      readonly chain?: ChainTraversal;
    }
  | { readonly tag: "recursive" }
  | { readonly tag: "adapted"; readonly wire: ValueInterface }
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

// The callable signature, not the manifest entry with named arguments/provenance.
export interface CallableInterface {
  readonly args: readonly BoundaryInterface[];
  readonly result: BoundaryInterface;
  readonly effect: Effect;
}

// Wire indices are package-local u32 positions. They select whole closed pairs;
// RecursiveDescriptorRef.ref remains a separate lexical depth inside a pair.
export type ManifestInterfaceIndex = number;
export interface ManifestArgument {
  readonly name: string;
  readonly type: ManifestInterfaceIndex;
}
// Callable positions only; entry/provenance/host fields are separate manifest facts.
export interface ManifestCallSignature {
  readonly args: readonly ManifestArgument[];
  readonly result: ManifestInterfaceIndex;
  readonly effect: Effect;
}
export interface ManifestBoundaryTable {
  readonly interfaces: readonly BoundaryInterface[];
}

// Counts, positions, depths and indices are u32 values. Admission additionally
// checks storage coverage and widths (including erased identity wrappers),
// disjoint in-range field paths, constructor/mapping coverage and distinct JS
// spellings, native/view compatibility and closed lexical recursive scopes.
// Those semantic constraints are normative in the format reference above.
