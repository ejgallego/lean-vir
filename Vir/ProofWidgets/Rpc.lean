/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser

namespace Lean.Vir.ProofWidgets

/--
Host-inspectable descriptor for a ProofWidgets-style RPC reference.

This is the first narrow slice of the RPC surface. It intentionally carries a
small concrete descriptor across the host boundary; richer server-side
resolution can replace the descriptor payload without changing the typed
`WithRpcRef` shape used by component props.
-/
structure RpcRef where
  id : String
  label : String
  typeName : String
  summary : String
  deriving Repr

/--
A Lean value paired with the reference handle that a widget can pass back to
the host. This mirrors the ProofWidgets pattern where component props can carry
typed values with an RPC-visible reference.
-/
structure WithRpcRef (α : Type) where
  value : α
  ref : RpcRef
  deriving Repr

namespace Rpc

@[vir_js "proofwidgets.rpc.inspectRef"]
opaque inspectRef (ref : @& RpcRef) : Lean.Vir.Browser.DomM Bool

def inspect (value : @& WithRpcRef α) : Lean.Vir.Browser.DomM Bool :=
  inspectRef value.ref

end Rpc

end Lean.Vir.ProofWidgets
