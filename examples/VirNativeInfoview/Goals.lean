/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Panel

public section

namespace VirNativeInfoview

open Lean.Vir Lean.Vir.Infoview

/-- Local presentation state, following infoview 0.13.0's `GoalSettingsState`.
These defaults match `defaultInfoviewConfig`; this example does not persist settings. -/
structure GoalSettings where
  reverse : Bool := false
  hideGoalNames : Bool := false
  emphasizeFirstGoal : Bool := false
  showType : Bool := true
  showInstance : Bool := true
  showHiddenAssumption : Bool := true
  showLetValue : Bool := true

/-- Retain the native name for display after computing Lean presentation policy. -/
structure VisibleName where
  value : Js String
  inaccessible : Bool

/-- A presentation projection keeps the original native hypothesis and its tagged code.
Filtering names must not mutate the server's array or lose fields such as `fvarIds`. -/
structure VisibleHypothesis where
  source : Js InteractiveHypothesisBundle
  names : Array VisibleName
  sourceIndex : Nat

def nativeFlag (value : Js.UndefinedOr Bool) : RuntimeM Bool := do
  match ← Js.UndefinedOr.toOption value with
  | none => pure false
  | some value => JsValue.toBool value

/-- Mirrors the filtering order in upstream `getFilteredHypotheses`, followed by
`InteractiveHypothesisBundle_nonAnonymousNames` at the presentation boundary. -/
def visibleHypotheses (hyps : Js.Array InteractiveHypothesisBundle)
    (settings : GoalSettings) : RuntimeM (Array VisibleHypothesis) := do
  let mut visible := #[]
  let size := (← JsValue.toFloat (← Js.Array.length hyps)).toUInt64.toNat
  for sourceIndex in [:size] do
    let source ← Js.Array.get hyps (← JsValue.ofFloat sourceIndex.toFloat)
    if !settings.showInstance && (← nativeFlag (← InteractiveHypothesisBundle.isInstance source)) then
      continue
    if !settings.showType && (← nativeFlag (← InteractiveHypothesisBundle.isType source)) then
      continue
    let mut names : Array VisibleName := #[]
    let mut hasVisibleName := false
    let sourceNames ← InteractiveHypothesisBundle.names source
    let nameCount := (← JsValue.toFloat (← Js.Array.length sourceNames)).toUInt64.toNat
    for index in [:nameCount] do
      let value ← Js.Array.get sourceNames (← JsValue.ofFloat index.toFloat)
      let name ← JsValue.toString value
      let inaccessible := name.contains '✝'
      if !settings.showHiddenAssumption && inaccessible then continue
      -- Upstream drops empty bundles before removing anonymous names.
      hasVisibleName := true
      if !name.contains "[anonymous]" then
        names := names.push { value, inaccessible }
    if !hasVisibleName then continue
    visible := visible.push { source, names, sourceIndex }
  return if settings.reverse then visible.reverse else visible

/-- Copy the complete tactic state, as upstream `goalsToString` does, independently
of presentation filters and the display-only custom goal prefix. -/
def goalsToString (goals : Js.Array InteractiveGoal) : RuntimeM String := do
  let size := (← JsValue.toFloat (← Js.Array.length goals)).toUInt64.toNat
  let mut result := ""
  for index in [:size] do
    let goal ← Js.Array.get goals (← JsValue.ofFloat index.toFloat)
    let name? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
    let name ← match name? with | none => pure "" | some name => JsValue.toString name
    let mut text := if name.isEmpty then "" else "case " ++ name ++ "\n"
    let hyps ← InteractiveGoal.hyps goal
    let hypCount := (← JsValue.toFloat (← Js.Array.length hyps)).toUInt64.toNat
    for hypIndex in [:hypCount] do
      let hyp ← Js.Array.get hyps (← JsValue.ofFloat hypIndex.toFloat)
      let names ← InteractiveHypothesisBundle.names hyp
      let nameCount := (← JsValue.toFloat (← Js.Array.length names)).toUInt64.toNat
      let mut separator := ""
      for nameIndex in [:nameCount] do
        let name ← JsValue.toString (← Js.Array.get names (← JsValue.ofFloat nameIndex.toFloat))
        if name.contains "[anonymous]" then continue
        text := text ++ separator ++ name
        separator := " "
      text := text ++ " : " ++
        (← JsValue.toString (← CodeWithInfos.stripTags (← InteractiveHypothesisBundle.type hyp)))
      if let some value ← Js.UndefinedOr.toOption (← InteractiveHypothesisBundle.val hyp) then
        text := text ++ " := " ++ (← JsValue.toString (← CodeWithInfos.stripTags value))
      text := text ++ "\n"
    if index != 0 then result := result ++ "\n\n"
    result := result ++ text ++ "⊢ " ++
      (← JsValue.toString (← CodeWithInfos.stripTags (← InteractiveGoal.type goal)))
  return result

end VirNativeInfoview
