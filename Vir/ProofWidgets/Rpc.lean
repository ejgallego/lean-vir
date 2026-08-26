/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser
import Vir.ProofWidgets.Rpc.Generated

namespace Lean.Vir.ProofWidgets

private def RpcRef.toJs (ref : @& RpcRef) : Lean.Vir.RuntimeM (Lean.Vir.Js RpcRef) := do
  let id ← Lean.Vir.JsValue.ofString ref.id
  let label ← Lean.Vir.JsValue.ofString ref.label
  let typeName ← Lean.Vir.JsValue.ofString ref.typeName
  let summary ← Lean.Vir.JsValue.ofString ref.summary
  let expression ← Lean.Vir.JsValue.ofString ref.expression
  let typeText ← Lean.Vir.JsValue.ofString ref.typeText
  let context ← Lean.Vir.JsValue.ofString ref.context
  let base ← rpcRefBaseJs id label typeName summary expression
  let serverRef ← Lean.Vir.Js.Nullable.ofOption ref.serverRef
  rpcRefFinishJs base typeText context serverRef

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
