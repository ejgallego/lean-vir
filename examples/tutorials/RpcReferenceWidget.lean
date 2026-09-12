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
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

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
private def ResponseView : RuntimeM (Js (React.Component (Js Reply))) := React.Component.ofLean fun reply => do
  let reply ← LeanRef.fromJSL reply
  let count ← React.StateTuple.toState (← React.Hooks.useState (← JsValue.ofNat 0))
  let label ← message reply
  let n ← JsValue.toNat count.value
  return ← <button id="rpc-reference-view" onClick={do
    React.State.modify count fun previous => do
      JsValue.ofNat ((← JsValue.toNat previous) + 1)}>
    {Node.text label}{ProofWidgets.Html.text s!" / local {n}"}
  </button>

/-- Keep the session and query identities stable until the request should change. -/
structure Input where
  session : Js Infoview.RpcSession
  query : Js.Object
  uri : String

private structure ResponseState where
  reply : Option (Js Reply) := none
  status : String := "loading"
  error : String := ""

private def renderView (child : Js (Component (Js Reply))) (input : Input) :
    ReactM (Js Node) := do
  let response ← StateTuple.toState
    (← Hooks.useState (← LeanRef.toJSL ({} : ResponseState)))
  let revision ← StateTuple.toState (← Hooks.useState (← JsValue.ofNat 0))
  let changed ← Js.Function.ofLeanVoid fun (params : Js.Any) => do
    let document ← Js.Object.get params (← js#"textDocument")
    let uri ← Js.String.fromAny (← Js.Object.get document (← js#"uri"))
    if (← JsValue.toString uri) == input.uri then
      State.modify revision fun previous => do JsValue.ofNat ((← JsValue.toNat previous) + 1)
  -- Undefined dependencies also follow replacement of the upstream editor context.
  Infoview.useClientNotificationEffect (← js#"textDocument/didChange") changed
    (← Js.UndefinedOr.undefined)
  let effect ← EffectCallback.ofLean {
    setup := do
      let active ← RuntimeRef.new true
      let abort ← AbortController.create
      let options ← Infoview.ClientRequestOptions.empty
      Infoview.ClientRequestOptions.setAbortSignal options (← AbortController.getSignal abort)
      State.modify response fun previous => do
        let previous : ResponseState ← LeanRef.fromJSL previous
        LeanRef.toJSL { previous with status := "loading", error := "" }
      let pending ← request input.session (← js#"RpcBrowserServer.create")
        input.query options
      let succeed ← Js.Function.ofLeanVoid fun (reply : Js Reply) => do
        if ← active.get then
          -- Validate before publication; a bad message rejects this Promise chain.
          let _ ← message reply
          State.set response (← LeanRef.toJSL {
            reply := some reply, status := "ready" : ResponseState })
      let fail ← Js.Function.ofLeanVoid fun (_error : Js.Any) => do
        if ← active.get then
          State.modify response fun previous => do
            let previous : ResponseState ← LeanRef.fromJSL previous
            LeanRef.toJSL { previous with
              status := "error"
              error := "The request or response handler failed" }
      let handled ← Js.Promise.thenVoid pending succeed
      let ignore ← Js.Function.ofLeanVoid fun (_ : Js.Undefined) => pure ()
      -- Handles both request rejection and exceptions in the fulfillment handler.
      let _ ← Js.Promise.thenVoidWithRejection handled ignore fail
      LeanRef.toJSL (active, abort)
    cleanup := fun resource => do
      let (active, abort) : RuntimeRef Bool × Js AbortController ← LeanRef.fromJSL resource
      active.set false
      AbortController.abort abort
  }
  Hooks.useEffect effect (Js.UndefinedOr.ofJs (← Js.Array.ofArray
    #[Js.erase input.session, Js.erase input.query, Js.erase revision.value]))
  let state : ResponseState ← LeanRef.fromJSL response.value
  let previous := if state.reply.isSome then " Showing the previous response." else ""
  let status := if state.status == "loading" then s!"Loading…{previous}"
    else if state.status == "error" then s!"Request failed: {state.error}.{previous}"
    else "Ready"
  let children : Array ProofWidgets.Html := match state.reply with
    | none => #[]
    | some reply => #[do Node.component child (← LeanRef.toJSL reply)]
  return ← <section {...#[Props.bool "aria-busy" (state.status == "loading")]}>
    <p role={if state.status == "error" then "alert" else "status"}
        {...#[Props.string "data-rpc-status" state.status]}>
      {ProofWidgets.Html.text status}
    </p>
    {...children}
  </section>

/-- Construct once: native React function identity preserves parent and child state. -/
def View : RuntimeM (Js (Component Input)) := do
  let child ← ResponseView
  Component.ofLean fun props => do renderView child (← LeanRef.fromJSL props)

/-- Submit new inputs without replacing the native component type. -/
def render (component : Js (Component Input)) (input : Input) : ReactM (Js Node) := do
  Node.component component (← LeanRef.toJSL input)

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
    let uri ← JsValue.toString (← Infoview.PanelPosition.uri pos)
    renderView child { session, query, uri }

vir_proof_widget WidgetView

end RpcReferenceWidget
