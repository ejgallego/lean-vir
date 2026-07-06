import Vir.Js

namespace Vir.Fixtures.CustomJsValue

structure Payload where
  name : String
  count : Nat

@[vir_js_explicit_conversion "test.payload"]
opaque payloadToJs (payload : @& Payload) : Lean.Vir.RuntimeM (Lean.Vir.Js Payload)

def makePayload : Lean.Vir.RuntimeM (Lean.Vir.Js Payload) :=
  payloadToJs { name := "custom", count := 3 }

end Vir.Fixtures.CustomJsValue
