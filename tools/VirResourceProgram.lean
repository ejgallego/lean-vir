/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Vir.LeanName
import Vir.Resources.Program
import Vir.Resources.Build
import Vir.Resources.Pack
import Vir.Resources.Sha256

/-! Native, bounded producer for one independently registered marked module.
Lake supplies the shared, verified compiled program result to `build`.
There is no source compilation or artifact-path guessing in this tool. -/

namespace Vir.ResourceProgram
open Lean System Vir.Resources

private def fail (code detail : String) : IO α :=
  throw <| IO.userError s!"{code}: {detail}"

private def fromExcept (code : String) (value : Except String α) : IO α :=
  match value with
  | .ok value => pure value
  | .error detail => fail code detail

private structure SupportInput where
  source : String
  path : String
  mediaType : String

private structure Recipe where
  logicalId : String
  moduleName : Name
  exports : Array ProgramExport
  supportFiles : Array SupportInput

private def parseRecipe (json : Json) : Except String Recipe := do
  match json.getObjVal? "modules" with
  | .ok _ => throw "obsolete `modules` field; use singular `module`"
  | .error _ => pure ()
  Build.exactKeys json #["schemaVersion", "logicalId", "module", "exports", "supportFiles"]
  let version ← json.getObjValAs? Nat "schemaVersion"
  unless version == 1 do throw s!"unsupported schemaVersion {version}; expected 1"
  let logicalId ← json.getObjValAs? String "logicalId"
  unless Build.validMetadata logicalId do
    throw "logicalId must be nonempty and at most 4096 bytes"
  let moduleText ← json.getObjValAs? String "module"
  unless Build.validMetadata moduleText do
    throw "module must be nonempty and at most 4096 bytes"
  let parsedModule ← Vir.parseDottedName moduleText
  unless parsedModule.toString == moduleText do
    throw s!"invalid module `{moduleText}`"
  let exportsJson ← (← json.getObjVal? "exports").getArr?
  unless exportsJson.size ≤ maxFiles do
    throw "exports must contain at most 4096 entries"
  let mut exports := #[]
  for item in exportsJson do
    Build.exactKeys item #["role", "declaration", "interfaceId"]
    let value : ProgramExport := {
      role := ← item.getObjValAs? String "role"
      declaration := ← item.getObjValAs? String "declaration"
      interfaceId := ← item.getObjValAs? String "interfaceId" }
    unless Build.validMetadata value.role && Build.validMetadata value.declaration &&
        Build.validMetadata value.interfaceId do
      throw "export role, declaration and interfaceId must be bounded nonempty strings"
    let name ← Vir.parseDottedName value.declaration
    unless name.toString == value.declaration &&
        !exports.any (·.role == value.role) do
      throw s!"invalid export declaration or duplicate role `{value.role}`"
    exports := exports.push value
  let supportJson ← (← json.getObjVal? "supportFiles").getArr?
  unless supportJson.size ≤ maxFiles do throw "too many support files"
  let mut supportFiles := #[]
  for item in supportJson do
    Build.exactKeys item #["source", "path", "mediaType"]
    let value : SupportInput := {
      source := ← item.getObjValAs? String "source"
      path := ← item.getObjValAs? String "path"
      mediaType := ← item.getObjValAs? String "mediaType" }
    unless validPath value.source && validPath value.path && Build.validMetadata value.mediaType do
      throw s!"invalid support file source/path/mediaType `{value.source}` → `{value.path}`"
    let foldedPath := value.path.toLower
    if foldedPath == "program.irpkg-set.json" || foldedPath == "program.irpkg" ||
        foldedPath.startsWith "parts/" || foldedPath == "parts" then
      throw s!"support destination `{value.path}` conflicts with generated program members"
    unless !supportFiles.any (fun f => f.path.toLower == value.path.toLower) do
      throw s!"duplicate support destination `{value.path}`"
    supportFiles := supportFiles.push value
  return { logicalId, moduleName := parsedModule, exports, supportFiles }

