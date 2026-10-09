/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Client.Types

public section

namespace Lean.Vir.Infoview

/-- Exact upstream `PanelWidgetProps`; no VIR-owned props record is introduced. -/
opaque PanelWidgetProps : Type

/-- Exact upstream infoview `DocumentPosition`. -/
opaque PanelPosition : Type

/-- Exact upstream `InteractiveGoal` object. -/
opaque InteractiveGoal : Type

/-- Exact upstream `InteractiveTermGoal` object. -/
opaque InteractiveTermGoal : Type

/-- Exact upstream `InteractiveHypothesisBundle` object. -/
opaque InteractiveHypothesisBundle : Type

/-- Exact upstream `CodeWithInfos` tagged-text value. -/
opaque CodeWithInfos : Type

/-- Exact upstream type-popup response, including nested tagged code and documentation. -/
opaque InfoPopup : Type

/-- Compile-time schema for the browser's exact DOMRect object. -/
structure HoverRect where
  left : Js Float
  top : Js Float
  bottom : Js Float
  width : Js Float
  height : Js Float

/-- Native infoview editor connection and API receivers. -/
opaque EditorConnection : Type
opaque EditorApi : Type

/-- Native LSP document/position pair accepted by EditorApi.insertText. -/
opaque TextDocumentPositionParams : Type

/-- Native 'here' | 'above' string union. -/
opaque TextInsertKind : Type

end Lean.Vir.Infoview
