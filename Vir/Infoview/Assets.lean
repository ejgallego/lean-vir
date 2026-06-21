/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Widget
import Init.System.Uri

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

end Lean.Vir.Infoview
