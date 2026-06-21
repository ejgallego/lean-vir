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
open Lean.IR

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

def hashArray (seed : UInt64) (items : Array α) (hashItem : α → UInt64) : UInt64 :=
  items.foldl (fun h item => mixHash h (hashItem item)) (mixHash seed (hash items.size))

def hashOption (seed : UInt64) (value? : Option α) (hashItem : α → UInt64) : UInt64 :=
  match value? with
  | none => mixHash seed (hash "none")
  | some value => mixHash (mixHash seed (hash "some")) (hashItem value)

def hashBool (value : Bool) : UInt64 :=
  if value then hash "true" else hash "false"

partial def irTypeHash : IRType → UInt64
  | .float => hash "IRType.float"
  | .uint8 => hash "IRType.uint8"
  | .uint16 => hash "IRType.uint16"
  | .uint32 => hash "IRType.uint32"
  | .uint64 => hash "IRType.uint64"
  | .usize => hash "IRType.usize"
  | .erased => hash "IRType.erased"
  | .object => hash "IRType.object"
  | .tobject => hash "IRType.tobject"
  | .float32 => hash "IRType.float32"
  | .struct leanTypeName? types =>
      hashArray (hashOption (hash "IRType.struct") leanTypeName? hash) types irTypeHash
  | .union leanTypeName types =>
      hashArray (mixHash (hash "IRType.union") (hash leanTypeName)) types irTypeHash
  | .tagged => hash "IRType.tagged"
  | .void => hash "IRType.void"

def varHash (x : VarId) : UInt64 :=
  hash x.idx

def joinPointHash (j : JoinPointId) : UInt64 :=
  hash j.idx

def argHash : Arg → UInt64
  | .var x => mixHash (hash "Arg.var") (varHash x)
  | .erased => hash "Arg.erased"

def paramHash (param : Param) : UInt64 :=
  mixHash
    (mixHash (mixHash (hash "Param") (varHash param.x)) (hashBool param.borrow))
    (irTypeHash param.ty)

def ctorInfoHash (info : CtorInfo) : UInt64 :=
  mixHash
    (mixHash
      (mixHash (mixHash (hash "CtorInfo") (hash info.name)) (hash info.cidx))
      (hash info.size))
    (mixHash (hash info.usize) (hash info.ssize))

def litValHash : LitVal → UInt64
  | .num value => mixHash (hash "LitVal.num") (hash value)
  | .str value => mixHash (hash "LitVal.str") (hash value)

def exprHash : IR.Expr → UInt64
  | .ctor info args =>
      hashArray (mixHash (hash "Expr.ctor") (ctorInfoHash info)) args argHash
  | .reset n x =>
      mixHash (mixHash (hash "Expr.reset") (hash n)) (varHash x)
  | .reuse x info updtHeader args =>
      hashArray
        (mixHash (mixHash (mixHash (hash "Expr.reuse") (varHash x)) (ctorInfoHash info)) (hashBool updtHeader))
        args
        argHash
  | .proj i x =>
      mixHash (mixHash (hash "Expr.proj") (hash i)) (varHash x)
  | .uproj i x =>
      mixHash (mixHash (hash "Expr.uproj") (hash i)) (varHash x)
  | .sproj n offset x =>
      mixHash (mixHash (mixHash (hash "Expr.sproj") (hash n)) (hash offset)) (varHash x)
  | .fap f args =>
      hashArray (mixHash (hash "Expr.fap") (hash f)) args argHash
  | .pap f args =>
      hashArray (mixHash (hash "Expr.pap") (hash f)) args argHash
  | .ap x args =>
      hashArray (mixHash (hash "Expr.ap") (varHash x)) args argHash
  | .box ty x =>
      mixHash (mixHash (hash "Expr.box") (irTypeHash ty)) (varHash x)
  | .unbox x =>
      mixHash (hash "Expr.unbox") (varHash x)
  | .lit value =>
      mixHash (hash "Expr.lit") (litValHash value)
  | .isShared x =>
      mixHash (hash "Expr.isShared") (varHash x)

mutual

