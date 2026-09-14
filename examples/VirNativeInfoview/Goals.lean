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
def visibleHypotheses (hyps : Array (Js InteractiveHypothesisBundle))
    (settings : GoalSettings) : RuntimeM (Array VisibleHypothesis) := do
  let mut visible := #[]
  for (source, sourceIndex) in hyps.zipIdx do
    if !settings.showInstance && (← nativeFlag (← InteractiveHypothesisBundle.isInstance source)) then
      continue
    if !settings.showType && (← nativeFlag (← InteractiveHypothesisBundle.isType source)) then
      continue
    let mut names : Array VisibleName := #[]
    let mut hasVisibleName := false
    for value in (← Js.Array.toLeanArray (← InteractiveHypothesisBundle.names source)) do
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
def goalsToString (goals : Array (Js InteractiveGoal)) : RuntimeM String := do
  let texts ← goals.mapM fun goal => do
    let name? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
    let name ← match name? with | none => pure "" | some name => JsValue.toString name
    let mut text := if name.isEmpty then "" else "case " ++ name ++ "\n"
    for hyp in (← Js.Array.toLeanArray (← InteractiveGoal.hyps goal)) do
      let names ← (← Js.Array.toLeanArray (← InteractiveHypothesisBundle.names hyp)).mapM JsValue.toString
      let names := names.filter fun name => !name.contains "[anonymous]"
      text := text ++ " ".intercalate names.toList ++ " : " ++
        (← JsValue.toString (← CodeWithInfos.stripTags (← InteractiveHypothesisBundle.type hyp)))
      if let some value ← Js.UndefinedOr.toOption (← InteractiveHypothesisBundle.val hyp) then
        text := text ++ " := " ++ (← JsValue.toString (← CodeWithInfos.stripTags value))
      text := text ++ "\n"
    return text ++ "⊢ " ++ (← JsValue.toString (← CodeWithInfos.stripTags (← InteractiveGoal.type goal)))
  return "\n\n".intercalate texts.toList

end VirNativeInfoview
