/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.ProofWidgets.Rpc.Types

namespace Lean.Vir.Infoview

/-- Cursor position for the current infoview snapshot. -/
structure DocumentPosition where
  uri : String
  fileName : String
  line : Nat
  character : Nat
  label : String

/-- A selected infoview location, normalized from the JavaScript widget props. -/
structure SelectedLocation where
  id : String
  kind : String
  label : String

/-- A local hypothesis shown in an infoview proof goal. -/
structure Hypothesis where
  id : String
  names : Array String
  fvarIds : Array String
  type : String
  value : Option String

/-- A single proof goal in the narrow VIR infoview surface. -/
structure Goal where
  id : String
  kind : String
  index : Nat
  title : String
  userName : Option String
  mvarId : Option String
  status : String
  target : String
  hypotheses : Array Hypothesis

/-- The narrow proof surface passed from the JavaScript infoview shell to Lean. -/
structure Surface where
  position : String
  cursor : DocumentPosition
  goals : Array Goal
  selectedLocations : Array String
  selections : Array SelectedLocation
  proofWidgetsExpr : Option (Lean.Vir.ProofWidgets.WithRpcRef Lean.Vir.ProofWidgets.ExprWithCtx)

end Lean.Vir.Infoview
