/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview
import Vir.Examples.Style
import Vir.Examples.Tamagotchi

namespace ReactTamagotchiWidget

open Lean.Vir.React
open Lean.Vir.Infoview (Surface)

abbrev style := Lean.Vir.Examples.Style.style

def shellStyle : Property := style #[
  ("display", "grid"),
  ("gap", "10px"),
  ("minWidth", "0")
]

def captionStyle : Property := style #[
  ("margin", "0"),
  ("color", "var(--vscode-descriptionForeground, #57606a)"),
  ("fontSize", "0.78rem"),
  ("fontWeight", "700"),
  ("overflowWrap", "anywhere")
]

def View : Component Surface := fun surface => do
  let caption ← Node.pTextWith
    #[
      Property.id "react-tamagotchi-widget-caption",
      captionStyle
    ]
    ("Shared React Tamagotchi component at " ++ surface.cursor.label)
  let pet ← Node.component ReactTamagotchi.View ()
  Node.sectionWith
    #[
      Property.id "react-tamagotchi-proof-widget",
      Property.role "region",
      Property.ariaLabel "Lean React Tamagotchi proof widget",
      shellStyle
    ]
    #[]
    #[caption, pet]

vir_proof_widget View with mountId := "vir-react-tamagotchi-widget"

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
