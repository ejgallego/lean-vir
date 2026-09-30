/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Resources.Build
import Vir.Resources.Pack
import Vir.Resources.Sha256
import Vir.GeneratePackage.PackageFormat
import Lean.Data.Json.Printer
import Lean.Data.Json.FromToJson

/-! Internal, recipe-independent compiled program result.

The resource container is reused as a bounded cache transport, not as a second
public program contract. Selection is always one marked module. Roles, support
files and runtime acquisition belong to the adapters above this result.
-/
public section
namespace Vir.Resources.Program
open Lean System Vir.GeneratePackage

private def require (condition : Bool) (detail : String) : Except String Unit :=
  unless condition do throw detail

private def word (bytes : ByteArray) (offset count : Nat) : Except String Nat := do
  require (offset + count ≤ bytes.size) "truncated package word"
  return (List.range count).foldl (fun n i => n + bytes[offset + i]!.toNat * 256^i) 0

/-- Extract the bounded, checksummed interface JSON using the shared format constants.
This is not a decoder for the declarations or other executable IR sections. -/
private def readInterfaceManifest (bytes : ByteArray) : Except String Json := do
  let magicSize ← word bytes 0 4
  require (magicSize == packageMagic.utf8ByteSize &&
    bytes.extract 4 (4 + magicSize) == packageMagic.toUTF8) "invalid package magic"
  let header := 4 + magicSize
  require ((← word bytes header 4) == currentPackageFormatVersion) "invalid package version"
  let count ← word bytes (header + 8) 4
  require (count > 0 && count ≤ 64 && header + 12 + count * 12 ≤ bytes.size)
    "invalid package section directory"
  let mut section? := none
  for i in [:count] do
    let entry := header + 12 + i * 12
    let kind ← word bytes entry 4
    let offset ← word bytes (entry + 4) 4
    let length ← word bytes (entry + 8) 4
    require (offset ≥ header + 12 + count * 12 && offset + length ≤ bytes.size)
      "invalid package section bounds"
    if kind == packageSectionInterfaceManifest then
      require section?.isNone "duplicate interface section"
      section? := some (offset, length)
  let some (offset, length) := section? | throw "missing interface section"
  require (length ≥ 12) "truncated interface section"
  let size ← word bytes (offset + 8) 4
  require (size + 12 == length && size ≤ maxDescriptorBytes) "invalid interface length"
  let json := bytes.extract (offset + 12) (offset + length)
  let checksum := json.foldl (fun (h : UInt64) b =>
    (h ^^^ b.toUInt64) * 1099511628211) 14695981039346656037
  require ((← word bytes offset 8) == checksum.toNat) "invalid interface checksum"
  Build.parseJson json

structure Member where
  moduleName : String
  role : String
  file : File
  deriving Inhabited

/-- Validated container plus canonical build-adapter inventory, member ownership and
compiler/interface identity. Not complete IR decoding, ABI type validation or
execution admission; those remain at the browser/runtime boundaries. -/
structure Checked where
  private mk ::
  bundle : Bundle
  members : Array Member
  exports : Array String

