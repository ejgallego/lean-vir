/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Surface
public import Vir.React

public section

/-!
A native RPC response can remain in React state and be rendered by Lean without
decoding its server references. The browser acceptance example supplies the
official position-specific session and handles cancellation/stale results in its
ordinary React effect in `rpc-reference-widget.js`. Asynchronous continuations
are native JS functions; rendering, requests and click handlers enter Lean
synchronously. See `RpcReferenceWidget.md` for the two-file tutorial.
-/

namespace RpcReferenceWidget

open Lean.Vir

/-- Response shape: a message and a nested server-owned RPC reference. -/
opaque Reply : Type

def request (session : Js Infoview.RpcSession) (method : Js String)
    (params : Js.Object) (options : Js Infoview.ClientRequestOptions) :
    RuntimeM (Js.Promise Reply) :=
  Infoview.RpcSession.callWithOptions session method (Js.erase params) options

/-- Both projections preserve the exact nested values registered by the RPC client. -/
def reference (reply : Js Reply) : RuntimeM Js.Any := do
  Js.Object.get reply (← JsValue.ofString "ref")

def message (reply : Js Reply) : RuntimeM (Js String) := do
  Js.Object.get reply (← JsValue.ofString "message")

/-- Send the exact registered reference back to its owning RPC session. -/
def readReference (session : Js Infoview.RpcSession) (reply : Js Reply) :
    RuntimeM (Js.Promise String) := do
  let params ← Js.Object.empty
  Js.Object.set params (← JsValue.ofString "ref") (← reference reply)
  Infoview.RpcSession.call session (← JsValue.ofString "RpcBrowserServer.read") params

/-- A native React function component; constructing it once preserves hook identity. -/
def View : RuntimeM (Js (React.Component (Js Reply))) := React.Component.ofLean fun reply => do
  let count ← React.StateTuple.toState (← React.Hooks.useState (← JsValue.ofNat 0))
  let label ← JsValue.toString (← message reply)
  let n ← JsValue.toNat count.value
  React.Node.buttonWith #[React.Props.id "rpc-reference-view", React.Props.onClick do
    React.State.modify count fun previous => do
      JsValue.ofNat ((← JsValue.toNat previous) + 1)]
    #[← React.Node.text s!"{label} / local {n}"]

/-- Build the native React element for a response kept in the parent React state. -/
def render (component : Js (React.Component (Js Reply))) (reply : Js Reply) :
    React.ReactM (Js React.Node) :=
  React.Node.component component reply

end RpcReferenceWidget
