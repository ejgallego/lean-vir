/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Resources.Validate
import Lean.Data.Json.Parser
import Lean.Data.Json.FromToJson.Basic

/-! Internal v1 container: eight magic/version bytes, a little-endian u32
descriptor length, canonical descriptor bytes, then payloads in descriptor path
order. Each payload's length comes from the descriptor, not a second inventory.
No archive paths or links are materialized by decoding. -/

namespace Vir.Resources.Pack
open Lean

private def magic : ByteArray := ⟨#[86, 73, 82, 82, 69, 83, 0, 1]⟩

private def parseCompatibility (j : Json) : Except String Compatibility := do
  return {
    leanRevision := ← j.getObjValAs? String "leanRevision"
    virVersion := ← j.getObjValAs? Nat "virVersion" }

private def parseFileInfo (j : Json) : Except String FileInfo := do
  return {
    path := ← j.getObjValAs? String "path"
    mediaType := ← j.getObjValAs? String "mediaType"
    byteLength := ← j.getObjValAs? Nat "byteLength"
    sha256 := ← j.getObjValAs? String "sha256" }

private def parseEntry (j : Json) : Except String FileEntry := do
  return { role := ← j.getObjValAs? String "role", path := ← j.getObjValAs? String "path" }

private def parseExport (j : Json) : Except String ProgramExport := do
  return {
    role := ← j.getObjValAs? String "role"
    declaration := ← j.getObjValAs? String "declaration"
    interfaceId := ← j.getObjValAs? String "interfaceId" }

private def parseDescriptor (j : Json) : Except String Descriptor := do
  let kind ← match ← j.getObjValAs? String "kind" with
    | "runtime" => pure BundleKind.runtime
    | "program" => pure BundleKind.program
    | _ => throw "kind must be runtime or program"
  return {
    schemaVersion := ← j.getObjValAs? Nat "schemaVersion"
    logicalId := ← j.getObjValAs? String "logicalId"
    kind
    compatibility := ← parseCompatibility (← j.getObjVal? "compatibility")
    files := ← (← (← j.getObjVal? "files").getArr?).mapM parseFileInfo
    fileEntries := ← (← (← j.getObjVal? "fileEntries").getArr?).mapM parseEntry
    exports := ← (← (← j.getObjVal? "exports").getArr?).mapM parseExport }

/-- Bound nesting and numeric work before entering the general JSON parser.
Syntax validation is still its responsibility; quoted content is ignored. -/
private def boundedJson (bytes : ByteArray) : Bool := Id.run do
  let mut depth := 0
  let mut quoted := false
  let mut escaped := false
  let mut digits := 0
  for b in bytes do
    -- Decimal exponent expansion happens inside Lean's JSON parser, before our
    -- field checks. A short token such as 1e1000000000 can request a huge Nat.
    -- Canonical descriptors never use exponent notation, including e0/E+0.
    if !quoted && digits > 0 && (b == 101 || b == 69) then return false
    -- Do not let a bounded JSON file request construction of an enormous Nat
    -- before field-level bounds run. v1's largest integer has 16 digits.
    if !quoted && 48 ≤ b && b ≤ 57 then
      digits := digits + 1
      if digits > 16 then return false
    else digits := 0
    if quoted then
      if escaped then escaped := false
      else if b == 92 then escaped := true
      else if b == 34 then quoted := false
    else if b == 34 then quoted := true
    else if b == 91 || b == 123 then
      depth := depth + 1
      if depth > 16 then return false
    else if b == 93 || b == 125 then
      if depth == 0 then return false
      depth := depth - 1
  return !quoted && depth == 0

/-- Decode a complete canonical v1 descriptor, including schema and size checks.
Duplicate/unknown keys, alternative number spellings, unsorted inventories and
lossy UTF-8 decoding cannot be accepted. Producers can call this before reading
any payload bytes. -/
public def decodeDescriptor (bytes : ByteArray) : Except ResourceError Descriptor := do
  unless bytes.size ≤ maxDescriptorBytes && boundedJson bytes do
    throw { code := "DESCRIPTOR_LIMIT" }
  let some text := String.fromUTF8? bytes | throw { code := "DESCRIPTOR_UTF8" }
  let d ← (Json.parse text >>= parseDescriptor).mapError fun message =>
    { code := "DESCRIPTOR_JSON", actual := some message : ResourceError }
  validateDescriptor d
  unless encodeDescriptor d == bytes do
    throw { code := "NONCANONICAL_DESCRIPTOR", logicalId := d.logicalId }
  return d

public def encode (bundle : Bundle) : Except ResourceError ByteArray := do
  bundle.validate
  let descriptor := encodeDescriptor bundle.descriptor
  let mut bytes := magic
  for i in [:4] do
    bytes := bytes.push ((descriptor.size >>> (8*i)).toUInt8)
  bytes := bytes ++ descriptor
  for f in bundle.files.qsort (·.path < ·.path) do
    bytes := bytes ++ f.bytes
  return bytes

public def decode (bytes : ByteArray) : Except ResourceError Bundle := do
  unless bytes.size ≤ maxPayloadBytes + maxDescriptorBytes + 12 do
    throw { code := "PACK_LIMIT" }
  unless bytes.size ≥ 12 do throw { code := "TRUNCATED_PACK" }
  unless bytes.extract 0 8 == magic do throw { code := "PACK_VERSION" }
  let mut descriptorLength := 0
  for i in [:4] do
    descriptorLength := descriptorLength ||| (bytes[8+i]!.toNat <<< (8*i))
  if descriptorLength > maxDescriptorBytes then throw { code := "DESCRIPTOR_LIMIT" }
  if 12 + descriptorLength > bytes.size then throw { code := "TRUNCATED_PACK" }
  let descriptor ← decodeDescriptor (bytes.extract 12 (12 + descriptorLength))
  let expectedSize := 12 + descriptorLength + descriptor.files.foldl (fun n f => n + f.byteLength) 0
  if bytes.size < expectedSize then throw { code := "TRUNCATED_PACK", logicalId := descriptor.logicalId }
  if bytes.size > expectedSize then throw { code := "TRAILING_PACK_DATA", logicalId := descriptor.logicalId }
  let mut offset := 12 + descriptorLength
  let mut files := #[]
  for f in descriptor.files do
    files := files.push { path := f.path, bytes := bytes.extract offset (offset + f.byteLength) : File }
    offset := offset + f.byteLength
  let bundle := { contentId := descriptor.contentId, descriptor, files : Bundle }
  bundle.validate
  return bundle

end Vir.Resources.Pack
