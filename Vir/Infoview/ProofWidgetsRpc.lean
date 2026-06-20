/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Widget
import Vir.Infoview.Package

namespace Lean.Vir.Infoview

open Lean Server

structure ProofWidgetsRpcRef where
  id : String
  label : String
  typeName : String
  summary : String
  deriving Server.RpcEncodable

structure ProofWidgetsRpcRefRequest where
  ref : ProofWidgetsRpcRef
  pos : Lsp.Position
  packageRevision : String
  deriving Server.RpcEncodable

structure ProofWidgetsRpcRefInfo where
  id : String
  label : String
  typeName : String
  summary : String
  source : String
  position : String
  packageRevision : String
  knownConstant : Bool
  deriving Server.RpcEncodable

def lspPositionLabel (source : String) (pos : Lsp.Position) : String :=
  let fileName := (System.FilePath.mk source).fileName.getD source
  s!"{fileName}:{pos.line + 1}:{pos.character + 1}"

def rpcRefName? (ref : ProofWidgetsRpcRef) : Option Name :=
  match nameFromDotted ref.id with
  | .ok name => some name
  | .error _ => none

def rpcRefKnownConstant (env : Environment) (ref : ProofWidgetsRpcRef) : Bool :=
  match rpcRefName? ref with
  | none => false
  | some name => env.contains name

@[server_rpc_method]
def resolveProofWidgetsRpcRef
    (params : ProofWidgetsRpcRefRequest) :
    RequestM (RequestTask ProofWidgetsRpcRefInfo) := do
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    return {
      id := params.ref.id
      label := params.ref.label
      typeName := params.ref.typeName
      summary := params.ref.summary
      source := source
      position := lspPositionLabel source params.pos
      packageRevision := params.packageRevision
      knownConstant := rpcRefKnownConstant snap.env params.ref
    }

end Lean.Vir.Infoview
