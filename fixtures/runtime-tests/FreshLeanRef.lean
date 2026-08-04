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

def retainedAliasSurvivesRelease : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL (Action.rename "alias")
  let alias ← Lean.Vir.LeanRef.retainJSL action
  Lean.Vir.LeanRef.releaseJSL action
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL alias with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.releaseJSL alias
  pure result

def originalSurvivesAliasRelease : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL Action.feed
  let alias ← Lean.Vir.LeanRef.retainJSL action
  Lean.Vir.LeanRef.releaseJSL alias
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL action with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.releaseJSL action
  pure result

def nullableAliasSurvivesSourceRelease : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL (Action.rename "nullable")
  let nullable ← Lean.Vir.Js.Nullable.ofJs action
  Lean.Vir.LeanRef.releaseJSL action
  let alias ← Lean.Vir.Js.Nullable.get nullable
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL alias with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.releaseJSL alias
  pure result

def roundtripFeed : Lean.Vir.RuntimeM String := do
  let action ← Lean.Vir.LeanRef.toJSL Action.feed
  let result ←
    match ← Lean.Vir.LeanRef.fromJSL action with
    | .rename value => pure value
    | .feed => pure "feed"
  Lean.Vir.LeanRef.releaseJSL action
  pure result

end Vir.Fixtures.FreshLeanRef
