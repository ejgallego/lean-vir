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

def freshCustomBump (n : Nat) : Nat :=
  jsBumpNat n

def freshCustomCounter (counter : HostCounter) : HostCounter :=
  jsBumpCounter counter

def freshCustomCallbackResult : Lean.Vir.RuntimeM Unit := do
  let callback ← jsCallbackResult
  callback ()
