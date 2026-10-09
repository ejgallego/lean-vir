/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Js
public meta import Vir.Attributes

public section

open Lean.Vir

namespace NativeCodecBench

inductive Mode where
  | off
  | normal
  | precise

structure Sample where
  count : Nat
  delta : Int
  index : UInt32
  wide : UInt64
  score : Float
  enabled : Bool
  mode : Mode
  label : String
  bytes : ByteArray

abbrev Nested := List (Option (Nat × Option (Option Unit)))

inductive Tree where
  | leaf (value : Nat)
  | branch (children : List Tree) (extra : Option Tree)
      (pair : Tree × Bool) (choice : Sum Tree Bool)

@[vir_export] def identityRecords (values : Array Sample) := values
@[vir_export] def consumeRecords (values : Array Sample) := values.size
@[vir_export] def retainRecords (values : Array Sample) : RuntimeM (JSL (Array Sample)) :=
  LeanRef.toJSL values
@[vir_export] def restoreRecords (value : JSL (Array Sample)) : RuntimeM (Array Sample) :=
  LeanRef.fromJSL value

@[vir_export] def identityNested (values : Nested) := values
@[vir_export] def consumeNested (values : Nested) := values.isEmpty
@[vir_export] def retainNested (values : Nested) : RuntimeM (JSL Nested) :=
  LeanRef.toJSL values
@[vir_export] def restoreNested (value : JSL Nested) : RuntimeM Nested :=
  LeanRef.fromJSL value

@[vir_export] def identityTree (value : Tree) := value
@[vir_export] def consumeTree (value : Tree) : Bool :=
  match value with
  | .leaf _ => true
  | .branch .. => false
@[vir_export] def retainTree (value : Tree) : RuntimeM (JSL Tree) :=
  LeanRef.toJSL value
@[vir_export] def restoreTree (value : JSL Tree) : RuntimeM Tree :=
  LeanRef.fromJSL value

@[vir_export] def identityModes (values : Array Mode) := values
@[vir_export] def consumeModes (values : Array Mode) := values.size
@[vir_export] def retainModes (values : Array Mode) : RuntimeM (JSL (Array Mode)) :=
  LeanRef.toJSL values
@[vir_export] def restoreModes (value : JSL (Array Mode)) : RuntimeM (Array Mode) :=
  LeanRef.fromJSL value

@[vir_export] def identityText (value : String) := value
@[vir_export] def consumeText (value : String) := value.isEmpty
@[vir_export] def retainText (value : String) : RuntimeM (JSL String) :=
  LeanRef.toJSL value
@[vir_export] def restoreText (value : JSL String) : RuntimeM String :=
  LeanRef.fromJSL value

@[vir_export] def identityBytes (value : ByteArray) := value
@[vir_export] def consumeBytes (value : ByteArray) := value.size
@[vir_export] def retainBytes (value : ByteArray) : RuntimeM (JSL ByteArray) :=
  LeanRef.toJSL value
@[vir_export] def restoreBytes (value : JSL ByteArray) : RuntimeM ByteArray :=
  LeanRef.fromJSL value

end NativeCodecBench
