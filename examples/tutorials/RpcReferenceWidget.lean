/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.React

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

/-- Response shape: a message and a nested server-owned RPC reference. -/
opaque Reply : Type

def request (session : Js Infoview.RpcSession) (method : Js String)
    (params : Js.Object) (options : Js Infoview.ClientRequestOptions) :
    RuntimeM (Js.Promise Reply) :=
  Infoview.RpcSession.callWithOptions session method (Js.erase params) options

/-- Both projections preserve the exact nested values registered by the RPC client. -/
def reference (reply : Js Reply) : RuntimeM Js.Any := do
  Js.Object.get reply (← JsValue.ofString "ref")

/-- Checks the projected primitive string; malformed fields fail without coercion. -/
def message (reply : Js Reply) : RuntimeM (Js String) := do
  Js.String.fromAny (← Js.Object.get reply (← JsValue.ofString "message"))

/-- Send the exact registered reference back to its owning RPC session. -/
def readReference (session : Js Infoview.RpcSession) (reply : Js Reply) :
    RuntimeM (Js.Promise String) := do
  let params ← Js.Object.empty
  Js.Object.set params (← JsValue.ofString "ref") (← reference reply)
  Infoview.RpcSession.call session (← JsValue.ofString "RpcBrowserServer.read") params

/-- A native React function component; constructing it once preserves hook identity. -/
private def ResponseView : RuntimeM (Js (React.Component (Js Reply))) := React.Component.ofLean fun reply => do
  let reply ← LeanRef.fromJSL reply
  let count ← React.StateTuple.toState (← React.Hooks.useState (← JsValue.ofNat 0))
  let label ← JsValue.toString (← message reply)
  let n ← JsValue.toNat count.value
  React.Node.buttonWith #[React.Props.id "rpc-reference-view", React.Props.onClick do
    React.State.modify count fun previous => do
      JsValue.ofNat ((← JsValue.toNat previous) + 1)]
    #[← React.Node.text (← Lean.Vir.JsValue.ofString s!"{label} / local {n}")]

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
    let document ← Js.Object.get params (← JsValue.ofString "textDocument")
    let uri ← Js.String.fromAny (← Js.Object.get document (← JsValue.ofString "uri"))
    if (← JsValue.toString uri) == input.uri then
      State.modify revision fun previous => do JsValue.ofNat ((← JsValue.toNat previous) + 1)
  -- Omitted dependencies also follow replacement of the upstream editor context.
  Infoview.useClientNotificationEffect (← JsValue.ofString "textDocument/didChange") changed
  let effect ← EffectCallback.ofLean {
    setup := do
      let active ← RuntimeRef.new true
      let abort ← AbortController.create
      let options ← Infoview.ClientRequestOptions.empty
      Infoview.ClientRequestOptions.setAbortSignal options (← AbortController.getSignal abort)
      State.modify response fun previous => do
        let previous : ResponseState ← LeanRef.fromJSL previous
        LeanRef.toJSL { previous with status := "loading", error := "" }
      let pending ← request input.session (← JsValue.ofString "RpcBrowserServer.create")
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
  Hooks.useEffect effect (some (← Js.Array.ofArray
    #[Js.erase input.session, Js.erase input.query, Js.erase revision.value]))
  let state : ResponseState ← LeanRef.fromJSL response.value
  let previous := if state.reply.isSome then " Showing the previous response." else ""
  let status := if state.status == "loading" then s!"Loading…{previous}"
    else if state.status == "error" then s!"Request failed: {state.error}.{previous}"
    else "Ready"
  let label ← Node.elementWith "p" #[
    Props.role (if state.status == "error" then "alert" else "status"),
    Props.string "data-rpc-status" state.status]
    #[← Node.text (← JsValue.ofString status)]
  let children ← match state.reply with
    | none => pure #[label]
    | some reply => do pure #[label, ← Node.component child (← LeanRef.toJSL reply)]
  Node.elementWith "section" #[Props.bool "aria-busy" (state.status == "loading")] children

/-- Construct once: native React function identity preserves parent and child state. -/
def View : RuntimeM (Js (Component Input)) := do
  let child ← ResponseView
  Component.ofLean fun props => do renderView child (← LeanRef.fromJSL props)

/-- Submit new inputs without replacing the native component type. -/
def render (component : Js (Component Input)) (input : Input) : ReactM (Js Node) := do
  Node.component component (← LeanRef.toJSL input)

/-- The standard infoview entry needs no application-authored JavaScript. -/
def WidgetView : RuntimeM (Js (Component Infoview.Surface)) := do
  let child ← ResponseView
  let query ← Js.Object.empty
  Js.Object.set query (← JsValue.ofString "message") (← JsValue.ofString "Hello from Lean")
  Js.Object.set query (← JsValue.ofString "fail") (← JsValue.ofBool false)
  Js.Object.set query (← JsValue.ofString "waitForCancellation") (← JsValue.ofBool false)
  Component.ofLean fun props => do
    let surface : Infoview.Surface ← LeanRef.fromJSL props
    renderView child { session := surface.rpcSession, query, uri := surface.cursor.uri }

vir_proof_widget WidgetView

end RpcReferenceWidget
