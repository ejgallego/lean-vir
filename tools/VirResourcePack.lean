/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Vir.Resources.Pack
import Vir.Resources.Sha256

/-! Native build tool, deliberately below all resource carriers. Paths are build
inputs only: neither they nor transport URLs become bundle metadata. -/

namespace Vir.ResourcePack
open System Resources

private def packLimit : Nat := maxPayloadBytes + maxDescriptorBytes + 12

private def fail (code detail : String) : IO α :=
  throw <| IO.userError s!"{code}: {detail}"

private def metadata? (path : FilePath) : IO (Option IO.FS.Metadata) := do
  try return some (← path.symlinkMetadata)
  catch e => match e with
    | .noFileOrDirectory .. => return none
    | _ => throw e

/-- Refuse link traversal in producer-managed paths. This guards accidental
aliases, not concurrent hostile replacement of ancestor directories. -/
private partial def checkParents (path : FilePath) : IO Unit := do
  if let some parent := path.parent then
    if parent != path then checkParents parent
  if let some m ← metadata? path then
    unless m.type == .dir do fail "UNSAFE_RESOURCE_DIRECTORY" path.toString

private def checkFile (path : FilePath) : IO Unit := do
  checkParents (path.parent.getD ".")
  if let some m ← metadata? path then
    unless m.type == .file do fail "UNSAFE_RESOURCE_FILE" path.toString

/-- Bound the read itself, not just a racy size observation before readBinFile.
The path must be a regular file with no symlink ancestors. -/
private def readInput (path : FilePath) (limit : Nat) (code : String) : IO ByteArray := do
  checkFile path
  let some m ← metadata? path | fail "MISSING_RESOURCE_FILE" path.toString
  if m.byteSize.toNat > limit then fail code path.toString
  let handle ← IO.FS.Handle.mk path .read
  let mut bytes := ByteArray.empty
  repeat
    let chunk ← handle.read (min 65536 (limit + 1 - bytes.size)).toUSize
    if chunk.isEmpty then return bytes
    bytes := bytes ++ chunk
    if bytes.size > limit then fail code path.toString

private def readPack (path : FilePath) : IO ByteArray :=
  readInput path packLimit "PACK_LIMIT"

private def verifyIdentity (expected : String) (bundle : Bundle) : IO Unit := do
  unless bundle.contentId == expected do
    fail "CONTENT_ID_MISMATCH" s!"expected {expected}, got {bundle.contentId}"
  unless bundle.descriptor.compatibility.leanBuildId == Lean.githash do
    fail "LEAN_BUILD_MISMATCH"
      s!"expected {Lean.githash}, got {bundle.descriptor.compatibility.leanBuildId}"

private def verify (expected : String) (bytes : ByteArray) : IO Unit := do
  match Pack.decode bytes with
  | .ok bundle => verifyIdentity expected bundle
  | .error e => fail e.code (reprStr e)

/-- A corrupt cache is only a rejected candidate, never a new expected identity.
Path/permission errors remain errors rather than triggering network fallback. -/
private def candidate (expected : String) (path : FilePath) : IO (Option ByteArray) := do
  checkFile path
  unless (← metadata? path).isSome do return none
  let m ← path.metadata
  if m.byteSize.toNat > packLimit then return none
  let bytes ← readPack path
  match Pack.decode bytes with
  | .error _ => return none
  | .ok bundle =>
    if bundle.contentId != expected then return none
    verifyIdentity expected bundle
    return some bytes

/-- A fresh sibling directory gives each producer its own file and keeps rename
on the destination filesystem. Only this invocation's temporary paths are removed. -/
private def withSibling (destination : FilePath) (f : FilePath → IO α) : IO α := do
  checkFile destination
  let parent := destination.parent.getD "."
  IO.FS.createDirAll parent
  let mut directory? := none
  for _ in [:8] do
    let nonce := sha256 (← IO.getRandomBytes 32)
    let directory := parent / s!".vir-resource-{nonce}"
    try
      IO.FS.createDir directory
      directory? := some directory
      break
    catch e => match e with
      | .alreadyExists .. => pure ()
      | _ => throw e
  let some directory := directory? | fail "TEMPORARY_PATH_COLLISION" parent.toString
  let temporary := directory / "pack"
  try f temporary
  finally
    if (← metadata? temporary).isSome then IO.FS.removeFile temporary
    IO.FS.removeDir directory

