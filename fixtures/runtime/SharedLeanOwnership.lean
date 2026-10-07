/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module

public import Vir.Js
public meta import Vir.Attributes

public section

open Lean.Vir

@[vir_js "test.sharedOwnership.reenter"]
opaque reenter : RuntimeM Unit

@[vir_export]
def pureCallback (count : Nat) : RuntimeM (Nat → Nat) := do
  let values := Array.range count
  pure (fun initial => values.foldl (· + ·) initial)

@[vir_export]
def heldState (count : Nat) : RuntimeM (JSL (Array Nat)) :=
  LeanRef.toJSL (Array.range count)

@[vir_export]
def callbackFromHeld (state : JSL (Array Nat)) : RuntimeM (Nat → RuntimeM Nat) := do
  let values ← LeanRef.fromJSL state
  pure (fun initial => do
    reenter
    pure (values.foldl (· + ·) initial))
