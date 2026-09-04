/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser
public import Vir.ProofWidgets.Rpc
public import Vir.Infoview.Surface.Generated

public section

namespace Lean.Vir.Infoview

private def DocumentPosition.toJs (position : @& DocumentPosition) :
    Lean.Vir.RuntimeM (Lean.Vir.Js DocumentPosition) := do
  let uri ← Lean.Vir.JsValue.ofString position.uri
  let fileName ← Lean.Vir.JsValue.ofString position.fileName
  let line ← Lean.Vir.JsValue.ofNat position.line
  let character ← Lean.Vir.JsValue.ofNat position.character
  let label ← Lean.Vir.JsValue.ofString position.label
  documentPositionJs uri fileName line character label

namespace Clipboard

/--
Writes text to the host clipboard when the infoview/browser environment permits
it.

The JavaScript host returns `false` instead of trapping when no clipboard API is
available or when the write is rejected by the host.
-/
def writeText (text : @& String) : Lean.Vir.Browser.DomM Bool := do
  let jsText ← Lean.Vir.JsValue.ofString text
  let written ← writeTextJs jsText
  Lean.Vir.JsValue.toBool written

end Clipboard

namespace Command

/--
Asks the host infoview/editor to reveal a document position.

The browser host returns `false` when no infoview command dispatcher is
available. The bundled infoview shell wires this command to
`EditorConnection.revealPosition`.
-/
def revealPosition (position : @& DocumentPosition) : Lean.Vir.Browser.DomM Bool := do
  let jsPosition ← DocumentPosition.toJs position
  let revealed ← revealPositionJs jsPosition
  Lean.Vir.JsValue.toBool revealed

/-- Reveals the cursor position carried by the current infoview surface. -/
def revealCursor (surface : @& Surface) : Lean.Vir.Browser.DomM Bool :=
  revealPosition surface.cursor

/--
Inserts text at a document position through the connected editor.

The bundled infoview host implements this with a zero-width
`workspace/applyEdit`. Browser-only hosts may return `false` when there is no
editable document.
-/
def insertText (position : @& DocumentPosition) (text : @& String) :
    Lean.Vir.Browser.DomM Bool := do
  let jsPosition ← DocumentPosition.toJs position
  let jsText ← Lean.Vir.JsValue.ofString text
  let inserted ← insertTextJs jsPosition jsText
  Lean.Vir.JsValue.toBool inserted

/-- Inserts text at the cursor carried by the current infoview surface. -/
def insertAtCursor (surface : @& Surface) (text : @& String) :
    Lean.Vir.Browser.DomM Bool :=
  insertText surface.cursor text

end Command

end Lean.Vir.Infoview
