/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser
import Vir.ProofWidgets.Rpc

namespace Lean.Vir.Infoview

/--
Cursor position for the current infoview snapshot.

`line` and `character` keep the zero-based LSP coordinates. `label` is the
one-based user-facing form used by the demo widget.
-/
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

/--
The narrow proof surface passed from the JavaScript infoview shell to a Lean VIR
widget entry.
-/
structure Surface where
  position : String
  cursor : DocumentPosition
  goals : Array Goal
  selectedLocations : Array String
  selections : Array SelectedLocation
  proofWidgetsExpr : Option (Lean.Vir.ProofWidgets.WithRpcRef Lean.Vir.ProofWidgets.ExprWithCtx)

namespace Clipboard

/--
Writes text to the host clipboard when the infoview/browser environment permits
it.

The JavaScript host returns `false` instead of trapping when no clipboard API is
available or when the write is rejected by the host.
-/
@[vir_js "infoview.clipboard.writeText"]
opaque writeText (text : @& String) : Lean.Vir.Browser.DomM Bool

end Clipboard

namespace Command

/--
Asks the host infoview/editor to reveal a document position.

The browser host returns `false` when no infoview command dispatcher is
available. The bundled infoview shell wires this command to
`EditorConnection.revealPosition`.
-/
@[vir_js "infoview.command.revealPosition"]
opaque revealPosition (position : @& DocumentPosition) : Lean.Vir.Browser.DomM Bool

/-- Reveals the cursor position carried by the current infoview surface. -/
def revealCursor (surface : @& Surface) : Lean.Vir.Browser.DomM Bool :=
  revealPosition surface.cursor

end Command

end Lean.Vir.Infoview
