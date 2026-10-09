/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module
public import Vir.JsonValue.Codec
public meta import Vir.JsonValue.Codec
public meta import Lean.Server.FileWorker.RequestHandling

public section

namespace Lean.Vir.Infoview.JsonRpc

open Lean.Server

/-- Register the result of this explicit adapter with `server_rpc_method`.
The outer Json encoding is identity; no RpcObjectStore is fabricated. -/
meta def serveValue [FromJson request] [ToJson response]
    (handler : request → RequestM (RequestTask response))
    (params : Json) : RequestM (RequestTask Json) := do
  let params ← match JsonValue.decode params with
    | .ok params => pure params
    | .error error => throw (RequestError.invalidParams error)
  let task ← handler params
  RequestM.mapRequestTaskCheap task fun value =>
    match JsonValue.encode value with
    | .ok json => pure json
    | .error error => throw (RequestError.internalError s!"value RPC response: {error}")

end Lean.Vir.Infoview.JsonRpc
