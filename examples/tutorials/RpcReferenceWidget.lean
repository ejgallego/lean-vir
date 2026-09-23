/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.React
public import Vir.ProofWidgets.Jsx

public section

/-!
A Lean-authored React component calling the official position-specific RPC
session. Replies remain exact JavaScript values, including their server
references. An ordinary effect aborts obsolete requests and guards publication
independently of cancellation. See `RpcReferenceWidget.md`.
-/

namespace RpcReferenceWidget

open Lean.Vir

open Lean.Vir.React Lean.Vir.Browser
open scoped Lean.Vir.Js

/-- Response shape: a message and a nested server-owned RPC reference. -/
opaque Reply : Type

def request (session : Js Infoview.RpcSession) (method : Js String)
    (params : Js.Object) (options : Js Infoview.ClientRequestOptions) :
    RuntimeM (Js.Promise Reply) :=
  Infoview.RpcSession.callWithOptions session method (Js.erase params) options

/-- Both projections preserve the exact nested values registered by the RPC client. -/
def reference (reply : Js Reply) : RuntimeM Js.Any := do
  Js.Object.get reply (← js#"ref")

/-- Checks the projected primitive string; malformed fields fail without coercion. -/
def message (reply : Js Reply) : RuntimeM (Js String) := do
  Js.String.fromAny (← Js.Object.get reply (← js#"message"))

/-- Send the exact registered reference back to its owning RPC session. -/
def readReference (session : Js Infoview.RpcSession) (reply : Js Reply) :
    RuntimeM (Js.Promise String) := do
  let params ← Js.Object.empty
  Js.Object.set params (← js#"ref") (← reference reply)
  Infoview.RpcSession.call session (← js#"RpcBrowserServer.read") params

/-- A native React function component; constructing it once preserves hook identity. -/
private def ResponseView : RuntimeM (FunctionComponent (Props.WithData (Js Reply))) := do
  let initial ← JsValue.ofNat 0
  let one ← JsValue.ofNat 1
  let update ← Js.Function.ofLean fun previous => Js.Nat.add previous one
  FunctionComponent.ofLean fun props => do
    let reply ← LeanRef.fromJSL (← Props.WithData.data props)
    js#let (count, setCount) ← Hooks.useState (α := Nat) initial
    let label ← message reply
    let increment ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) =>
      Js.Function.callVoid setCount (SetStateAction.ofUpdater update)
    jsx%{<button id="rpc-reference-view" onClick={increment}>
      {label} / local {count}
    </button>}

/-- Keep the session and query identities stable until the request should change. -/
structure Input where
  session : Js Infoview.RpcSession
  query : Js.Object
  uri : Js String

private structure ResponseState where
  reply : Option (Js Reply) := none
  status : String := "loading"
  error : String := ""

private def renderView (child : FunctionComponent (Props.WithData (Js Reply))) (input : Input) :
    ReactM (Js Node) := do
  let initializer ← Js.Function.ofLean0 (LeanRef.toJSL ({} : ResponseState))
  js#let (responseValue, responseSetter) ← Hooks.useState initializer
  js#let (revisionValue, revisionSetter) ← Hooks.useState (α := Nat) (← JsValue.ofNat 0)
  let one ← JsValue.ofNat 1
  let changed ← Js.Function.ofLeanVoid fun (params : Js.Any) => do
    let document ← Js.Object.get params (← js#"textDocument")
    let uri ← Js.String.fromAny (← Js.Object.get document (← js#"uri"))
    if ← JsValue.toBool (← Js.String.equal uri input.uri) then
      let update ← Js.Function.ofLean fun previous => Js.Nat.add previous one
      Js.Function.callVoid revisionSetter (React.SetStateAction.ofUpdater update)
  -- Undefined dependencies also follow replacement of the upstream editor context.
  Infoview.useClientNotificationEffect (← js#"textDocument/didChange") changed
    (← Js.UndefinedOr.undefined)
  let effect ← Js.Function.ofLean0 <| Browser.DomM.toRuntime do
    let active ← RuntimeRef.new true
    let abort ← AbortController.create
    let options ← Infoview.ClientRequestOptions.empty
    Infoview.ClientRequestOptions.setAbortSignal options (← AbortController.getSignal abort)
    let loading ← Js.Function.ofLean fun previous => do
      let previous : ResponseState ← LeanRef.fromJSL previous
      LeanRef.toJSL { previous with status := "loading", error := "" }
    Js.Function.callVoid responseSetter (React.SetStateAction.ofUpdater loading)
    let pending ← request input.session (← js#"RpcBrowserServer.create")
      input.query options
    let succeed ← Js.Function.ofLeanVoid fun (reply : Js Reply) => do
      if ← active.get then
        -- Validate before publication; a bad message rejects this Promise chain.
        let _ ← message reply
        Js.Function.callVoid responseSetter (React.SetStateAction.ofValue (← LeanRef.toJSL {
          reply := some reply, status := "ready" : ResponseState }))
    let fail ← Js.Function.ofLeanVoid fun (_error : Js.Any) => do
      if ← active.get then
        let failed ← Js.Function.ofLean fun previous => do
          let previous : ResponseState ← LeanRef.fromJSL previous
          LeanRef.toJSL { previous with
            status := "error"
            error := "The request or response handler failed" }
        Js.Function.callVoid responseSetter (React.SetStateAction.ofUpdater failed)
    let handled ← Js.Promise.thenVoid pending succeed
    let ignore ← Js.Function.ofLeanVoid fun (_ : Js.Undefined) => pure ()
    -- Handles both request rejection and exceptions in the fulfillment handler.
    let _ ← Js.Promise.thenVoidWithRejection handled ignore fail
    let cleanup ← Js.Function.ofLean0Void <| Browser.DomM.toRuntime do
      active.set false
      AbortController.abort abort
    pure (Js.UndefinedOr.ofJs cleanup)
  Hooks.useEffect effect (Js.UndefinedOr.ofJs (← js#[
    Js.erase input.session, Js.erase input.query, Js.erase revisionValue]))
  let state : ResponseState ← LeanRef.fromJSL responseValue
  let previous := if state.reply.isSome then " Showing the previous response." else ""
  let status := if state.status == "loading" then s!"Loading…{previous}"
    else if state.status == "error" then s!"Request failed: {state.error}.{previous}"
    else "Ready"
  let responseChild : ReactM (Js.Nullable Node) := match state.reply with
    | none => Js.Nullable.null
    | some reply => do
        let props ← Props.WithData.make (← LeanRef.toJSL reply)
        Js.Nullable.ofJs (← Node.functionComponent child props (← Js.Array.empty))
  jsx%{<section aria-busy={← JsValue.ofBool (state.status == "loading")}>
    <p role={← JsValue.ofString (if state.status == "error" then "alert" else "status")}
        data-rpc-status={← JsValue.ofString state.status}>
      {ProofWidgets.Html.text status}
    </p>
    {responseChild}
  </section>}

/-- Construct once: native React function identity preserves parent and child state. -/
def View : RuntimeM (FunctionComponent (Props.WithData Input)) := do
  let child ← ResponseView
  FunctionComponent.ofLean fun props => do
    renderView child (← LeanRef.fromJSL (← Props.WithData.data props))

/-- Submit new inputs without replacing the native component type. -/
def render (component : FunctionComponent (Props.WithData Input)) (input : Input) : ReactM (Js Node) := do
  Node.functionComponent component (← Props.WithData.make (← LeanRef.toJSL input))
    (← Js.Array.empty)

/-- The standard infoview entry needs no application-authored JavaScript. -/
def WidgetView : RuntimeM (FunctionComponent Infoview.PanelWidgetProps) := do
  let child ← ResponseView
  let query ← Js.Object.empty
  Js.Object.set query (← js#"message") (← js#"Hello from Lean")
  Js.Object.set query (← js#"fail") (← JsValue.ofBool false)
  Js.Object.set query (← js#"waitForCancellation") (← JsValue.ofBool false)
  FunctionComponent.ofLean fun props => do
    let session ← Infoview.useRpcSession
    let pos ← Infoview.PanelWidgetProps.pos props
    let uri ← Infoview.PanelPosition.uri pos
    renderView child { session, query, uri }

vir_proof_widget WidgetView

end RpcReferenceWidget
