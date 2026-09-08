/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public meta import Vir.Infoview
public meta import Lean.Server.FileWorker.RequestHandling

public section

namespace RpcBrowserServer

open Lean Server

meta structure Payload where
  message : String
  deriving TypeName

meta structure Query where
  message : String
  waitForCancellation : Bool
  fail : Bool
  deriving RpcEncodable

meta structure Reply where
  message : String
  ref : WithRpcRef Payload
  deriving RpcEncodable

@[server_rpc_method]
meta def create (query : Query) : RequestM (RequestTask Reply) := RequestM.asTask do
  -- This test mode cannot finish before cancellation, regardless of scheduling.
  while query.waitForCancellation do
    RequestM.checkCancelled
    IO.sleep 10
  if query.fail then
    throw (RequestError.invalidParams "RPC example rejection")
  return { message := query.message, ref := ← WithRpcRef.mk { message := query.message } }

meta structure RefQuery where
  ref : WithRpcRef Payload
  deriving RpcEncodable

@[server_rpc_method]
meta def read (query : RefQuery) : RequestM (RequestTask String) :=
  RequestM.pureTask (pure query.ref.val.message)

/-- A display snapshot, not an elaborator-owned expression/context pair. -/
meta structure GoalSnapshot where
  target : String
  hypotheses : Array String
  deriving RpcEncodable, TypeName

meta structure GoalQuery where
  pos : Lsp.Position
  deriving RpcEncodable

@[server_rpc_method]
meta def goalAt (query : GoalQuery) : RequestM (RequestTask (Option (WithRpcRef GoalSnapshot))) := do
  let doc ← RequestM.readDoc
  let task ← Server.FileWorker.getInteractiveGoals {
    textDocument := { uri := doc.meta.uri }, position := query.pos }
  RequestM.mapRequestTaskCostly task fun goals? => do
    match goals?.bind (fun goals => goals.goals[0]?) with
    | none => return none
    | some goal =>
      return some (← WithRpcRef.mk {
        target := goal.type.stripTags
        hypotheses := goal.hyps.map fun hyp =>
          s!"{String.intercalate " " hyp.names.toList} : {hyp.type.stripTags}"
      : GoalSnapshot })

meta structure GoalRefQuery where
  ref : WithRpcRef GoalSnapshot
  deriving RpcEncodable

@[server_rpc_method]
meta def readGoal (query : GoalRefQuery) : RequestM (RequestTask GoalSnapshot) :=
  RequestM.pureTask (pure query.ref.val)

-- rpc-position-a
example (n : Nat) : n = n := by
  rfl

-- rpc-position-b
example (p : Prop) (h : p) : p := by
  exact h

end RpcBrowserServer
