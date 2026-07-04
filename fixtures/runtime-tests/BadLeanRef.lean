import Vir.Js

namespace Vir.Fixtures.BadLeanRef

inductive Action where
  | feed
  | rename (name : String)

@[vir_js "js.leanRef"]
opaque actionToJs (action : @& Action) : Lean.Vir.RuntimeM (Lean.Vir.Js Action)

@[vir_js "js.leanRef.value"]
opaque actionFromJs (action : @& Lean.Vir.Js Action) : Lean.Vir.RuntimeM Action

def roundtripFeed : Lean.Vir.RuntimeM String := do
  let action ← actionToJs Action.feed
  match ← actionFromJs action with
  | .rename value => pure value
  | .feed => pure "feed"

end Vir.Fixtures.BadLeanRef
