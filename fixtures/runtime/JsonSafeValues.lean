/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
meta import Vir.Attributes
public section
namespace JsonSafeValues

@[vir_export] def nestedIdentity (value : Option (Option Nat)) := value
@[vir_export] def nestedKind : Option (Option Nat) → UInt32
  | none => 0
  | some none => 1
  | some (some _) => 2
@[vir_export] def nestedAmount : Option (Option Nat) → Nat
  | some (some value) => value
  | _ => 0
@[vir_export] def unitIdentity (value : Option Unit) := value
@[vir_export] def unitPresent (value : Option Unit) := value.isSome
@[vir_export] def intIdentity (value : Int) := value
@[vir_export] def bytesIdentity (value : ByteArray) := value

structure Packed where
  large : UInt64
  marker : Bool
  size : USize
  tiny : UInt8

@[vir_export] def packedIdentity (value : Packed) := value
@[vir_export] def packedAmount (value : Packed) := value.large
@[vir_export] def packedMarker (value : Packed) := value.marker

inductive Tree where
  | leaf (amount : Nat)
  | node (children : List Tree)

@[vir_export] def treeIdentity (value : Tree) := value
@[vir_export] def treeFirstAmount : Tree → Nat
  | .leaf n => n
  | .node (.leaf n :: _) => n
  | _ => 0

structure Row where
  label : String
  count : Nat

@[vir_export] def rowsIdentity (value : Array Row) := value
@[vir_export] def rowsTotal (value : Array Row) := value.foldl (fun acc row => acc + row.count) 0
end JsonSafeValues
