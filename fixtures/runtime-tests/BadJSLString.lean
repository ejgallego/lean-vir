import Vir.Js

namespace Vir.Fixtures.BadJSLString

def shouldNotTypecheck : Lean.Vir.RuntimeM String := do
  let value ← Lean.Vir.LeanRef.toJSL "not a JavaScript string"
  Lean.Vir.JsValue.toString value

end Vir.Fixtures.BadJSLString
