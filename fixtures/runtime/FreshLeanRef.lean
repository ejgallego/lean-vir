import Vir.Js

namespace Vir.Fixtures.FreshLeanRef

inductive Action where
  | feed
  | rename (name : String)

def roundtripName (name : String) : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL (Action.rename name)
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL action with
    | .rename value => pure value
    | .feed => pure "feed"
  pure result

def nullablePreservesValue : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL (Action.rename "nullable")
  let nullable ← Lean.Vir.Js.Nullable.ofJs action
  let stored ← Lean.Vir.Js.Nullable.get nullable
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL stored with
    | .rename value => pure value
    | .feed => pure "feed"
  pure result

def roundtripFeed : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL Action.feed
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL action with
    | .rename value => pure value
    | .feed => pure "feed"
  pure result

end Vir.Fixtures.FreshLeanRef
