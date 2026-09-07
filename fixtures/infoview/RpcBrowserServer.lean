/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview

namespace RpcBrowserServer

open Lean Server

structure Payload where
  message : String
  deriving TypeName

structure Query where
  message : String
  delayMs : Nat
  fail : Bool
  deriving RpcEncodable

structure Reply where
  message : String
  ref : WithRpcRef Payload
  deriving RpcEncodable

@[server_rpc_method]
def create (query : Query) : RequestM (RequestTask Reply) := RequestM.asTask do
  for _ in [:min query.delayMs 2000 / 10] do
    IO.sleep 10
    RequestM.checkCancelled
  if query.fail then
    throw (RequestError.invalidParams "RPC example rejection")
  return { message := query.message, ref := ← WithRpcRef.mk { message := query.message } }

structure RefQuery where
  ref : WithRpcRef Payload
  deriving RpcEncodable

@[server_rpc_method]
def read (query : RefQuery) : RequestM (RequestTask String) :=
  RequestM.pureTask (pure query.ref.val.message)

-- rpc-position-a
example (n : Nat) : n = n := by
  rfl

-- rpc-position-b
example (p : Prop) (h : p) : p := by
  exact h

end RpcBrowserServer
