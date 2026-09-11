/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js

public section

namespace Vir.Fixtures.JsNatNumber

open Lean.Vir

def checked (value : Nat) : RuntimeM (Option (Js Float)) :=
  JsValue.ofNatNumber? value

def bigint (value : Nat) : RuntimeM (Js Nat) :=
  JsValue.ofNat value

def roundtrip (value : Nat) : RuntimeM Nat := do
  JsValue.toNat (← JsValue.ofNat value)

end Vir.Fixtures.JsNatNumber
