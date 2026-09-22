/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import fixtures.infoview.RpcBrowserServer
public import ShellLifetime
import tutorials.RpcReferenceWidget

public section

namespace Vir.Fixtures.RpcShellLifetime

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview

-- This factory is deliberately local to the open document. The browser edits
-- this literal through the real textDocument/didChange path, so a changed DOM
-- label proves that the package was rebuilt from unsaved source.
def implementationLabel : String := "implementation-v1"

def createEditableComponent : RuntimeM (FunctionComponent PanelWidgetProps) :=
  FunctionComponent.ofLean fun _ => do
    let label ← Node.text (← JsValue.ofString implementationLabel)
    let props ← Js.Object.empty
    Js.Object.set props (← JsValue.ofString "id") (← JsValue.ofString "rpc-live-edit")
    Node.createElement (← ElementType.tag (← JsValue.ofString "span"))
      props (← Js.Array.ofArray #[label])

end Vir.Fixtures.RpcShellLifetime

-- Reuse the actual RPC methods and Lean stale-guard component unchanged.
-- The browser asks the server to package these roots from this live snapshot.

-- rpc-position-a
example (n : Nat) : n = n := by
  rfl

-- rpc-position-b
example (p : Prop) (h : p) : p := by
  exact h