private def readRecipe (path : FilePath) : IO Recipe := do
  let json ← Build.readJson path maxDescriptorBytes
  fromExcept "INVALID_RECIPE" (parseRecipe json)

private def plan (recipePath compatibilityPath root : FilePath) : IO Unit := do
  let recipe ← readRecipe recipePath
  let _ ← Build.compatibility compatibilityPath
  Build.checkDirectory root
  for support in recipe.supportFiles do
    let _ ← Build.checkedSupport root support.source
  let moduleName := recipe.moduleName.toString
  let supportFiles := recipe.supportFiles.map fun support => Json.str support.source
  IO.println (Json.compress <| Json.mkObj [
    ("module", toJson moduleName),
    ("supportFiles", Json.arr supportFiles)])

private def addFile (files : Array File) (infos : Array FileInfo)
    (path mediaType : String) (bytes : ByteArray) : Array File × Array FileInfo :=
  (files.push { path, bytes }, infos.push {
    path, mediaType, byteLength := bytes.size, sha256 := sha256 bytes })

private def build (recipePath compatibilityPath programPath root outputPath : FilePath) : IO Unit := do
  let recipe ← readRecipe recipePath
  let compat ← Build.compatibility compatibilityPath
  Build.checkDirectory root
  let moduleName := recipe.moduleName
  let mut supports : Array (SupportInput × ByteArray) := #[]
  let mut supportTotal := 0
  for support in recipe.supportFiles do
    let path ← Build.checkedSupport root support.source
    let bytes ← Build.readInput path (maxPayloadBytes - supportTotal) "PAYLOAD_LIMIT"
    supportTotal := supportTotal + bytes.size
    supports := supports.push (support, bytes)
  let program ← Program.read programPath moduleName.toString
  unless program.bundle.descriptor.compatibility == compat do
    fail "PROGRAM_COMPATIBILITY_MISMATCH" moduleName.toString
  for requested in recipe.exports do
    unless program.exports.contains requested.declaration do
      fail "MISSING_PROGRAM_EXPORT"
        s!"required VIR interface export `{requested.declaration}` is absent from marked module `{moduleName}`"
  let mut files := program.bundle.files.filter (·.path != "report.md")
  let mut infos := program.bundle.descriptor.files.filter (·.path != "report.md")
  for (support, bytes) in supports do
    (files, infos) := addFile files infos support.path support.mediaType bytes
  let descriptor : Descriptor := {
    schemaVersion := 1
    logicalId := recipe.logicalId
    kind := .program
    compatibility := compat
    files := infos
    fileEntries := #[{ role := "programSet", path := "program.irpkg-set.json" }]
    exports := recipe.exports }
  let bundle : Bundle := { contentId := descriptor.contentId, descriptor, files }
  let packed ← match Pack.encode bundle with
    | .ok value => pure value
    | .error e => fail e.code (reprStr e)
  Build.atomicInstall outputPath packed
  IO.println bundle.contentId

def usage : String :=
  "usage: vir_resource_program plan RECIPE COMPAT OWNERROOT\n" ++
  "       vir_resource_program build RECIPE COMPAT PROGRAM OWNERROOT OUT"

end Vir.ResourceProgram

def main (args : List String) : IO Unit := do
  -- Match the Lake pre-cache guard for direct producer calls as well. Do not
  -- silently clear a profile that the shared generator would otherwise read.
  if (← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST").isSome then
    throw <| IO.userError "VIR_RESOURCE_NATIVE_PROFILE_UNSUPPORTED: unset VIR_NATIVE_EXTERN_MANIFEST; resource programs require the locked runtime profile"
  match args with
  | ["plan", recipe, compatibility, root] =>
    Vir.ResourceProgram.plan recipe compatibility root
  | ["build", recipe, compatibility, setup, root, out] =>
    Vir.ResourceProgram.build recipe compatibility setup root out
  | _ => throw <| IO.userError Vir.ResourceProgram.usage