private def install (expected : String) (bytes : ByteArray) (destination : FilePath) : IO Unit := do
  if (← candidate expected destination).isSome then return
  withSibling destination fun temporary => do
    IO.FS.writeBinFile temporary bytes
    -- No truncation or write through a potentially cached/hardlinked destination.
    checkFile destination
    IO.FS.rename temporary destination

/-- Materialize a canonical descriptor with actual regular-file payloads.
The descriptor determines both the allowed paths and their byte budgets. -/
private def pack (descriptorPath root destination : FilePath) : IO Unit := do
  checkFile destination
  checkParents root
  unless (← metadata? root).isSome do
    fail "MISSING_RESOURCE_DIRECTORY" root.toString
  let descriptorBytes ← readInput descriptorPath maxDescriptorBytes "DESCRIPTOR_LIMIT"
  let descriptor ← match Pack.decodeDescriptor descriptorBytes with
    | .ok value => pure value
    | .error e => fail e.code (reprStr e)
  unless descriptor.compatibility.leanBuildId == Lean.githash do
    fail "LEAN_BUILD_MISMATCH"
      s!"expected {Lean.githash}, got {descriptor.compatibility.leanBuildId}"
  let mut files := #[]
  for info in descriptor.files do
    let path := root / info.path
    let bytes ← readInput path info.byteLength "LENGTH_MISMATCH"
    files := files.push { path := info.path, bytes : File }
  let bundle := { contentId := descriptor.contentId, descriptor, files : Bundle }
  let bytes ← match Pack.encode bundle with
    | .ok value => pure value
    | .error e => fail e.code (reprStr e)
  install bundle.contentId bytes destination

private def acquire (expected source : String) (cache stage : FilePath) (offline : Bool) : IO Unit := do
  unless expected.length == 64 && expected.toList.all ("0123456789abcdef".contains ·) do
    fail "INVALID_CONTENT_ID" expected
  -- Check both destinations before doing any acquisition or committing a cache.
  checkFile cache
  checkFile stage
  let bytes ← match ← candidate expected cache with
    | some bytes => pure bytes
    | none => match ← candidate expected stage with
      | some bytes => pure bytes
      | none =>
        if source == "-" || (offline && source.startsWith "https://") then
          fail "RESOURCE_OFFLINE_MISS" s!"required bundle {expected}; cache {cache}"
        let bytes ← if source.startsWith "https://" then
          withSibling cache fun temporary => do
            let result ← IO.Process.output {
              cmd := "curl"
              -- -q ignores per-user curl config (including credentials). Only
              -- HTTPS redirects are permitted; no gh/token/Node/source-build path.
              args := #["-q", "--fail", "--silent", "--show-error", "--location",
                "--proto", "=https", "--proto-redir", "=https",
                "--connect-timeout", "20", "--max-time", "120",
                "--max-filesize", toString packLimit, "--output", temporary.toString,
                "--url", source] }
            unless result.exitCode == 0 do
              fail "RESOURCE_DOWNLOAD_FAILED" s!"bundle {expected}: {result.stderr.trimAscii}"
            readPack temporary
        else
          if (source.splitOn "://").length > 1 then
            fail "UNSUPPORTED_RESOURCE_TRANSPORT" source
          readPack source
        verify expected bytes
        pure bytes
  install expected bytes cache
  install expected bytes stage

def usage : String :=
  "usage: vir_resource_pack pack DESCRIPTOR ROOT OUT\n" ++
  "       vir_resource_pack acquire CONTENT_ID SOURCE CACHE STAGE [--offline]\n" ++
  "SOURCE is a local pack, anonymous HTTPS URL, or '-' (available bytes only).\n" ++
  "Transport never overrides CONTENT_ID or the tool's exact Lean build identity."

end Vir.ResourcePack

def main (args : List String) : IO Unit := do
  match args with
  | ["pack", descriptor, root, out] =>
    Vir.ResourcePack.pack descriptor root out
  | ["acquire", expected, source, cache, stage] =>
    Vir.ResourcePack.acquire expected source cache stage false
  | ["acquire", expected, source, cache, stage, "--offline"] =>
    Vir.ResourcePack.acquire expected source cache stage true
  | _ => throw <| IO.userError Vir.ResourcePack.usage
