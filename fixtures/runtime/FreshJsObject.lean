module

public import Vir.Browser
public import Vir.Js

public section

@[vir_js "test.js.id"]
private opaque jsId {α : Type} (value : @& Lean.Vir.Js α) : Lean.Vir.RuntimeM (Lean.Vir.Js α)

@[vir_js "test.js.length"]
private opaque jsLength {α : Type} (value : @& Lean.Vir.Js (Array α)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

private class ShapeEvidence (α : Type) : Prop where
  valid : True

private instance : ShapeEvidence Lean.Vir.Js.Object.Value := ⟨True.intro⟩

@[vir_js "test.js.proofId"]
private opaque proofId {α : Type} [ShapeEvidence α] (_h : True)
    (value : @& Lean.Vir.Js α) : Lean.Vir.RuntimeM (Lean.Vir.Js α)

@[vir_js "test.js.pureProofId"]
private opaque pureProofId {α : Type} [ShapeEvidence α]
    (value : @& Lean.Vir.Js α) : Lean.Vir.Js α := value

def freshProofId (value : Lean.Vir.Js.Object) : Lean.Vir.RuntimeM Lean.Vir.Js.Object :=
  proofId True.intro value

def freshPureProofId (value : Lean.Vir.Js.Object) : Lean.Vir.Js.Object :=
  pureProofId value

def freshProofContinuation (value : Lean.Vir.Js.Object) : Lean.Vir.RuntimeM Lean.Vir.Js.Object := do
  let result ← proofId True.intro value
  proofId True.intro result

def freshJsIdNat (value : Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsId value

def freshJsLengthNatArray (value : Lean.Vir.Js (Array Nat)) : Lean.Vir.RuntimeM Nat := do
  let length ← jsLength value
  Lean.Vir.JsValue.toNat length
