import Vir.Js

namespace Vir.Fixtures.FreshLeanRef

inductive Action where
  | feed
  | rename (name : String)

def roundtripName (name : String) : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJs (Action.rename name)
  let result ←
    match ← Lean.Vir.LeanRef.fromJs action with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.release action
  pure result

def useReleased : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJs Action.feed
  Lean.Vir.LeanRef.release action
  match ← Lean.Vir.LeanRef.fromJs action with
  | .rename value => pure value
  | .feed => pure "feed"

def roundtripFeed : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJs Action.feed
  let result ←
    match ← Lean.Vir.LeanRef.fromJs action with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.release action
  pure result

end Vir.Fixtures.FreshLeanRef
