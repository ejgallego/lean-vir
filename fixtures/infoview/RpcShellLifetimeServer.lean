/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import fixtures.infoview.RpcBrowserServer
public import ShellLifetime
public meta import tutorials.RpcReferenceWidget
import tutorials.RpcReferenceWidget

public section

namespace Vir.Fixtures.RegisteredLifetime
vir_proof_widget Vir.Fixtures.ShellLifetime.createComponent
end Vir.Fixtures.RegisteredLifetime

namespace Vir.Fixtures.AlternateLifetime
vir_proof_widget Vir.Fixtures.ShellLifetime.createComponent
end Vir.Fixtures.AlternateLifetime

namespace Vir.Fixtures.RpcShellLifetime

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview

-- This factory is deliberately local to the open document. The browser edits
-- this literal through the real textDocument/didChange path, so a changed DOM
-- label proves that the package was rebuilt from unsaved source.
def implementationLabel : String := "implementation-v1"

def createEditableComponent : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let lifecycle ← Vir.Fixtures.ShellLifetime.createComponent
  FunctionComponent.ofLean fun props => do
    let label ← Node.text (← JsValue.ofString implementationLabel)
    let editableProps ← Js.Object.empty
    Js.Object.set editableProps (← JsValue.ofString "id") (← JsValue.ofString "rpc-live-edit")
    let editable ← Node.createElement (← ElementType.tag (← JsValue.ofString "span"))
      editableProps (← Js.Array.ofArray #[label])
    let observer ← Node.functionComponent lifecycle props (← Js.Array.empty)
    let containerProps ← Js.Object.empty
    Node.createElement (← ElementType.tag (← JsValue.ofString "div"))
      containerProps (← Js.Array.ofArray #[editable, observer])

vir_proof_widget createEditableComponent

end Vir.Fixtures.RpcShellLifetime

show_panel_widgets [Lean.Vir.Infoview.widget with Vir.Fixtures.RegisteredLifetime.widgetProps,
  Lean.Vir.Infoview.widget with Vir.Fixtures.AlternateLifetime.widgetProps,
  Lean.Vir.Infoview.widget with Vir.Fixtures.RpcShellLifetime.widgetProps,
  Lean.Vir.Infoview.widget with RpcReferenceWidget.widgetProps]

-- Reuse the actual RPC methods and Lean stale-guard component unchanged.
-- The browser requests the descriptions retained by these widget commands.

-- rpc-position-a
example (n : Nat) : n = n := by
  rfl

-- rpc-position-b
example (p : Prop) (h : p) : p := by
  exact h
