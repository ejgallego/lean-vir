/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Widget
import Lean.DeclarationRange
import Init.System.Uri
import Vir.GeneratePackage
import Vir.Infoview.Surface

namespace Lean.Vir.Infoview

open Lean Server

structure AssetRequest where
  path : String
  deriving Server.RpcEncodable

structure AssetInfo where
  path : String
  mime : String
  byteSize : String
  modified : String
  revision : String
  deriving Server.RpcEncodable

structure AssetResponse extends AssetInfo where
  dataBase64 : String
  deriving Server.RpcEncodable

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

def base64Char (n : Nat) : Char :=
  if n < 26 then
    Char.ofNat ('A'.toNat + n)
  else if n < 52 then
    Char.ofNat ('a'.toNat + (n - 26))
  else if n < 62 then
    Char.ofNat ('0'.toNat + (n - 52))
  else if n == 62 then
    '+'
  else
    '/'

def base64Encode (bytes : ByteArray) : String := Id.run do
  let mut out := ""
  let mut i := 0
  while i + 2 < bytes.size do
    let b0 := bytes[i]!.toNat
    let b1 := bytes[i + 1]!.toNat
    let b2 := bytes[i + 2]!.toNat
    out := out.push (base64Char (b0 / 4))
    out := out.push (base64Char (((b0 % 4) * 16) + (b1 / 16)))
    out := out.push (base64Char (((b1 % 16) * 4) + (b2 / 64)))
    out := out.push (base64Char (b2 % 64))
    i := i + 3
  if i < bytes.size then
    let b0 := bytes[i]!.toNat
    out := out.push (base64Char (b0 / 4))
    if i + 1 < bytes.size then
      let b1 := bytes[i + 1]!.toNat
      out := out.push (base64Char (((b0 % 4) * 16) + (b1 / 16)))
      out := out.push (base64Char ((b1 % 16) * 4))
      out := out.push '='
    else
      out := out.push (base64Char ((b0 % 4) * 16))
      out := out.push '='
      out := out.push '='
  return out

def validateAssetPath (path : String) : Except String System.FilePath := do
  if path.isEmpty then
    throw "asset path must be non-empty"
  let filePath := System.FilePath.mk path
  if filePath.isAbsolute then
    throw "asset path must be relative"
  let components := filePath.components
  if components.any (fun component => component.isEmpty || component == "." || component == "..") then
    throw "asset path must not contain empty, '.', or '..' components"
  return filePath.normalize

def mimeForPath (path : System.FilePath) : String :=
  match path.extension with
  | some "wasm" => "application/wasm"
  | some "irpkg" => "application/octet-stream"
  | some "js" => "text/javascript"
  | _ => "application/octet-stream"

def systemTimeToken (time : IO.FS.SystemTime) : String :=
  s!"{time.sec}.{time.nsec}"

def metadataRevision (metadata : IO.FS.Metadata) : String :=
  s!"{systemTimeToken metadata.modified}:{metadata.byteSize}"

partial def findLakeRoot? (dir : System.FilePath) : IO (Option System.FilePath) := do
  if (← System.FilePath.pathExists (dir / "lakefile.lean")) ||
      (← System.FilePath.pathExists (dir / "lakefile.toml")) then
    return some dir
  else
    match dir.parent with
    | none => return none
    | some parent =>
        if parent.toString == dir.toString then
          return none
        else
          findLakeRoot? parent

def assetRoot : RequestM System.FilePath := do
  let doc ← RequestM.readDoc
  let sourceRoot? ← do
    match System.Uri.fileUriToPath? doc.meta.uri with
    | none => pure none
    | some path =>
        match path.parent with
        | none => pure none
        | some dir => findLakeRoot? dir
  match sourceRoot? with
  | some root => pure root
  | none => IO.currentDir

structure ResolvedAsset where
  requestPath : String
  relPath : System.FilePath
  path : System.FilePath

def resolveAssetPath (requestPath : String) : RequestM ResolvedAsset := do
  let relPath ←
    match validateAssetPath requestPath with
    | .ok path => pure path
    | .error message =>
        throwThe RequestError { code := .invalidParams, message := s!"Invalid VIR asset path: {message}" }
  let root ← assetRoot
  return {
    requestPath
    relPath
    path := root / relPath
  }

def assetInfo (asset : ResolvedAsset) : IO AssetInfo := do
  let metadata ← System.FilePath.metadata asset.path
  return {
    path := asset.requestPath
    mime := mimeForPath asset.relPath
    byteSize := toString metadata.byteSize
    modified := systemTimeToken metadata.modified
    revision := metadataRevision metadata
  }

@[server_rpc_method]
def statAsset (params : AssetRequest) : RequestM (RequestTask AssetInfo) := do
  RequestM.asTask do
    assetInfo (← resolveAssetPath params.path)

@[server_rpc_method]
def readAsset (params : AssetRequest) : RequestM (RequestTask AssetResponse) := do
  RequestM.asTask do
    let asset ← resolveAssetPath params.path
    let info ← assetInfo asset
    let bytes ← IO.FS.readBinFile asset.path
    return { info with
      dataBase64 := base64Encode bytes
    }

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

/--
Props for the minimal VIR infoview shell.

The `.irpkg` entry must have signature `String -> Surface -> DomM Bool`; the
shell passes a fresh DOM selector for its nested mount element and a
JavaScript-built surface structure from the real infoview panel props.
If `unmountEntry` is set, it must have signature `String -> DomM Bool` and is
called when the shell unmounts its nested element while keeping the runtime
service alive for later remounts.
-/
structure WidgetProps where
  runtimeUrl : String := ""
  wasmUrl : String := ""
  packageUrl : String := ""
  wasmPath : String := ""
  packagePath : String := ""
  irPackage : Option IRPackage := none
  entry : String
  unmountEntry : String := ""
  mountId : String := "vir-infoview-widget"
  autoReloadMs : Nat := 0
  setupHint : String := ""
  deriving Server.RpcEncodable

@[widget_module]
def widget : Widget.Module where
  javascript := include_str ".." / "web" / "src" / "generated" / "vir-infoview-widget.js"

end Lean.Vir.Infoview
