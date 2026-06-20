import Vir.Js

@[vir_js "test.runtime.value"]
private opaque runtimeValueHost : Lean.Vir.RuntimeM Nat

def runtimeValue : Lean.Vir.RuntimeM Nat :=
  runtimeValueHost
