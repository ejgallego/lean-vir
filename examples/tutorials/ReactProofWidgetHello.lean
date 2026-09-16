/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.React
public import Vir.ProofWidgets.Jsx

/-!
A minimal live widget: the shell reuses the component factory's result and
passes native infoview panel props when the cursor moves. For a complete goal
and local-context viewer, see `examples/VirNativeInfoview.lean`.
-/

public section

namespace ReactProofWidgetHello

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

def View : RuntimeM (FunctionComponent PanelWidgetProps) :=
  FunctionComponent.ofLean fun props => do
  let position ← PanelWidgetProps.pos props
  let uri ← PanelPosition.uri position
  let goals ← PanelWidgetProps.goals props
  let goalCount ← JsValue.toFloat (← Js.Array.length goals)
  let target : ReactM (Js Node) := if goalCount == 0 then
      <pre>Move the cursor into a proof to see its first goal.</pre>
    else do
      let goal ← Js.Array.get goals (← JsValue.ofFloat 0)
      return ← <pre>⊢ {← CodeWithInfos.stripTags (← InteractiveGoal.type goal)}</pre>
  return ← <section id="react-proof-hello">
    <h3>Hello from {uri}</h3>
    {target}
  </section>

-- Derive the standard native-props factory and widget configuration.
vir_proof_widget View

end ReactProofWidgetHello

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidgetHello.widgetProps]

theorem proofWidgetHello_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left
