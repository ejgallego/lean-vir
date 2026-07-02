/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser

namespace Lean.Vir.ProofWidgets

/-- Opaque marker for a server-owned ProofWidgets RPC reference object. -/
opaque ServerRef : Type

/--
Host-inspectable descriptor for a ProofWidgets-style RPC reference.

This is the first narrow slice of the RPC surface. It intentionally carries a
small concrete descriptor across the host boundary; richer server-side
resolution can attach a typed JavaScript object handle without changing the
`WithRpcRef` shape used by component props.
-/
structure RpcRef where
  id : String
  label : String
  typeName : String
  summary : String
  expression : String
  typeText : String
  context : String
  serverRef : Option (Lean.Vir.Js ServerRef) := none

@[vir_js "proofwidgets.rpc.ref"]
private opaque rpcRefBaseJs
    (id : @& Lean.Vir.Js String)
    (label : @& Lean.Vir.Js String)
    (typeName : @& Lean.Vir.Js String)
    (summary : @& Lean.Vir.Js String)
    (expression : @& Lean.Vir.Js String) :
    Lean.Vir.RuntimeM (Lean.Vir.Js RpcRef)

@[vir_js "proofwidgets.rpc.ref.finish"]
private opaque rpcRefFinishJs
    (ref : @& Lean.Vir.Js RpcRef)
    (typeText : @& Lean.Vir.Js String)
    (context : @& Lean.Vir.Js String)
    (serverRef : Option (Lean.Vir.Js ServerRef)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js RpcRef)

private def RpcRef.toJs (ref : @& RpcRef) : Lean.Vir.RuntimeM (Lean.Vir.Js RpcRef) := do
  let id ← Lean.Vir.JsValue.ofString ref.id
  let label ← Lean.Vir.JsValue.ofString ref.label
  let typeName ← Lean.Vir.JsValue.ofString ref.typeName
  let summary ← Lean.Vir.JsValue.ofString ref.summary
  let expression ← Lean.Vir.JsValue.ofString ref.expression
  let typeText ← Lean.Vir.JsValue.ofString ref.typeText
  let context ← Lean.Vir.JsValue.ofString ref.context
  let base ← rpcRefBaseJs id label typeName summary expression
  rpcRefFinishJs base typeText context ref.serverRef

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
  expression : String
  typeText : String
  context : String
  source : String
  position : String
  packageRevision : String
  storeKey : String
  knownConstant : Bool
  deriving Repr

namespace ResolvedRef

def statusText (info : ResolvedRef) : String :=
  let expression := if info.expression == "" then info.label else info.expression
  let typeText := if info.typeText == "" then "" else " : " ++ info.typeText
  "resolved " ++ expression ++ typeText ++ " at " ++ info.position

end ResolvedRef

/--
A Lean value paired with the reference handle that a widget can pass back to
the host. This mirrors the ProofWidgets pattern where component props can carry
typed values with an RPC-visible reference.
-/
structure WithRpcRef (α : Type) where
  value : α
  ref : RpcRef

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
  context : String
  deriving Repr

namespace ExprWithCtx

def save (id code typeText summary : String) (context : String := "") : WithRpcRef ExprWithCtx :=
  {
    value := { code, typeText, context },
    ref := {
      id
      label := code
      typeName := "ExprWithCtx"
      summary
      expression := code
      typeText
      context
      serverRef := none
    }
  }

end ExprWithCtx

namespace Rpc

@[vir_js "proofwidgets.rpc.resolvedRef.value"]
private opaque resolvedRefValueJs (ref : @& Lean.Vir.Js ResolvedRef) :
    Lean.Vir.Browser.DomM ResolvedRef

@[vir_js "proofwidgets.rpc.inspectRef"]
private opaque inspectRefJs (ref : @& Lean.Vir.Js RpcRef) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Bool)

@[vir_js "proofwidgets.rpc.resolveRef"]
private opaque resolveRefJs
    (ref : @& Lean.Vir.Js RpcRef)
    (callback : Lean.Vir.Js ResolvedRef → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Bool)

private def resolvedRefCallback
    (callback : ResolvedRef → Lean.Vir.Browser.DomM Unit)
    (ref : Lean.Vir.Js ResolvedRef) :
    Lean.Vir.Browser.DomM Unit := do
  let value ← resolvedRefValueJs ref
  callback value

def inspectRef (ref : @& RpcRef) : Lean.Vir.Browser.DomM Bool := do
  let jsRef ← RpcRef.toJs ref
  let inspected ← inspectRefJs jsRef
  Lean.Vir.JsValue.toBool inspected

def resolveRef
    (ref : @& RpcRef)
    (callback : ResolvedRef → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool := do
  let jsRef ← RpcRef.toJs ref
  let resolved ← resolveRefJs jsRef (resolvedRefCallback callback)
  Lean.Vir.JsValue.toBool resolved

def inspect (value : @& WithRpcRef α) : Lean.Vir.Browser.DomM Bool :=
  inspectRef value.ref

def resolve
    (value : @& WithRpcRef α)
    (callback : ResolvedRef → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool :=
  resolveRef value.ref callback

end Rpc

end Lean.Vir.ProofWidgets
