/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.Examples.Style
public import Vir.Examples.Tamagotchi
public import Vir.ProofWidgets.Jsx

public section

namespace ReactTamagotchiWidget

open Lean.Vir
open Lean.Vir.React
open Lean.Vir.Infoview
open scoped Lean.Vir.Js

def shellStyle : RuntimeM Js.Object := js%{
  "display" := js#"grid", "gap" := js#"10px", "minWidth" := js#"0"
}

def captionStyle : RuntimeM Js.Object := js%{
  "margin" := js#"0", "color" := js#"var(--vscode-descriptionForeground, #57606a)",
  "fontSize" := js#"0.78rem", "fontWeight" := js#"700", "overflowWrap" := js#"anywhere"
}

def View : Lean.Vir.RuntimeM (FunctionComponent PanelWidgetProps) := do
  let petComponent ← ReactTamagotchi.View
  FunctionComponent.ofLean fun props => do
    let position ← PanelWidgetProps.pos props
    let uri ← JsValue.toString (← PanelPosition.uri position)
    let captionText ← Node.text (← JsValue.ofString ("Shared React Tamagotchi component at " ++ uri))
    let captionProps ← js%{
      "id" := js#"react-tamagotchi-widget-caption",
      "style" := (← captionStyle)
    }
    let caption ← jsx%{<p @props={captionProps}>{captionText}</p>}
    let pet ← Node.functionComponent petComponent (← Js.Object.empty) (← Js.Array.empty)
    let shellProps ← js%{
      "id" := js#"react-tamagotchi-proof-widget",
      "role" := js#"region",
      "aria-label" := js#"Lean React Tamagotchi proof widget",
      "style" := (← shellStyle)
    }
    jsx%{<section @props={shellProps}>{caption}{pet}</section>}

vir_proof_widget View

end ReactTamagotchiWidget

/-!
This widget reuses the same `ReactTamagotchi.View` component as the browser
React demo. It is intentionally not a proof-state API showcase; it validates
that a normal Lean-authored React component can be mounted through the
ProofWidgets-style infoview shell without duplicating the application code.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactTamagotchiWidget.widgetProps]

section Playground

theorem tamagotchiWidget_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left

end Playground
