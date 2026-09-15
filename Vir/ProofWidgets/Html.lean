/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace Lean.Vir.ProofWidgets

abbrev ReactM := Lean.Vir.React.ReactM

/-- A native React node construction action, not a serialized HTML tree. -/
abbrev Html : Type :=
  ReactM (Lean.Vir.Js Lean.Vir.React.Node)

namespace Html

/-- Explicitly converts Lean-owned text for rendering. Native strings use `React.Node.text`. -/
def text (value : String) : Html := do
  Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString value)

end Html

end Lean.Vir.ProofWidgets