partial def fnBodyHash : FnBody → UInt64
  | .vdecl x ty expr body =>
      mixHash
        (mixHash
          (mixHash (mixHash (hash "FnBody.vdecl") (varHash x)) (irTypeHash ty))
          (exprHash expr))
        (fnBodyHash body)
  | .jdecl j params value body =>
      mixHash
        (hashArray (mixHash (hash "FnBody.jdecl") (joinPointHash j)) params paramHash)
        (mixHash (fnBodyHash value) (fnBodyHash body))
  | .set x i value body =>
      mixHash
        (mixHash (mixHash (hash "FnBody.set") (varHash x)) (hash i))
        (mixHash (argHash value) (fnBodyHash body))
  | .setTag x cidx body =>
      mixHash
        (mixHash (mixHash (hash "FnBody.setTag") (varHash x)) (hash cidx))
        (fnBodyHash body)
  | .uset x i value body =>
      mixHash
        (mixHash (mixHash (hash "FnBody.uset") (varHash x)) (hash i))
        (mixHash (varHash value) (fnBodyHash body))
  | .sset x i offset value ty body =>
      mixHash
        (mixHash
          (mixHash
            (mixHash (mixHash (hash "FnBody.sset") (varHash x)) (hash i))
            (hash offset))
          (mixHash (varHash value) (irTypeHash ty)))
        (fnBodyHash body)
  | .inc x n c persistent body =>
      mixHash
        (mixHash
          (mixHash (mixHash (hash "FnBody.inc") (varHash x)) (hash n))
          (mixHash (hashBool c) (hashBool persistent)))
        (fnBodyHash body)
  | .dec x n c persistent body =>
      mixHash
        (mixHash
          (mixHash (mixHash (hash "FnBody.dec") (varHash x)) (hash n))
          (mixHash (hashBool c) (hashBool persistent)))
        (fnBodyHash body)
  | .del x body =>
      mixHash (mixHash (hash "FnBody.del") (varHash x)) (fnBodyHash body)
  | .case tid x ty alts =>
      hashArray
        (mixHash
          (mixHash (mixHash (hash "FnBody.case") (hash tid)) (varHash x))
          (irTypeHash ty))
        alts
        altHash
  | .ret value =>
      mixHash (hash "FnBody.ret") (argHash value)
  | .jmp j args =>
      hashArray (mixHash (hash "FnBody.jmp") (joinPointHash j)) args argHash
  | .unreachable =>
      hash "FnBody.unreachable"

partial def altHash : Alt → UInt64
  | .ctor info body =>
      mixHash (mixHash (hash "Alt.ctor") (ctorInfoHash info)) (fnBodyHash body)
  | .default body =>
      mixHash (hash "Alt.default") (fnBodyHash body)

end

def declInfoHash (info : DeclInfo) : UInt64 :=
  hashOption (hash "DeclInfo") info.sorryDep? hash

def externTargetHash (decl : Decl) : UInt64 :=
  hashOption (hash "ExternTarget") (Vir.GeneratePackage.virJsTargetFromDecl? decl) hash

def irDeclHash : Decl → UInt64
  | .fdecl name params resultType body info =>
      mixHash
        (hashArray (mixHash (mixHash (hash "Decl.fdecl") (hash name)) (irTypeHash resultType)) params paramHash)
        (mixHash (fnBodyHash body) (declInfoHash info))
  | .extern name params resultType ext =>
      let decl := Decl.extern name params resultType ext
      mixHash
        (hashArray (mixHash (mixHash (hash "Decl.extern") (hash name)) (irTypeHash resultType)) params paramHash)
        (externTargetHash decl)

def closureIRHash (closure : Vir.GeneratePackage.Closure) : UInt64 :=
  let decls := closure.decls.qsort fun lhs rhs => lhs.decl.name.toString < rhs.decl.name.toString
  hashArray (hash "ClosureIR") decls fun loaded =>
    mixHash (mixHash (hash loaded.source) (hash loaded.decl.name)) (irDeclHash loaded.decl)

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

def packageClosure
    (source : String)
    (roots : Array Name)
    (snap : Server.Snapshots.Snapshot) :
    Vir.GeneratePackage.Closure :=
  let target : Vir.GeneratePackage.Target := {
    source := System.FilePath.mk source
    roots := roots
  }
  let index := Vir.GeneratePackage.declIndexFromEnvironment source snap.env
  Vir.GeneratePackage.collectClosure #[target] index

def packageRangeToken?
    (doc : Server.FileWorker.EditableDocument)
    (source : String)
    (closure : Vir.GeneratePackage.Closure)
    (env : Environment) : IO (Option String) := do
  let names := localClosureDeclNames source closure
  if names.isEmpty then
    return none
  let ranges ← Vir.GeneratePackage.runCoreForSource source env do
    let mut result := #[]
    for name in names do
      result := result.push (name, ← findDeclarationRanges? name)
    return result
  return packageRangeTokenFrom doc ranges

def packageClosureToken
    (doc : Server.FileWorker.EditableDocument)
    (source : String)
    (roots : Array Name)
    (snap : Server.Snapshots.Snapshot) : IO String := do
  let closure := packageClosure source roots snap
  let rangeToken? ← packageRangeToken? doc source closure snap.env
  let rangeToken := rangeToken?.getD "source-ranges:none"
  return s!"closure-ir:{closure.decls.size}:{closureIRHash closure}:{rangeToken}"

def irPackageRevision
    (_doc : Server.FileWorker.EditableDocument)
    (roots : Array Name)
    (token : String) : String :=
  let rootToken := ",".intercalate (roots.map (fun name => name.toString)).toList
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
    let token ← packageClosureToken doc source roots snap
    return {
      source := source
      roots := roots.map (fun name => name.toString)
      revision := irPackageRevision doc roots token
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
    let token ← packageClosureToken doc source roots snap
    let revision := irPackageRevision doc roots token
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
