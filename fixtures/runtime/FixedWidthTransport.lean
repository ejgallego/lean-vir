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

@[vir_export]
def wideCallback (offset : UInt64) : IO (UInt64 → IO UInt64) :=
  pure (fun value => pure (value + offset))

@[vir_export]
def indexCallback (offset : USize) : IO (USize → IO USize) :=
  pure (fun value => pure (value + offset))

@[vir_export]
def natCallback (offset : Nat) : IO (Nat → IO Nat) :=
  pure (fun value => pure (value + offset))

@[vir_export]
def intCallback (offset : Int) : IO (Int → IO Int) :=
  pure (fun value => pure (value + offset))

structure FixedWidthPayload where
  wide : Array UInt64
  indices : Array USize

@[vir_js_explicit_conversion "test.fixedWidth.toJs"]
opaque payloadToJs (value : @& FixedWidthPayload) : RuntimeM (Js FixedWidthPayload)

@[vir_js_explicit_conversion "test.fixedWidth.fromJs"]
opaque payloadFromJs (value : Js FixedWidthPayload) : RuntimeM FixedWidthPayload

@[vir_export]
def payloadRoundtrip (value : FixedWidthPayload) : RuntimeM FixedWidthPayload := do
  payloadFromJs (← payloadToJs value)
