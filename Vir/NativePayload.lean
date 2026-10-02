/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import Lean
import Vir.Hash

/-! Native file payload handling shared by the SDK installer and resource tools.

Selection and content policy stay with each caller. Callers supply their own
validator, then receive a `VerifiedPayload`; only that result can be promoted
through this module's common file/directory publication path. -/

public section
namespace Vir.NativePayload
open Lean System

private def fail (code detail : String) : IO α :=
  throw <| IO.userError s!"{code}: {detail}"

public def metadata? (path : FilePath) : IO (Option IO.FS.Metadata) := do
  try return some (← path.symlinkMetadata)
  catch e => match e with
    | .noFileOrDirectory .. => return none
    | _ => throw e

/-! Refuse link traversal in managed paths. This guards accidental aliases,
not concurrent hostile replacement of ancestor directories. -/
public partial def checkParents (path : FilePath) : IO Unit := do
  if let some parent := path.parent then
    if parent != path then checkParents parent
  if let some m ← metadata? path then
    unless m.type == .dir do fail "UNSAFE_RESOURCE_DIRECTORY" path.toString

public def checkDirectory (path : FilePath) : IO Unit := do
  checkParents path
  let some m ← metadata? path | fail "MISSING_RESOURCE_DIRECTORY" path.toString
  unless m.type == .dir do fail "UNSAFE_RESOURCE_DIRECTORY" path.toString

public def checkFile (path : FilePath) : IO Unit := do
  checkParents (path.parent.getD ".")
  if let some m ← metadata? path then
    unless m.type == .file do fail "UNSAFE_RESOURCE_FILE" path.toString

/-! Check existing ancestors before creation, then check the resulting path.
Creating first can traverse a link and mutate an unmanaged directory even when
the later check rejects the destination. -/
private def createManagedParents (path : FilePath) : IO Unit := do
  checkParents path
  IO.FS.createDirAll path
  checkParents path

/-! Read-only inputs may use workspace/file aliases. The resolved target must be
a regular file. Managed destinations, unlike inputs, retain checkFile/checkParents
so installation cannot mutate an accidental output alias. Bound the read itself,
not just the initial size observation. -/
public def regularInput (path : FilePath) : IO IO.FS.Metadata := do
  let m ← try path.metadata catch e => match e with
    | .noFileOrDirectory .. => fail "MISSING_RESOURCE_FILE" path.toString
    | _ => throw e
  unless m.type == .file do fail "UNSAFE_RESOURCE_FILE" path.toString
  return m

public def readInput (path : FilePath) (limit : Nat) (limitCode : String) : IO ByteArray := do
  let m ← regularInput path
  if m.byteSize.toNat > limit then fail limitCode path.toString
  let handle ← IO.FS.Handle.mk path .read
  let mut bytes := ByteArray.empty
  repeat
    let chunk ← handle.read (min 65536 (limit + 1 - bytes.size)).toUSize
    if chunk.isEmpty then return bytes
    bytes := bytes ++ chunk
    if bytes.size > limit then fail limitCode path.toString

public def sha256File (path : FilePath) : IO String := do
  discard <| regularInput path
  let bytes ← IO.FS.readBinFile path
  return Vir.sha256 bytes

-- Temporary names need uniqueness, not a content digest or authentication.
private def temporaryNonce : IO String := do
  return String.intercalate "-" ((← IO.getRandomBytes 16).data.toList.map toString)

/-! Create a private temporary directory beside a destination so subsequent
renames stay on the destination filesystem. -/
public def withSiblingDirectory (nearPath : FilePath) (f : FilePath → IO α) : IO α := do
  let parent := nearPath.parent.getD "."
  createManagedParents parent
  let mut directory? := none
  for _ in [:8] do
    let nonce ← temporaryNonce
    let directory := parent / s!".vir-payload-{nonce}"
    try
      IO.FS.createDir directory
      directory? := some directory
      break
    catch e => match e with
      | .alreadyExists .. => pure ()
      | _ => throw e
  let some directory := directory? | fail "TEMPORARY_PATH_COLLISION" parent.toString
  try f directory
  finally
    if (← metadata? directory).isSome then IO.FS.removeDirAll directory

public def withSibling (destination : FilePath) (f : FilePath → IO α) : IO α := do
  checkFile destination
  withSiblingDirectory destination fun directory => f (directory / "payload")

/-! Write through a fresh sibling and rename. Never truncate or write through a
possibly hardlinked destination; identical bytes are a deliberate no-op. -/
public def atomicInstall (destination : FilePath) (bytes : ByteArray) : IO Unit := do
  checkFile destination
  if let some metadata ← metadata? destination then
    if metadata.byteSize.toNat == bytes.size then
      if (← readInput destination bytes.size "PAYLOAD_LIMIT") == bytes then return
  withSibling destination fun temporary => do
    IO.FS.writeBinFile temporary bytes
    checkFile destination
    IO.FS.rename temporary destination

private inductive PayloadContent where
  | bytes (value : ByteArray)
  | directory (path : FilePath)

public structure VerifiedPayload where
  private mk ::
  private content : PayloadContent

/-! VerifiedPayload records that the caller's validator completed. It does not
itself certify a particular identity, compiler provenance or execution safety. -/

public def verifyBytes (bytes : ByteArray) (validate : ByteArray → IO Unit)
    : IO VerifiedPayload := do
  validate bytes
  return ⟨.bytes bytes⟩

public def verifyDirectory (path : FilePath) (validate : FilePath → IO Unit)
    : IO VerifiedPayload := do
  checkDirectory path
  validate path
  return ⟨.directory path⟩

private def freshBackupPath (destination : FilePath) : IO FilePath := do
  let parent := destination.parent.getD "."
  for _ in [:8] do
    let nonce ← temporaryNonce
    let backup := parent / s!".vir-payload-backup-{nonce}"
    if (← metadata? backup).isNone then return backup
  fail "TEMPORARY_PATH_COLLISION" parent.toString

private def promoteDirectory (source destination : FilePath) : IO Unit := do
  checkDirectory source
  let parent := destination.parent.getD "."
  createManagedParents parent
  if let some metadata ← metadata? destination then
    unless metadata.type == .dir do fail "UNSAFE_RESOURCE_DIRECTORY" destination.toString
    let backup ← freshBackupPath destination
    IO.FS.rename destination backup
    try
      IO.FS.rename source destination
    catch installError =>
      try
        IO.FS.rename backup destination
      catch restoreError =>
        throw <| IO.userError s!"directory promotion failed ({installError}); previous directory remains at {backup} because restore failed ({restoreError})"
      throw installError
    IO.FS.removeDirAll backup
  else
    IO.FS.rename source destination

public def promote (destination : FilePath) (payload : VerifiedPayload) : IO Unit := do
  match payload.content with
  | .bytes bytes => atomicInstall destination bytes
  | .directory path => promoteDirectory path destination

/-! Resource locks admit public HTTPS URLs without embedded credentials.
This pure check is URL admission, not isolation from host curl configuration.
Keep it shared with lock admission; never echo credential-bearing input. -/
public def checkAnonymousHttps (url : String) : Except String Unit := do
  unless url.startsWith "https://" do throw "source must use HTTPS"
  let authority := (url.drop "https://".length).toString.toList.takeWhile
    (fun c => c != '/' && c != '?' && c != '#')
  unless !authority.isEmpty && !url.toList.any (fun c =>
      c.isWhitespace || c.toNat < 33 || c.toNat == 127) do
    throw "HTTPS source must have a host and no whitespace/control characters"
  if authority.contains '@' then throw "anonymous HTTPS source must not contain URL credentials"

end Vir.NativePayload
