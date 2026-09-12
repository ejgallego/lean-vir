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
passes a fresh `Surface` when the cursor moves. For a complete goal and local
context viewer, see `examples/VirNativeInfoview.lean`.
-/

public section

namespace ReactProofWidgetHello

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview

def View : RuntimeM (Js (Component Surface)) := Component.ofLean fun surface => do
  let surface ← LeanRef.fromJSL surface
  let heading ← Node.text (← JsValue.ofString ("Hello from " ++ surface.cursor.label))
  let goal := match surface.goals[0]? with
    | none => "Move the cursor into a proof to see its first goal."
    | some goal => "⊢ " ++ goal.target
  let target ← Node.text (← JsValue.ofString goal)
  Node.sectionWith #[Props.id "react-proof-hello"] #[
    ← Node.h3 #[heading],
    ← Node.pre #[target]
  ]

-- Derive the standard factory, mount entry, and widget configuration.
vir_proof_widget View with mountId := "vir-react-proof-widget-hello"

end ReactProofWidgetHello

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidgetHello.widgetProps]

theorem proofWidgetHello_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left
