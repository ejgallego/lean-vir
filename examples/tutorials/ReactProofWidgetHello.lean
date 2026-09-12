/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.React

/-!
A minimal live widget: the shell reuses the component factory's result and
passes native infoview panel props when the cursor moves. For a complete goal
and local-context viewer, see `examples/VirNativeInfoview.lean`.
-/

public section

namespace ReactProofWidgetHello

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview

def View : RuntimeM (FunctionComponent PanelWidgetProps) :=
  FunctionComponent.ofLean fun props => do
  let position ← PanelWidgetProps.pos props
  let uri ← JsValue.toString (← PanelPosition.uri position)
  let heading ← Node.text (← JsValue.ofString ("Hello from " ++ uri))
  let goals ← Js.Array.toLeanArray (← PanelWidgetProps.goals props)
  let goal ← match goals[0]? with
    | none => pure "Move the cursor into a proof to see its first goal."
    | some goal =>
      let target ← CodeWithInfos.stripTags (← InteractiveGoal.type goal)
      pure ("⊢ " ++ (← JsValue.toString target))
  let target ← Node.text (← JsValue.ofString goal)
  Node.sectionWith #[Props.id "react-proof-hello"] #[
    ← Node.h3 #[heading],
    ← Node.pre #[target]
  ]

-- Derive the standard native-props factory and widget configuration.
vir_proof_widget View

end ReactProofWidgetHello

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidgetHello.widgetProps]

theorem proofWidgetHello_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left
