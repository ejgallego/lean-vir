module

public import Vir.Browser
public import Vir.Js

public section

@[vir_js "test.js.id"]
private opaque jsId {α : Type} (value : @& Lean.Vir.Js α) : Lean.Vir.RuntimeM (Lean.Vir.Js α)

@[vir_js "test.js.length"]
private opaque jsLength {α : Type} (value : @& Lean.Vir.Js (Array α)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def freshJsIdNat (value : Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsId value

def freshJsLengthNatArray (value : Lean.Vir.Js (Array Nat)) : Lean.Vir.RuntimeM Nat := do
  let length ← jsLength value
  Lean.Vir.JsValue.toNat length
