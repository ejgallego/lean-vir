/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module
public import Vir.Infoview.Surface
public import Vir.JsonValue.Js
public import Vir.Js

public section

namespace Lean.Vir.Infoview.JsonRpc

/-- Opt-in value RPC. Encoding errors precede dispatch; transport errors reject
the native Promise. Fulfillment contains a JSL holding checked decoding, not a
JavaScript object masquerading as a Lean value. -/
def callValue [ToJson request] [FromJson response]
    (session : Js RpcSession) (method : Js String) (params : request)
    (options : Option (Js ClientRequestOptions) := none) :
    RuntimeM (Except String (Js.Promise (LeanRef.Handle (Except String response)))) := do
  match ← JsonValue.encodeJs params with
  | .error error => return .error error
  | .ok value =>
    let pending : Js.Promise Js.Any.Value ← match options with
      | none => RpcSession.call session method value
      | some options => RpcSession.callWithOptions session method value options
    let decode ← Js.Function.ofLean fun (value : Js.Any) => do
      LeanRef.toJSL (← JsonValue.decodeJs (α := response) value)
    return .ok (← Js.Promise.thenValue pending decode)

end Lean.Vir.Infoview.JsonRpc
