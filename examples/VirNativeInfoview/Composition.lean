/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import VirNativeInfoview.GoalPanel

public section

namespace VirNativeInfoview.Composition

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview Lean.Vir.ProofWidgets
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

/-- Interoperability checkpoint, not the completed port: React renders the exact
upstream component with the exact native tagged text. No traversal or RPC here. -/
def View : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let Upstream ← interactiveCode
  GoalPanel.withCode fun fmt => do
    <Upstream fmt={fmt}/>

end VirNativeInfoview.Composition
