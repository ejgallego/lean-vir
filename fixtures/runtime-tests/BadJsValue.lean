import Vir.Js

namespace Vir.Fixtures.BadJsValue

inductive Action where
  | feed
  | rename (name : String)

@[vir_js_explicit_conversion "js.value.bad.action"]
opaque actionToString (action : @& Action) : Lean.Vir.RuntimeM String

def roundtripFeed : Lean.Vir.RuntimeM String :=
  actionToString Action.feed

end Vir.Fixtures.BadJsValue
