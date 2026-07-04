import Vir.Js

namespace Vir.Fixtures.BadJsValue

inductive Action where
  | feed
  | rename (name : String)

@[vir_js_explicit_conversion "js.value.bad.action"]
opaque actionToJs (action : @& Action) : Lean.Vir.RuntimeM (Lean.Vir.Js Action)

def roundtripFeed : Lean.Vir.RuntimeM (Lean.Vir.Js Action) :=
  actionToJs Action.feed

end Vir.Fixtures.BadJsValue
