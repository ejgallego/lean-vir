import Vir.Host
import Vir.Js

structure HostCounter where
  label : String
  value : Nat
  enabled : Bool
deriving Inhabited

@[vir_js "test.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

@[vir_js "test.bumpCounter"]
opaque jsBumpCounter (counter : HostCounter) : HostCounter

@[vir_js "test.callbackResult"]
opaque jsCallbackResult : Lean.Vir.RuntimeM (Unit → Lean.Vir.RuntimeM Unit)

@[vir_js "test.arrayLength"]
opaque jsArrayLength (arrayItems : Array (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

@[vir_js "test.listLength"]
opaque jsListLength (listItems : List (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def freshCustomBump (n : Nat) : Nat :=
  jsBumpNat n

def freshCustomCounter (counter : HostCounter) : HostCounter :=
  jsBumpCounter counter

def freshCustomCallbackResult : Lean.Vir.RuntimeM Unit := do
  let callback ← jsCallbackResult
  callback ()

def freshCustomArrayLength (items : Array (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsArrayLength items

def freshCustomListLength (items : List (Lean.Vir.Js Nat)) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat) :=
  jsListLength items
