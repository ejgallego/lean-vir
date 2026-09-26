/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Widget
public meta import Lean.Widget
public import Init.System.Uri
public import Vir.GeneratePackage
public meta import Vir.GeneratePackage
public import Vir.Infoview.Assets

public section

namespace Lean.Vir.Infoview

open Lean Server
open Lean.IR

structure IRPackage where
  roots : Array String
  /-- Select exactly the package inputs retained by `vir_proof_widget` elaboration. -/
  fingerprint : String
  deriving Server.RpcEncodable

/--
Meta-phase mirror of `IRPackage` for server RPC requests. `IRPackage` remains a
runtime value because it is embedded in widget props; its generated
`RpcEncodable` instance therefore cannot be called from a `meta` RPC handler.
-/
meta structure IRPackageRpc where
  roots : Array String
  fingerprint : String
  deriving Server.RpcEncodable

meta structure IRPackageRequest where
  package : IRPackageRpc
  pos : Lsp.Position
  deriving Server.RpcEncodable

meta structure IRPackageResponse where
  source : String
  roots : Array String
  byteSize : String
  revision : String
  dataBase64 : String
  report : String
  deriving Server.RpcEncodable

private meta def irPackageRootNames (roots : Array String) : Except String (Array Name) := do
  if roots.isEmpty then
    throw "at least one root name is required"
  let mut names : Array Name := #[]
  for root in roots do
    let name ← Vir.parseDottedName root
    if !names.contains name then
      names := names.push name
  return names

meta def irPackageRoots (package : IRPackage) : Except String (Array Name) :=
  irPackageRootNames package.roots

meta def documentSourceName (doc : Server.FileWorker.EditableDocument) : String :=
  match System.Uri.fileUriToPath? doc.meta.uri with
  | some path => path.toString
  | none => doc.meta.uri

meta def hashArray (seed : UInt64) (items : Array α) (hashItem : α → UInt64) : UInt64 :=
  items.foldl (fun h item => mixHash h (hashItem item)) (mixHash seed (hash items.size))

meta def hashOption (seed : UInt64) (value? : Option α) (hashItem : α → UInt64) : UInt64 :=
  match value? with
  | none => mixHash seed (hash "none")
  | some value => mixHash (mixHash seed (hash "some")) (hashItem value)

meta def hashBool (value : Bool) : UInt64 :=
  if value then hash "true" else hash "false"

meta partial def irTypeHash : IRType → UInt64
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

meta def varHash (x : VarId) : UInt64 :=
  hash x.idx

meta def joinPointHash (j : JoinPointId) : UInt64 :=
  hash j.idx

meta def argHash : Arg → UInt64
  | .var x => mixHash (hash "Arg.var") (varHash x)
  | .erased => hash "Arg.erased"

meta def paramHash (param : Param) : UInt64 :=
  mixHash
    (mixHash (mixHash (hash "Param") (varHash param.x)) (hashBool param.borrow))
    (irTypeHash param.ty)

meta def ctorInfoHash (info : CtorInfo) : UInt64 :=
  mixHash
    (mixHash
      (mixHash (mixHash (hash "CtorInfo") (hash info.name)) (hash info.cidx))
      (hash info.size))
    (mixHash (hash info.usize) (hash info.ssize))

meta def litValHash : LitVal → UInt64
  | .num value => mixHash (hash "LitVal.num") (hash value)
  | .str value => mixHash (hash "LitVal.str") (hash value)

meta def exprHash : IR.Expr → UInt64
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

meta partial def fnBodyHash : FnBody → UInt64
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

meta partial def altHash : Alt → UInt64
  | .ctor info body =>
      mixHash (mixHash (hash "Alt.ctor") (ctorInfoHash info)) (fnBodyHash body)
  | .default body =>
      mixHash (hash "Alt.default") (fnBodyHash body)

end

meta def declInfoHash (info : DeclInfo) : UInt64 :=
  hashOption (hash "DeclInfo") info.sorryDep? hash

private meta def hostImportMetadataHash (metadata : Vir.HostMetadata.HostImportMetadata) : UInt64 :=
  mixHash (hash metadata.marker.attributeName) (hash metadata.target)

private meta def virExternMetadataHash (decl : Decl) : UInt64 :=
  hashOption (hash "VirExternMetadata")
    (Vir.GeneratePackage.virJsMetadataFromDecl? decl) hostImportMetadataHash

