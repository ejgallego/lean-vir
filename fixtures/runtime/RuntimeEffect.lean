import Vir.Js

@[vir_js "test.runtime.value"]
private opaque runtimeValueHost : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def runtimeValue : Lean.Vir.RuntimeM Nat := do
  let value ← runtimeValueHost
  Lean.Vir.JsValue.toNat value
