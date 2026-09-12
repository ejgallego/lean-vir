module

public import Vir.Infoview

public section

namespace Vir.Fixtures.InfoviewRpcPromise

/-- Phantom request shape used to verify exact JavaScript identity. -/
opaque Request : Type

/-- Phantom response shape returned by the test RPC session. -/
opaque Response : Type

/-- Forget only the phantom type; the JavaScript value and root remain exact. -/
def eraseExact (value : Lean.Vir.Js Request) : Lean.Vir.Js.Any :=
  Lean.Vir.Js.erase value

/-- Exercise the generic checked-cast class while preserving successful identity. -/
def castElementOr
    (value : Lean.Vir.Js.Any)
    (fallback : Lean.Vir.Js Lean.Vir.Browser.Element) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.Element) := do
  match ← Lean.Vir.Js.cast (target := Lean.Vir.Browser.Element) value with
  | .ok element => pure element
  | .error _ => pure fallback

/-- Return the exact native Promise produced by the position-specific session. -/
def callExact
    (session : Lean.Vir.Js Lean.Vir.Infoview.RpcSession)
    (request : Lean.Vir.Js Request) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Response) := do
  let method ← Lean.Vir.JsValue.ofString "Vir.Fixtures.InfoviewRpcPromise.echo"
  Lean.Vir.Infoview.RpcSession.call session method request

/-- Call through the exact RPC session returned by the infoview hook. -/
def callHookExact
    (request : Lean.Vir.Js Request) :
    Lean.Vir.React.ReactM (Lean.Vir.Js.Promise Response) := do
  callExact (← Lean.Vir.Infoview.useRpcSession) request

/--
Call a position-specific infoview RPC session and project one response field
through native Promise and object operations. The projected message must be a
primitive string; malformed fields reject the chained Promise without coercion.
No request or response object is decoded into a parallel Lean representation.
-/
def callMessage
    (session : Lean.Vir.Js Lean.Vir.Infoview.RpcSession)
    (request : Lean.Vir.Js Request) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise String) := do
  let pending ← callExact session request
  let projectMessage ← Lean.Vir.Js.Function.ofLean fun response => do
    let key ← Lean.Vir.JsValue.ofString "message"
    Lean.Vir.Js.String.fromAny (← Lean.Vir.Js.Object.get response key)
  Lean.Vir.Js.Promise.thenValue pending projectMessage

/-- Recover a rejected native Promise with an exact caller-supplied object. -/
def recover
    (session : Lean.Vir.Js Lean.Vir.Infoview.RpcSession)
    (request : Lean.Vir.Js Request)
    (fallback : Lean.Vir.Js Response) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Response) := do
  let pending ← callExact session request
  let recoverWithFallback ← Lean.Vir.Js.Function.ofLean
    (α := Lean.Vir.Js.Any.Value) fun _ => pure fallback
  Lean.Vir.Js.Promise.catchValue pending recoverWithFallback

/-- Pass an exact native state-setter-shaped function to native `Promise.then`. -/
def settleIntoState
    (pending : Lean.Vir.Js.Promise Response)
    (setter : Lean.Vir.Js (Lean.Vir.React.StateSetter (Lean.Vir.Js Response))) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Lean.Vir.Js.Undefined.Value) :=
  Lean.Vir.Js.Promise.thenVoid pending setter

/-- Expose native Promise assimilation without a VIR scheduler or wrapper. -/
def thenPromiseExact
    (pending : Lean.Vir.Js.Promise Response)
    (next : Lean.Vir.Js.Function1
      (Lean.Vir.Js Response) (Lean.Vir.Js.Promise String)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise String) :=
  Lean.Vir.Js.Promise.thenPromise pending next

def thenBothValue
    (pending : Lean.Vir.Js.Promise Response)
    (onFulfilled : Lean.Vir.Js.Function1 (Lean.Vir.Js Response) (Lean.Vir.Js Response))
    (onRejected : Lean.Vir.Js.Function1 Lean.Vir.Js.Any (Lean.Vir.Js Response)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Response) :=
  Lean.Vir.Js.Promise.thenValueWithRejection pending onFulfilled onRejected

def thenBothVoid
    (pending : Lean.Vir.Js.Promise Response)
    (onFulfilled : Lean.Vir.Js.Function1 (Lean.Vir.Js Response) Unit)
    (onRejected : Lean.Vir.Js.Function1 Lean.Vir.Js.Any Unit) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Promise Lean.Vir.Js.Undefined.Value) :=
  Lean.Vir.Js.Promise.thenVoidWithRejection pending onFulfilled onRejected

def createAbortController : Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.AbortController) :=
  Lean.Vir.Browser.AbortController.create

def abortSignal (controller : Lean.Vir.Js Lean.Vir.Browser.AbortController) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.AbortSignal) :=
  Lean.Vir.Browser.AbortController.getSignal controller

def abort (controller : Lean.Vir.Js Lean.Vir.Browser.AbortController) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.Browser.AbortController.abort controller

end Vir.Fixtures.InfoviewRpcPromise