/-- Only call after complete container validation. Private so an ordinary Bundle
cannot bypass integrity checks through the public in-memory entry point. -/
private def checkValidatedBundle (bundle : Bundle) (root : String) : Except String Checked := do
  require (bundle.descriptor.kind == .program &&
    bundle.descriptor.logicalId == "vir-compiled/" ++ root &&
    bundle.descriptor.compatibility == Build.currentCompatibility &&
    bundle.descriptor.exports.isEmpty &&
    bundle.descriptor.fileEntries == #[{ role := "programSet", path := "program.irpkg-set.json" }])
    "invalid compiled program identity"
  let some set := bundle.file? "program.irpkg-set.json" | throw "missing package set"
  let json ← Build.parseJson set.bytes
  Build.exactKeys json #["format", "version", "packages"]
  require ((← json.getObjValAs? String "format") == packageSetFormat &&
    (← json.getObjValAs? Nat "version") == currentPackageSetVersion) "invalid package set format"
  let entries ← (← json.getObjVal? "packages").getArr?
  require (!entries.isEmpty && entries.size + 2 == bundle.files.size) "invalid program inventory"
  require ((bundle.file? "report.md").isSome) "missing program report"
  let mut members : Array Member := #[]
  let mut exports : Array String := #[]
  for i in [:entries.size] do
    let entry := entries[i]!
    Build.exactKeys entry #["module", "role", "path", "byteLength", "sha256"]
    let moduleName ← entry.getObjValAs? String "module"
    let isRoot := i + 1 == entries.size
    let role := if isRoot then "root" else "dependency"
    let path := if isRoot then "program.irpkg" else s!"parts/{i}.irpkg"
    require (!moduleName.isEmpty && !moduleName.toName.isAnonymous &&
      moduleName.toName.toString == moduleName && !members.any (·.moduleName == moduleName) &&
      (!isRoot || moduleName == root)) "invalid member ownership"
    require ((← entry.getObjValAs? String "role") == role &&
      (← entry.getObjValAs? String "path") == path) "invalid member role/path"
    let some file := bundle.file? path | throw s!"missing package member {path}"
    let some info := bundle.descriptor.files.find? (·.path == path)
      | throw s!"missing validated package member {path}"
    -- Container validation already binds this inventory to the exact payload.
    -- Bind the inner set to it without hashing the same member bytes again.
    require ((← entry.getObjValAs? Nat "byteLength") == info.byteLength &&
      (← entry.getObjValAs? String "sha256") == info.sha256) "invalid member identity"
    let interface ← readInterfaceManifest file.bytes
    let metadata ← interface.getObjVal? "metadata"
    require ((← interface.getObjValAs? Nat "version") == currentInterfaceManifestVersion &&
      (← metadata.getObjValAs? Nat "manifestVersion") == currentInterfaceManifestVersion &&
      (← metadata.getObjValAs? Nat "packageFormatVersion") == currentPackageFormatVersion &&
      (← metadata.getObjValAs? String "leanGithash") ==
        bundle.descriptor.compatibility.leanRevision) "interface compatibility mismatch"
    let owner ← metadata.getObjVal? "packageSetMember"
    require ((← owner.getObjValAs? String "module") == moduleName &&
      (← owner.getObjValAs? String "role") == role) "interface ownership mismatch"
    if isRoot then
      exports ← (← (← interface.getObjVal? "exports").getArr?).mapM
        (fun item => item.getObjValAs? String "entry")
    members := members.push { moduleName, role, file }
  return { bundle, members, exports }

/-- Validate an ordinary in-memory bundle before checking its compiled-program
inventory/metadata. No prior Pack.decode, trusted constructor or caller check is
required. A successful result does not certify arbitrary executable IR. -/
def check (bundle : Bundle) (root : String) : Except String Checked := do
  bundle.validate |>.mapError (fun e => s!"{e.code}: {reprStr e}")
  checkValidatedBundle bundle root

/-- Bounded regular-file read and canonical pack decoding, then the same program
metadata checks as `check`. Pack.decode already validates the full container;
the private continuation avoids repeating payload hashing here. -/
def read (path : FilePath) (root : String) : IO Checked := do
  let bytes ← Build.readInput path Build.packLimit "PROGRAM_LIMIT"
  let bundle ← IO.ofExcept <| (Pack.decode bytes).mapError (fun e => s!"{e.code}: {reprStr e}")
  IO.ofExcept <| (checkValidatedBundle bundle root).mapError ("INVALID_COMPILED_PROGRAM: " ++ ·)

def fileInfo (file : File) (mediaType : String) : FileInfo :=
  { path := file.path, mediaType, byteLength := file.bytes.size, sha256 := sha256 file.bytes }

/-- Adapt names only; all package member bytes stay identical. -/
def looseFiles (program : Checked) (rootPath shardDir reportPath : String) : Array File := Id.run do
  let members := program.members.mapIdx fun i member =>
    ({ member.file with path := if member.role == "root" then rootPath else s!"{shardDir}/{i}.irpkg" }, member)
  -- Keep the canonical generator's field order and newline convention.
  let quoted (s : String) := (Json.str s).compress
  let entries := members.map fun (file, member) =>
    "{\"module\":" ++ quoted member.moduleName ++ ",\"role\":" ++ quoted member.role ++
    ",\"path\":" ++ quoted file.path ++ ",\"byteLength\":" ++ toString file.bytes.size ++
    ",\"sha256\":" ++ quoted (sha256 file.bytes) ++ "}"
  let descriptor := "{\"format\":" ++ quoted packageSetFormat ++
    ",\"version\":" ++ toString currentPackageSetVersion ++ ",\"packages\":[" ++
    String.intercalate "," entries.toList ++ "]}\n"
  return (members.map (·.1)).push { path := "descriptor", bytes := descriptor.toUTF8 }
    |>.push { path := reportPath, bytes := (program.bundle.file? "report.md").get!.bytes }

end Vir.Resources.Program
