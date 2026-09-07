/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Widget
public meta import Lean.Widget
public import Lean.Server.FileWorker.RequestHandling
public import Vir.Infoview.Package

public section

namespace Lean.Vir.Infoview

open Lean Server

structure ProofWidgetsExprWithCtxAtPosRequest where
  pos : Lsp.Position
  packageRevision : String
  deriving Server.RpcEncodable

meta structure ProofWidgetsRpcRefInfo where
  id : String
  label : String
  typeName : String
  summary : String
  expression : String
  typeText : String
  context : String
  source : String
  position : String
  packageRevision : String
  knownConstant : Bool
  deriving Server.RpcEncodable

structure StoredExprWithCtx where
  id : String
  label : String
  typeName : String
  summary : String
  expression : String
  typeText : String
  context : String
  source : String
  position : String
  packageRevision : String
  knownConstant : Bool
  deriving TypeName

meta structure SavedExprWithCtxRef where
  ref : Server.WithRpcRef StoredExprWithCtx
  info : ProofWidgetsRpcRefInfo
  deriving Server.RpcEncodable

meta structure StoredExprWithCtxRefRequest where
  ref : Server.WithRpcRef StoredExprWithCtx
  pos : Lsp.Position
  packageRevision : String
  deriving Server.RpcEncodable

def StoredExprWithCtx.toInfo (stored : StoredExprWithCtx) : ProofWidgetsRpcRefInfo :=
  {
    id := stored.id
    label := stored.label
    typeName := stored.typeName
    summary := stored.summary
    expression := stored.expression
    typeText := stored.typeText
    context := stored.context
    source := stored.source
    position := stored.position
    packageRevision := stored.packageRevision
    knownConstant := stored.knownConstant
  }

def StoredExprWithCtx.refresh
    (stored : StoredExprWithCtx)
    (source position : String)
    (knownConstant : Bool) :
    StoredExprWithCtx :=
  { stored with source, position, knownConstant }

meta def lspPositionLabel (source : String) (pos : Lsp.Position) : String :=
  let fileName := (System.FilePath.mk source).fileName.getD source
  s!"{fileName}:{pos.line + 1}:{pos.character + 1}"

meta def interactiveHypothesesContext (hyps : Array Widget.InteractiveHypothesisBundle) : String :=
  String.intercalate "\n" <| hyps.toList.map fun hyp =>
    let names := String.intercalate " " hyp.names.toList
    let names := if names.isEmpty then "_" else names
    let valueSuffix :=
      match hyp.val? with
      | none => ""
      | some value => s!" := {value.stripTags}"
    s!"{names} : {hyp.type.stripTags}{valueSuffix}"

meta def interactiveGoalLabel (goal : Widget.InteractiveGoal) (index : Nat) : String :=
  match goal.userName? with
  | some userName => s!"case {userName}"
  | none => s!"Goal {index + 1}"

meta def interactiveGoalStoredExprWithCtx
    (goal : Widget.InteractiveGoal)
    (source position packageRevision : String)
    (index : Nat) :
    StoredExprWithCtx :=
  let id := toString goal.mvarId.name
  let label := interactiveGoalLabel goal index
  let expression := goal.type.stripTags
  {
    id
    label
    typeName := "ExprWithCtx"
    summary := s!"goal {index + 1} target at {position}"
    expression
    typeText := "Prop"
    context := interactiveHypothesesContext goal.hyps
    source
    position
    packageRevision
    knownConstant := false
  }

meta def saveStoredExprWithCtx (stored : StoredExprWithCtx) : RequestM SavedExprWithCtxRef := do
  let ref ← Server.WithRpcRef.mk stored
  return { ref, info := stored.toInfo }

def rpcRefIdKnownConstant (env : Environment) (id : String) : Bool :=
  match nameFromDotted id with
  | .ok name => env.contains name
  | .error _ => false

@[server_rpc_method]
def createProofWidgetsExprWithCtxAtPos
    (params : ProofWidgetsExprWithCtxAtPosRequest) :
    RequestM (RequestTask (Option SavedExprWithCtxRef)) := do
  let doc ← RequestM.readDoc
  let source := documentSourceName doc
  let position := lspPositionLabel source params.pos
  let goalsTask ← Server.FileWorker.getInteractiveGoals {
    textDocument := { uri := doc.meta.uri }
    position := params.pos
  }
  RequestM.mapRequestTaskCostly goalsTask fun goals? => do
    match goals?.bind (fun goals => goals.goals[0]?) with
    | none => return none
    | some goal =>
      let stored := interactiveGoalStoredExprWithCtx
        goal
        source
        position
        params.packageRevision
        0
      return some (← saveStoredExprWithCtx stored)

@[server_rpc_method]
meta def resolveProofWidgetsExprWithCtxRef
    (params : StoredExprWithCtxRefRequest) :
    RequestM (RequestTask ProofWidgetsRpcRefInfo) := do
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    let position := lspPositionLabel source params.pos
    let stored := params.ref.val.refresh source position (rpcRefIdKnownConstant snap.env params.ref.val.id)
    return stored.toInfo

end Lean.Vir.Infoview
