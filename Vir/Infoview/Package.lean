/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.DeclarationRange
import Lean.Widget
import Init.System.Uri
import Vir.GeneratePackage
import Vir.Infoview.Assets

namespace Lean.Vir.Infoview

open Lean Server

structure IRPackage where
  roots : Array String
  deriving Server.RpcEncodable

structure IRPackageRequest where
  package : IRPackage
  pos : Lsp.Position
  deriving Server.RpcEncodable

structure IRPackageResponse where
  source : String
  roots : Array String
  byteSize : String
  revision : String
  dataBase64 : String
  report : String
  deriving Server.RpcEncodable

structure IRPackageInfo where
  source : String
  roots : Array String
  revision : String
  deriving Server.RpcEncodable

def nameFromDotted (text : String) : Except String Name := do
  if text.isEmpty then
    throw "root name must be non-empty"
  let parts := text.splitOn "."
  if parts.any (fun part => part.isEmpty) then
    throw s!"root name `{text}` must not contain empty components"
  return parts.foldl (fun name part => .str name part) .anonymous

def irPackageRoots (package : IRPackage) : Except String (Array Name) := do
  if package.roots.isEmpty then
    throw "at least one root name is required"
  let mut names : Array Name := #[]
  for root in package.roots do
    let name ← nameFromDotted root
    if !names.contains name then
      names := names.push name
  return names

def documentSourceName (doc : Server.FileWorker.EditableDocument) : String :=
  match System.Uri.fileUriToPath? doc.meta.uri with
  | some path => path.toString
  | none => doc.meta.uri

def sortedNames (names : Array Name) : Array Name :=
  names.qsort (fun lhs rhs => lhs.toString < rhs.toString)

def dedupNames (names : Array Name) : Array Name :=
  names.foldl (fun acc name =>
    if acc.contains name then acc else acc.push name) #[]

def sourceRangeHash
    (doc : Server.FileWorker.EditableDocument)
    (range : DeclarationRange) : UInt64 :=
  let start := doc.meta.text.ofPosition range.pos
  let stop := doc.meta.text.ofPosition range.endPos
  let text := String.Pos.Raw.extract doc.meta.text.source start stop
  let positionToken :=
    s!"{range.pos.line}:{range.pos.column}-{range.endPos.line}:{range.endPos.column}"
  mixHash (hash text) (hash positionToken)

def localClosureDeclNames
    (source : String)
    (closure : Vir.GeneratePackage.Closure) : Array Name :=
  let names := closure.decls.foldl (fun names loaded =>
    if loaded.source == source then
      names.push loaded.decl.name
    else
      names) #[]
  sortedNames (dedupNames names)

def packageRangeTokenFrom
    (doc : Server.FileWorker.EditableDocument)
    (ranges : Array (Name × Option DeclarationRanges)) : Option String := Id.run do
  let mut count := 0
  let mut h : UInt64 := 17
  for (name, range?) in ranges do
    match range? with
    | none => pure ()
    | some ranges =>
        count := count + 1
        h := mixHash h (mixHash (hash name) (sourceRangeHash doc ranges.range))
  if count == 0 then
    none
  else
    some s!"source-ranges:{count}:{h}"

def packageRangeToken?
    (doc : Server.FileWorker.EditableDocument)
    (source : String)
    (roots : Array Name)
    (snap : Server.Snapshots.Snapshot) : IO (Option String) := do
  let target : Vir.GeneratePackage.Target := {
    source := System.FilePath.mk source
    roots := roots
  }
  let index := Vir.GeneratePackage.declIndexFromEnvironment source snap.env
  let closure := Vir.GeneratePackage.collectClosure #[target] index
  let names := localClosureDeclNames source closure
  if names.isEmpty then
    return none
  let ranges ← Vir.GeneratePackage.runCoreForSource source snap.env do
    let mut result := #[]
    for name in names do
      result := result.push (name, ← findDeclarationRanges? name)
    return result
  return packageRangeTokenFrom doc ranges

def irPackageRevision
    (doc : Server.FileWorker.EditableDocument)
    (roots : Array Name)
    (token? : Option String := none) : String :=
  let rootToken := ",".intercalate (roots.map (fun name => name.toString)).toList
  let token := token?.getD s!"document-version:{doc.meta.version}"
  s!"ir-package:{token}:{rootToken}"

@[server_rpc_method]
def statIRPackage (params : IRPackageRequest) : RequestM (RequestTask IRPackageInfo) := do
  let roots ←
    match irPackageRoots params.package with
    | .ok roots => pure roots
    | .error message =>
        throwThe RequestError { code := .invalidParams, message := s!"Invalid VIR IR package roots: {message}" }
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    let token? ← packageRangeToken? doc source roots snap
    return {
      source := source
      roots := roots.map (fun name => name.toString)
      revision := irPackageRevision doc roots token?
    }

@[server_rpc_method]
def buildIRPackage (params : IRPackageRequest) : RequestM (RequestTask IRPackageResponse) := do
  let roots ←
    match irPackageRoots params.package with
    | .ok roots => pure roots
    | .error message =>
        throwThe RequestError { code := .invalidParams, message := s!"Invalid VIR IR package roots: {message}" }
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    let token? ← packageRangeToken? doc source roots snap
    let revision := irPackageRevision doc roots token?
    let target : Vir.GeneratePackage.Target := {
      source := System.FilePath.mk source
      roots := roots
    }
    let index := Vir.GeneratePackage.declIndexFromEnvironment source snap.env
    match ← Vir.GeneratePackage.buildPackageFromIndex revision #[target] index with
    | .ok pkg =>
        return {
          source := source
          roots := roots.map (fun name => name.toString)
          byteSize := toString pkg.bytes.size
          revision := revision
          dataBase64 := base64Encode pkg.bytes
          report := pkg.report
        }
    | .error message =>
        throwThe RequestError { code := .invalidParams, message := s!"VIR IR package failed:\n{message}" }

end Lean.Vir.Infoview
