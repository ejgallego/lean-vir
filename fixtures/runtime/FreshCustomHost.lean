import Vir.Host
import Vir.Js

structure HostCounter where
  label : String
  value : Nat
  enabled : Bool
deriving Inhabited

-- Bypass `@[vir_js]` so package generation still exercises its final fallback.
@[extern "__vir_js:test.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

@[extern "__vir_js:test.bumpCounter"]
opaque jsBumpCounter (counter : HostCounter) : HostCounter

@[extern "__vir_js:test.callbackResult"]
opaque jsCallbackResult : Lean.Vir.RuntimeM (Unit → Lean.Vir.RuntimeM Unit)

@[extern "__vir_js:test.nestedCallbackArg"]
opaque jsNestedCallbackArg
    (callback : (Lean.Vir.Js Nat → Lean.Vir.RuntimeM Unit) → Lean.Vir.RuntimeM Unit) :
    Lean.Vir.RuntimeM Unit

@[extern "__vir_js:test.arrayLength"]
opaque jsArrayLength (arrayItems : Array (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

@[extern "__vir_js:test.listLength"]
opaque jsListLength (listItems : List (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

@[extern "__vir_js:test.optionValue"]
opaque jsOptionValue (value : Option (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

@[extern "__vir_js:test.prodValue"]
opaque jsProdValue (value : Lean.Vir.Js Nat × Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def freshCustomBump (n : Nat) : Nat :=
  jsBumpNat n

def freshCustomCounter (counter : HostCounter) : HostCounter :=
  jsBumpCounter counter

def freshCustomCallbackResult : Lean.Vir.RuntimeM Unit := do
  let callback ← jsCallbackResult
  callback ()

def freshCustomNestedCallbackArg : Lean.Vir.RuntimeM Unit :=
  jsNestedCallbackArg (fun _ => pure ())

def freshCustomArrayLength (items : Array (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsArrayLength items

def freshCustomListLength (items : List (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsListLength items

def freshCustomOptionValue (value : Option (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsOptionValue value

def freshCustomProdValue (value : Lean.Vir.Js Nat × Lean.Vir.Js Nat) :
    Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsProdValue value
