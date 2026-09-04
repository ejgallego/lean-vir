import Vir.Infoview

namespace Vir.Fixtures.InfoviewRpcPromise

/-- Phantom request shape used to verify exact JavaScript identity. -/
opaque Request : Type

/-- Phantom response shape returned by the test RPC session. -/
opaque Response : Type

/-- Return the exact native Promise produced by the position-specific session. -/
def callExact
    (session : Lean.Vir.Js Lean.Vir.Infoview.RpcSession)
    (request : Lean.Vir.Js Request) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Response) := do
  let method ← Lean.Vir.JsValue.ofString "Vir.Fixtures.InfoviewRpcPromise.echo"
  Lean.Vir.Infoview.RpcSession.call session method request

/-- Read the exact RPC session carried by the ordinary infoview surface. -/
def callSurfaceExact
    (surface : Lean.Vir.Infoview.Surface)
    (request : Lean.Vir.Js Request) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Response) :=
  callExact surface.rpcSession request

/--
Call a position-specific infoview RPC session and project one response field
through native Promise and object operations. No request or response object is
decoded into a parallel Lean representation.
-/
def callMessage
    (session : Lean.Vir.Js Lean.Vir.Infoview.RpcSession)
    (request : Lean.Vir.Js Request) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise String) := do
  let pending ← callExact session request
  Lean.Vir.Js.Promise.then_ pending fun response => do
    let key ← Lean.Vir.JsValue.ofString "message"
    Lean.Vir.Js.Object.get response key

/-- Recover a rejected native Promise with an exact caller-supplied object. -/
def recover
    (session : Lean.Vir.Js Lean.Vir.Infoview.RpcSession)
    (request : Lean.Vir.Js Request)
    (fallback : Lean.Vir.Js Response) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Response) := do
  let pending ← callExact session request
  Lean.Vir.Js.Promise.catch_ (error := Lean.Vir.Js.Any.Value) pending fun _ =>
    pure fallback

end Vir.Fixtures.InfoviewRpcPromise
