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
  Lean.Vir.LeanRef.releaseJSL action
  pure result

def useReleased : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL Action.feed
  Lean.Vir.LeanRef.releaseJSL action
  match ← Lean.Vir.LeanRef.fromJSL action with
  | .rename value => pure value
  | .feed => pure "feed"

def roundtripFeed : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL Action.feed
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL action with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.releaseJSL action
  pure result

end Vir.Fixtures.FreshLeanRef
