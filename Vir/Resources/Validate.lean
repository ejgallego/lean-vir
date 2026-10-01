/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Resources.Types
import Vir.Hash
import Init.Data.Array.QSort
import Std.Data.HashMap.Basic

public section
namespace Vir.Resources

/-- v1 limits apply before parsing/allocating a pack and before hashing payloads. -/
def maxFiles : Nat := 4096
def maxPayloadBytes : Nat := 512 * 1024 * 1024
def maxDescriptorBytes : Nat := 4 * 1024 * 1024
def maxMetadataBytes : Nat := 4096

private def hexDigit (n : Nat) : Char :=
  Char.ofNat (if n < 10 then 48 + n else 87 + n)

/-- v1 JSON string spelling; unlike general JSON encoders, every control uses `\u00xx`. -/
private def quote (s : String) : String := Id.run do
  let mut out := "\""
  for c in s.toList do
    out := if c == '"' then out ++ "\\\""
      else if c == '\\' then out ++ "\\\\"
      else if c.toNat < 32 then
        out ++ "\\u00" |>.push (hexDigit (c.toNat / 16)) |>.push (hexDigit (c.toNat % 16))
      else out.push c
  return out ++ "\""

private def arrayJson (items : Array String) : String :=
  "[" ++ String.intercalate "," items.toList ++ "]"

private def objectJson (fields : List (String × String)) : String :=
  "{" ++ String.intercalate "," (fields.map fun (key, value) => quote key ++ ":" ++ value) ++ "}"

private def compatibilityJson (c : Compatibility) : String := objectJson [
  ("leanRevision", quote c.leanRevision),
  ("virVersion", toString c.virVersion)]

/-- Complete canonical descriptor. Fixed ASCII object keys are written in sorted order;
Unicode values are preserved without normalization. Call `validateDescriptor` on input. -/
def encodeDescriptor (d : Descriptor) : ByteArray := (objectJson [
  ("compatibility", compatibilityJson d.compatibility),
  ("exports", arrayJson <| (d.exports.qsort (·.role < ·.role)).map fun e => objectJson [
    ("declaration", quote e.declaration), ("interfaceId", quote e.interfaceId), ("role", quote e.role)]),
  ("fileEntries", arrayJson <| (d.fileEntries.qsort (·.role < ·.role)).map fun e => objectJson [
    ("path", quote e.path), ("role", quote e.role)]),
  ("files", arrayJson <| (d.files.qsort (·.path < ·.path)).map fun f => objectJson [
    ("byteLength", toString f.byteLength), ("mediaType", quote f.mediaType),
    ("path", quote f.path), ("sha256", quote f.sha256)]),
  ("kind", quote <| match d.kind with | .runtime => "runtime" | .program => "program"),
  ("logicalId", quote d.logicalId),
  ("schemaVersion", toString d.schemaVersion)]).toUTF8

def Descriptor.contentId (d : Descriptor) : String :=
  sha256 ("vir-resource-bundle-v1\n".toUTF8 ++ encodeDescriptor d)

private def pathChar (c : Char) : Bool :=
  ('a' ≤ c && c ≤ 'z') || ('A' ≤ c && c ≤ 'Z') || ('0' ≤ c && c ≤ '9') ||
  c == '.' || c == '_' || c == '-'

private def deviceComponent (s : String) : Bool :=
  let stem := (s.toLower.splitOn ".").head!
  ["con", "prn", "aux", "nul"].contains stem ||
    ((stem.startsWith "com" || stem.startsWith "lpt") && stem.length == 4 &&
      ('1' ≤ stem.toList[3]! && stem.toList[3]! ≤ '9'))

/-- No normalization: unsafe spellings are rejected, not reinterpreted. -/
def validPath (path : String) : Bool :=
  path.utf8ByteSize ≤ maxMetadataBytes &&
  (path.toLower.splitOn "/").head! != "bundle.json" &&
  (path.splitOn "/").all fun part =>
    !part.isEmpty && part != "." && part != ".." && !part.endsWith "." &&
    part.toList.all pathChar && !deviceComponent part

private def validHash (s : String) : Bool :=
  s.utf8ByteSize == 64 && s.toList.all ("0123456789abcdef".contains ·)

private def metadata (id field value : String) : Except ResourceError Unit := do
  unless !value.isEmpty && value.utf8ByteSize ≤ maxMetadataBytes do
    throw { code := "INVALID_METADATA", logicalId := id, path := some field }

private def paths (id : String) (names : Array String) : Except ResourceError Unit := do
  if names.size > maxFiles then throw { code := "TOO_MANY_FILES", logicalId := id }
  let mut previous : Option String := none
  for name in names.qsort (fun a b => a.toLower < b.toLower) do
    unless validPath name do
      throw { code := "INVALID_PATH", logicalId := id, path := some name }
    let folded := name.toLower
    if let some p := previous then
      if p == folded then
        throw { code := "DUPLICATE_PATH", logicalId := id, path := some name }
    previous := some folded
  -- File/directory prefix conflicts also cannot be materialized portably.
  let folded := names.map String.toLower
  for name in names do
    let parts := name.toLower.splitOn "/"
    let mut parentPath := ""
    for part in parts.dropLast do
      parentPath := if parentPath.isEmpty then part else parentPath ++ "/" ++ part
      if folded.contains parentPath then
        throw { code := "PATH_PREFIX_CONFLICT", logicalId := id, path := some name }
  -- Directory spelling is part of the portable inventory, not just leaf spelling.
  -- Keep the original spelling; merging Assets/ and assets/ is not normalization.
  let mut directories : Std.HashMap String String := {}
  for name in names do
    let mut parentPath := ""
    for part in (name.splitOn "/").dropLast do
      parentPath := if parentPath.isEmpty then part else parentPath ++ "/" ++ part
      let key := parentPath.toLower
      if let some spelling := directories[key]? then
        unless spelling == parentPath do
          throw { code := "DIRECTORY_CASE_CONFLICT", logicalId := id, path := some name }
      else directories := directories.insert key parentPath

