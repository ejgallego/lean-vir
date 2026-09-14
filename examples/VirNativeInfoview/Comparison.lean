/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import VirNativeInfoview.Composition

public section

namespace VirNativeInfoview.Comparison

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview Lean.Vir.ProofWidgets
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

/-- Identical Lean goal panels; only the code-rendering implementation differs.
The host supplies both panels with the same native data and upstream contexts. -/
def View : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let Native ← VirNativeInfoview.GoalPanel.View
  let Composed ← VirNativeInfoview.Composition.View
  FunctionComponent.ofLean fun panel => do
    <div className="vir-infoview-comparison" style={(← js%{
        "display" := (← js#"grid"), "gap" := (← js#"1rem"),
        "gridTemplateColumns" := (← js#"repeat(auto-fit, minmax(min(100%, 22rem), 1fr))") })}>
      <section data-renderer="lean"><h3>Lean port</h3><Native @props={panel}/></section>
      <section data-renderer="upstream"><h3>Upstream component checkpoint</h3>
        <p>Lean goal panel; TypeScript interactive code.</p><Composed @props={panel}/></section>
    </div>

vir_proof_widget View

end VirNativeInfoview.Comparison

/-! Open this file in VS Code and move through the proof to compare both renderers.
The main port remains `VirNativeInfoview.lean`; this is the external-component checkpoint. -/
show_panel_widgets [local Lean.Vir.Infoview.widget with VirNativeInfoview.Comparison.widgetProps]

example (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq
