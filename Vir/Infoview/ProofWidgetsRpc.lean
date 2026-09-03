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

meta structure ProofWidgetsRpcRef where
  id : String
  label : String
  typeName : String
  summary : String
  expression : String
  typeText : String
  context : String
  deriving Server.RpcEncodable

meta structure ProofWidgetsRpcRefRequest where
  ref : ProofWidgetsRpcRef
  pos : Lsp.Position
  packageRevision : String
  deriving Server.RpcEncodable

meta structure ProofWidgetsExprWithCtxAtPosRequest where
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
  storeKey : String
  knownConstant : Bool
  deriving Server.RpcEncodable

meta structure StoredExprWithCtx where
  storeKey : String
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

meta initialize proofWidgetsRpcRefStore : IO.Ref (Array StoredExprWithCtx) ← IO.mkRef #[]

meta def maxStoredProofWidgetsRpcRefs : Nat :=
  1024

meta def proofWidgetsRpcRefStoreKey (packageRevision id : String) : String :=
  packageRevision ++ ":" ++ id

meta def upsertStoredExprWithCtx
    (stored : StoredExprWithCtx)
    (items : Array StoredExprWithCtx) :
    Array StoredExprWithCtx :=
  (stored :: items.toList.filter (fun item => item.storeKey != stored.storeKey))
    |>.take maxStoredProofWidgetsRpcRefs
    |>.toArray

meta def StoredExprWithCtx.toInfo (stored : StoredExprWithCtx) : ProofWidgetsRpcRefInfo :=
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
    storeKey := stored.storeKey
    knownConstant := stored.knownConstant
  }

meta def mkStoredExprWithCtx
    (ref : ProofWidgetsRpcRef)
    (source position packageRevision : String)
    (knownConstant : Bool) :
    StoredExprWithCtx :=
  {
    storeKey := proofWidgetsRpcRefStoreKey packageRevision ref.id
    id := ref.id
    label := ref.label
    typeName := ref.typeName
    summary := ref.summary
    expression := ref.expression
    typeText := ref.typeText
    context := ref.context
    source
    position
    packageRevision
    knownConstant
  }

meta def StoredExprWithCtx.refresh
    (stored : StoredExprWithCtx)
    (source position : String)
    (knownConstant : Bool) :
    StoredExprWithCtx :=
  { stored with source, position, knownConstant }

meta def rememberStoredExprWithCtx (stored : StoredExprWithCtx) : IO Unit :=
  proofWidgetsRpcRefStore.modify (upsertStoredExprWithCtx stored)

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
    storeKey := proofWidgetsRpcRefStoreKey packageRevision id
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
  rememberStoredExprWithCtx stored
  let ref ← Server.WithRpcRef.mk stored
  return { ref, info := stored.toInfo }

meta def rpcRefName? (ref : ProofWidgetsRpcRef) : Option Name :=
  match Vir.parseDottedName ref.id with
  | .ok name => some name
  | .error _ => none

meta def rpcRefKnownConstant (env : Environment) (ref : ProofWidgetsRpcRef) : Bool :=
  match rpcRefName? ref with
  | none => false
  | some name => env.contains name

meta def rpcRefIdKnownConstant (env : Environment) (id : String) : Bool :=
  match Vir.parseDottedName id with
  | .ok name => env.contains name
  | .error _ => false

@[server_rpc_method]
meta def resolveProofWidgetsRpcRef
    (params : ProofWidgetsRpcRefRequest) :
    RequestM (RequestTask ProofWidgetsRpcRefInfo) := do
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    let stored := mkStoredExprWithCtx
      params.ref
      source
      (lspPositionLabel source params.pos)
      params.packageRevision
      (rpcRefKnownConstant snap.env params.ref)
    rememberStoredExprWithCtx stored
    return stored.toInfo

@[server_rpc_method]
meta def createProofWidgetsExprWithCtxRef
    (params : ProofWidgetsRpcRefRequest) :
    RequestM (RequestTask SavedExprWithCtxRef) := do
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    let stored := mkStoredExprWithCtx
      params.ref
      source
      (lspPositionLabel source params.pos)
      params.packageRevision
      (rpcRefKnownConstant snap.env params.ref)
    rememberStoredExprWithCtx stored
    let ref ← Server.WithRpcRef.mk stored
    return { ref, info := stored.toInfo }

@[server_rpc_method]
meta def createProofWidgetsExprWithCtxAtPos
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
    rememberStoredExprWithCtx stored
    return stored.toInfo

end Lean.Vir.Infoview
