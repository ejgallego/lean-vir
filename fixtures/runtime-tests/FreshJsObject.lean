import Vir.Browser
import Vir.Js

@[vir_js "test.js.id"]
private opaque jsId {α : Type} (value : @& Lean.Vir.Js α) : Lean.Vir.RuntimeM (Lean.Vir.Js α)

@[vir_js "test.js.length"]
private opaque jsLength {α : Type} (value : @& Lean.Vir.Js (Array α)) : Lean.Vir.RuntimeM Nat

def freshJsIdNat (value : Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsId value

def freshJsLengthNatArray (value : Lean.Vir.Js (Array Nat)) : Lean.Vir.RuntimeM Nat :=
  jsLength value