meta def irDeclHash : Decl → UInt64
  | .fdecl name params resultType body info =>
      mixHash
        (hashArray (mixHash (mixHash (hash "Decl.fdecl") (hash name)) (irTypeHash resultType)) params paramHash)
        (mixHash (fnBodyHash body) (declInfoHash info))
  | .extern name params resultType ext =>
      let decl := Decl.extern name params resultType ext
      mixHash
        (hashArray (mixHash (mixHash (hash "Decl.extern") (hash name)) (irTypeHash resultType)) params paramHash)
        (virExternMetadataHash decl)

/-- Immutable analyzed inputs, retained at the widget definition. No environment,
RPC reference or task is stored in the module artifact. Binary emission is deferred
until the browser requests the package. -/
meta initialize widgetPackages : SimplePersistentEnvExtension
    (Name × String × Vir.GeneratePackage.AnalyzedPackage)
    (NameMap (String × Vir.GeneratePackage.AnalyzedPackage)) ←
  registerSimplePersistentEnvExtension {
    addImportedFn := fun _ => {}
    addEntryFn := fun state (name, fingerprint, package) =>
      state.insert name (fingerprint, package)
  }

/-- Fingerprint the inputs of all emitted sections, including the complete
interface manifest. Source ranges and unrelated declarations are not inputs. -/
meta def widgetPackageFingerprint (package : Vir.GeneratePackage.AnalyzedPackage) : String := Id.run do
  let closure := package.closure
  let mut h := hashArray (hash "vir-widget-package") closure.decls fun loaded =>
    irDeclHash loaded.decl
  h := hashArray h closure.externs fun ext =>
    hashArray (mixHash (hash ext.name) (irTypeHash ext.resultType)) ext.params paramHash
  h := hashArray h closure.initGlobals fun entry =>
    mixHash (hash entry.name) (hash entry.initName)
  h := mixHash h (hash package.manifest.toJson)
  return s!"vir-widget:{h}"

private meta unsafe def prepareWidgetPackageImpl (source : String) (env : Environment) (root : Name) :
    IO (Except String (String × Vir.GeneratePackage.AnalyzedPackage)) := do
  let input ← match Vir.GeneratePackage.prepareSnapshotInput source env #[root] with
    | .ok input => pure input
    | .error message => return .error message
  -- Batch compilation need not load runtime IR for ordinary imports. Complete
  -- only imported owners; the current module always stays in the live snapshot.
  let index ← Vir.GeneratePackage.resolveImportedModuleClosure #[input.target] input.index
  let package ← Vir.GeneratePackage.analyzePackage "widget elaboration" #[input.target] index
  if Vir.GeneratePackage.hasBlockingDiagnostics package.closure package.manifest then
    return .error package.report
  return .ok (widgetPackageFingerprint package, package)

@[implemented_by prepareWidgetPackageImpl]
meta opaque prepareWidgetPackage (source : String) (env : Environment) (root : Name) :
    IO (Except String (String × Vir.GeneratePackage.AnalyzedPackage))

private meta def retainedWidgetPackage (env : Environment) (roots : Array Name)
    (fingerprint : String) : Except RequestError Vir.GeneratePackage.AnalyzedPackage := do
  let fail : Except RequestError Vir.GeneratePackage.AnalyzedPackage := .error {
    code := .invalidParams
    message := "VIR widget package fingerprint is unavailable; refresh the widget description"
  }
  let #[root] := roots | fail
  let found := match env.getModuleIdxFor? root with
    | some idx => widgetPackages.getModuleEntries env idx |>.findSome? fun (name, key, package) =>
        if name == root then some (key, package) else none
    | none => widgetPackages.getState env |>.find? root
  let some (key, package) := found | fail
  if key != fingerprint then return ← fail
  return package

@[server_rpc_method]
meta def buildIRPackage (params : IRPackageRequest) : RequestM (RequestTask IRPackageResponse) := do
  let roots ←
    match irPackageRootNames params.package.roots with
    | .ok roots => pure roots
    | .error message =>
        throwThe RequestError { code := .invalidParams, message := s!"Invalid VIR IR package roots: {message}" }
  RequestM.withWaitFindSnapAtPos params.pos fun snap => do
    let doc ← RequestM.readDoc
    let source := documentSourceName doc
    let fingerprint := params.package.fingerprint
    let package ← match retainedWidgetPackage snap.env roots fingerprint with
      | .ok package => pure package
      | .error error => throwThe RequestError error
    let bytes ← match Vir.GeneratePackage.emitPackage package.closure package.manifest with
      | .ok bytes => pure bytes
      | .error message => throwThe RequestError { code := .invalidParams, message }
    return {
      source, roots := roots.map toString, revision := fingerprint
      byteSize := toString bytes.size, dataBase64 := base64Encode bytes, report := package.report
    }

end Lean.Vir.Infoview
