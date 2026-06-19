import Vir.Host

structure HostCounter where
  label : String
  value : Nat
  enabled : Bool
deriving Inhabited

@[vir_js "test.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

@[vir_js "test.bumpCounter"]
opaque jsBumpCounter (counter : HostCounter) : HostCounter

def freshCustomBump (n : Nat) : Nat :=
  jsBumpNat n

def freshCustomCounter (counter : HostCounter) : HostCounter :=
  jsBumpCounter counter