private def uniqueRoles (id : String) (roles : Array String) : Except ResourceError Unit := do
  if roles.size > maxFiles then throw { code := "TOO_MANY_ROLES", logicalId := id }
  let mut previous : Option String := none
  for role in roles.qsort (· < ·) do
    metadata id "role" role
    if previous == some role then
      throw { code := "DUPLICATE_ROLE", logicalId := id, role := some role }
    previous := some role

def validateDescriptor (d : Descriptor) : Except ResourceError Unit := do
  let id := d.logicalId
  unless d.schemaVersion == 1 do
    throw {
      code := "SCHEMA_VERSION", logicalId := id, expected := some "1",
      actual := some (toString d.schemaVersion) }
  metadata id "logicalId" id
  metadata id "leanRevision" d.compatibility.leanRevision
  unless 0 < d.compatibility.virVersion && d.compatibility.virVersion ≤ 9007199254740991 do
    throw { code := "INVALID_VERSION", logicalId := id, path := some "virVersion" }
  paths id (d.files.map (·.path))
  let mut total := 0
  for f in d.files do
    metadata id "mediaType" f.mediaType
    unless validHash f.sha256 do
      throw { code := "INVALID_HASH", logicalId := id, path := some f.path }
    total := total + f.byteLength
    if total > maxPayloadBytes then
      throw { code := "PAYLOAD_LIMIT", logicalId := id, path := some f.path }
  uniqueRoles id (d.fileEntries.map (·.role))
  uniqueRoles id (d.exports.map (·.role))
  for e in d.fileEntries do
    unless d.files.any (·.path == e.path) do
      throw { code := "ENTRY_NOT_FOUND", logicalId := id, role := some e.role, path := some e.path }
  let required := match d.kind with
    | .runtime => #["runtimeModule", "wasm"]
    | .program => #["programSet"]
  for role in required do
    unless d.fileEntries.any (·.role == role) do
      throw { code := "MISSING_ROLE", logicalId := id, role := some role }
  if d.kind == .runtime && !d.exports.isEmpty then
    throw { code := "RUNTIME_EXPORTS", logicalId := id }
  for e in d.exports do
    metadata id "declaration" e.declaration
    metadata id "interfaceId" e.interfaceId
  if (encodeDescriptor d).size > maxDescriptorBytes then
    throw { code := "DESCRIPTOR_LIMIT", logicalId := id }

/-- Checks complete inventory, byte integrity and descriptor identity. Program-set
semantics and actual declaration exports are additionally checked by the producer/loader. -/
def Bundle.validate (bundle : Bundle) : Except ResourceError Unit := do
  let d := bundle.descriptor
  validateDescriptor d
  paths d.logicalId (bundle.files.map (·.path))
  let declared := d.files.qsort (·.path < ·.path)
  let actual := bundle.files.qsort (·.path < ·.path)
  unless declared.map (·.path) == actual.map (·.path) do
    throw { code := "INVENTORY_MISMATCH", logicalId := d.logicalId }
  for info in declared, file in actual do
    unless info.byteLength == file.bytes.size do
      throw {
        code := "LENGTH_MISMATCH", logicalId := d.logicalId, path := some info.path,
        expected := some (toString info.byteLength), actual := some (toString file.bytes.size) }
    let digest := sha256 file.bytes
    unless info.sha256 == digest do
      throw {
        code := "HASH_MISMATCH", logicalId := d.logicalId, path := some info.path,
        expected := some info.sha256, actual := some digest }
  let expected := d.contentId
  unless bundle.contentId == expected do
    throw {
      code := "CONTENT_ID_MISMATCH", logicalId := d.logicalId,
      expected := some expected, actual := some bundle.contentId }

def ResourceSet.validate (resources : ResourceSet) : Except ResourceError Unit := do
  resources.runtime.validate
  let runtime := resources.runtime.descriptor
  unless runtime.kind == .runtime do
    throw { code := "EXPECTED_RUNTIME", logicalId := runtime.logicalId }
  let mut identities := #[(runtime.logicalId, resources.runtime.contentId)]
  for program in resources.programs do
    program.validate
    let d := program.descriptor
    unless d.kind == .program do
      throw { code := "EXPECTED_PROGRAM", logicalId := d.logicalId }
    unless d.compatibility == runtime.compatibility do
      throw {
        code := "INCOMPATIBLE", logicalId := d.logicalId,
        expected := some (compatibilityJson runtime.compatibility),
        actual := some (compatibilityJson d.compatibility) }
    if let some (_, previous) := identities.find? (·.1 == d.logicalId) then
      unless previous == program.contentId do
        throw {
          code := "LOGICAL_ID_CONFLICT", logicalId := d.logicalId,
          expected := some previous, actual := some program.contentId }
    else identities := identities.push (d.logicalId, program.contentId)

/-- Validate before publication, then emit identical logical/content identities once. -/
def ResourceSet.bundles (resources : ResourceSet) : Except ResourceError (Array Bundle) := do
  resources.validate
  return resources.programs.foldl (init := #[resources.runtime]) fun result bundle =>
    if result.any (·.descriptor.logicalId == bundle.descriptor.logicalId) then result
    else result.push bundle

end Vir.Resources
