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
Resolved metadata for a ProofWidgets-style RPC reference.

The current infoview resolver returns snapshot and source metadata. Future
`ExprWithCtx` storage can extend the server-side meaning of the reference
without changing the one-shot callback shape.
-/
structure ResolvedRef where
  id : String
  label : String
  typeName : String
  summary : String
  source : String
  position : String
  packageRevision : String
  knownConstant : Bool
  deriving Repr

namespace ResolvedRef

def statusText (info : ResolvedRef) : String :=
  let kind := if info.knownConstant then "known constant" else "reference"
  "resolved " ++ kind ++ " at " ++ info.position

end ResolvedRef

/--
A Lean value paired with the reference handle that a widget can pass back to
the host. This mirrors the ProofWidgets pattern where component props can carry
typed values with an RPC-visible reference.
-/
structure WithRpcRef (α : Type) where
  value : α
  ref : RpcRef
  deriving Repr

/--
Expression-with-context preview value used by the narrow `InteractiveExpr`
porting surface.

This is intentionally not a full replacement for ProofWidgets' `ExprWithCtx`.
It gives Lean-authored examples the same prop shape while the infoview RPC
layer grows real expression storage.
-/
structure ExprWithCtx where
  code : String
  typeText : String
  deriving Repr

namespace ExprWithCtx

def save (id code typeText summary : String) : WithRpcRef ExprWithCtx :=
  {
    value := { code, typeText },
    ref := {
      id
      label := code
      typeName := "ExprWithCtx"
      summary
    }
  }

end ExprWithCtx

namespace Rpc

@[vir_js "proofwidgets.rpc.inspectRef"]
opaque inspectRef (ref : @& RpcRef) : Lean.Vir.Browser.DomM Bool

@[vir_js "proofwidgets.rpc.resolveRef"]
opaque resolveRef
    (ref : @& RpcRef)
    (callback : ResolvedRef → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool

def inspect (value : @& WithRpcRef α) : Lean.Vir.Browser.DomM Bool :=
  inspectRef value.ref

def resolve
    (value : @& WithRpcRef α)
    (callback : ResolvedRef → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool :=
  resolveRef value.ref callback

end Rpc

end Lean.Vir.ProofWidgets
