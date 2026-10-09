/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import VirNativeInfoview.GoalPanel

public section

namespace VirNativeInfoview

/-- Native goal controls, tagged code and type popups, hosted by the standard infoview. -/
def View := GoalPanel.View

vir_proof_widget View

end VirNativeInfoview

/-!
This native Lean/React port follows the goal panel and interactive-code portion
of infoview 0.13.0. Hover a tagged expression for its type, click to pin the
popup, or use Enter/Escape. Goal settings are local to each mounted panel.
The current parity and API assessment is in docs/development/NATIVE_INFOVIEW_PORT.md.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with VirNativeInfoview.widgetProps]

section Playground

theorem virNativeInfoview_and_comm (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq

end Playground
