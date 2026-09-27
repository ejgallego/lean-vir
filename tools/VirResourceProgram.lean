/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Vir.GeneratePackage
import Vir.Resources.Pack
import Vir.Resources.Sha256

/-! Native, bounded producer for one independently registered marked module.
Lake resolves and traces the compiled module setup before invoking `build`.
There is no source compilation or artifact-path guessing in this tool. -/

namespace Vir.ResourceProgram
open Lean System Vir.Resources

private def fail (code detail : String) : IO α :=
  throw <| IO.userError s!"{code}: {detail}"

private def fromExcept (code : String) (value : Except String α) : IO α :=
  match value with
  | .ok value => pure value
  | .error detail => fail code detail

private def fromResource (value : Except ResourceError α) : IO α :=
  match value with
  | .ok value => pure value
  | .error err => fail err.code (reprStr err)

private def metadata? (path : FilePath) : IO (Option IO.FS.Metadata) := do
  try return some (← path.symlinkMetadata)
  catch e => match e with
    | .noFileOrDirectory .. => return none
    | _ => throw e

private partial def checkParents (path : FilePath) : IO Unit := do
  if let some parent := path.parent then
    if parent != path then checkParents parent
  if let some m ← metadata? path then
    unless m.type == .dir do fail "UNSAFE_RESOURCE_DIRECTORY" path.toString

private def checkDirectory (path : FilePath) : IO Unit := do
  checkParents path
  let some m ← metadata? path | fail "MISSING_RESOURCE_DIRECTORY" path.toString
  unless m.type == .dir do fail "UNSAFE_RESOURCE_DIRECTORY" path.toString

private def checkFile (path : FilePath) : IO Unit := do
  checkParents (path.parent.getD ".")
  if let some m ← metadata? path then
    unless m.type == .file do fail "UNSAFE_RESOURCE_FILE" path.toString

private def readInput (path : FilePath) (limit : Nat) (limitCode : String) : IO ByteArray := do
  checkFile path
  let some m ← metadata? path | fail "MISSING_RESOURCE_FILE" path.toString
  if m.byteSize.toNat > limit then fail limitCode path.toString
  let handle ← IO.FS.Handle.mk path .read
  let mut bytes := ByteArray.empty
  repeat
    let chunk ← handle.read (min 65536 (limit + 1 - bytes.size)).toUSize
    if chunk.isEmpty then return bytes
    bytes := bytes ++ chunk
    if bytes.size > limit then fail limitCode path.toString

/-! The ordinary Lean JSON parser collapses duplicate keys. Scan only JSON
object keys before parsing so recipes and compatibility files reject them. -/
private def jsonPreflight (bytes : ByteArray) : Except String Unit := do
  let some source := String.fromUTF8? bytes | throw "invalid UTF-8"
  let chars := source.toList.toArray
  let mut stack : Array (Array String) := #[]
  let mut depth := 0
  let mut digits := 0
  let mut i := 0
  while i < chars.size do
    let c := chars[i]!
    if c == '"' then
      let mut token := "\""
      i := i + 1
      let mut escaped := false
      let mut closed := false
      while i < chars.size do
        let next := chars[i]!
        token := token.push next
        i := i + 1
        if escaped then escaped := false
        else if next == '\\' then escaped := true
        else if next == '"' then
          closed := true
          break
      unless closed do throw "unterminated JSON string"
      let mut j := i
      while j < chars.size && chars[j]!.isWhitespace do j := j + 1
      if j < chars.size && chars[j]! == ':' then
        let key ← (Json.parse token >>= Json.getStr?).mapError id
        let some keys := stack.back? | throw "object key outside object"
        if keys.contains key then throw s!"duplicate JSON key `{key}`"
        stack := stack.set! (stack.size - 1) (keys.push key)
      digits := 0
      continue
    if c == '{' then
      stack := stack.push #[]
      depth := depth + 1
    else if c == '[' then depth := depth + 1
    else if c == '}' then
      if stack.isEmpty then throw "unbalanced JSON object"
      stack := stack.pop
      if depth == 0 then throw "unbalanced JSON nesting"
      depth := depth - 1
    else if c == ']' then
      if depth == 0 then throw "unbalanced JSON nesting"
      depth := depth - 1
    if depth > 16 then throw "JSON nesting exceeds 16 levels"
    if '0' ≤ c && c ≤ '9' then
      digits := digits + 1
      if digits > 16 then throw "JSON number exceeds 16 digits"
    else
      if digits > 0 && (c == 'e' || c == 'E') then throw "JSON exponent is unsupported"
      digits := 0
    i := i + 1
  unless depth == 0 && stack.isEmpty do throw "unbalanced JSON nesting"

private def readJson (path : FilePath) (limit : Nat) : IO Json := do
  let bytes ← readInput path limit "JSON_LIMIT"
  fromExcept "INVALID_JSON" (do
    jsonPreflight bytes
    Json.parse (String.fromUTF8! bytes))

private def exactKeys (json : Json) (keys : Array String) : Except String Unit := do
  let obj ← json.getObj?
  let actual := obj.toList.map (·.1)
  unless actual == keys.toList.mergeSort (· < ·) do
    throw s!"expected only fields {keys.toList}, got {actual}"

private def validMetadata (value : String) : Bool :=
  !value.isEmpty && value.utf8ByteSize ≤ maxMetadataBytes

private def compatibility (path : FilePath) : IO Compatibility := do
  let json ← readJson path maxMetadataBytes
  let c ← fromExcept "INVALID_COMPATIBILITY" do
    exactKeys json #["leanBuildId", "runtimeAbi", "jsApiVersion", "irFormatVersion"]
    return {
      leanBuildId := ← json.getObjValAs? String "leanBuildId"
      runtimeAbi := ← json.getObjValAs? String "runtimeAbi"
      jsApiVersion := ← json.getObjValAs? Nat "jsApiVersion"
      irFormatVersion := ← json.getObjValAs? Nat "irFormatVersion" }
  unless c.leanBuildId == Lean.githash do
    fail "LEAN_BUILD_MISMATCH" s!"expected {Lean.githash}, got {c.leanBuildId}"
  unless c.runtimeAbi == "2" && c.jsApiVersion == 1 && c.irFormatVersion == 11 do
    fail "UNSUPPORTED_COMPATIBILITY" s!"expected runtime ABI 2, JS API 1, IR format 11, got {repr c}"
  return c

private structure SupportInput where
  source : String
  path : String
  mediaType : String

private structure Recipe where
  logicalId : String
  modules : Array Name
  exports : Array ProgramExport
  supportFiles : Array SupportInput

private def parseRecipe (json : Json) : Except String Recipe := do
  exactKeys json #["schemaVersion", "logicalId", "modules", "exports", "supportFiles"]
  let version ← json.getObjValAs? Nat "schemaVersion"
  unless version == 1 do throw s!"unsupported schemaVersion {version}; expected 1"
  let logicalId ← json.getObjValAs? String "logicalId"
  unless validMetadata logicalId do throw "logicalId must be nonempty and at most 4096 bytes"
  let modulesJson ← (← json.getObjVal? "modules").getArr?
  unless !modulesJson.isEmpty && modulesJson.size ≤ 16 do
    throw "modules must contain 1..16 registered module names"
  let mut modules := #[]
  for item in modulesJson do
    let nameText ← item.getStr?
    let name ← Vir.parseDottedName nameText
    unless name.toString == nameText && !modules.contains name do
      throw s!"invalid or duplicate module `{nameText}`"
    modules := modules.push name
  let exportsJson ← (← json.getObjVal? "exports").getArr?
  unless exportsJson.size ≤ maxFiles do
    throw "exports must contain at most 4096 entries"
  let mut exports := #[]
  for item in exportsJson do
    exactKeys item #["role", "declaration", "interfaceId"]
    let value : ProgramExport := {
      role := ← item.getObjValAs? String "role"
      declaration := ← item.getObjValAs? String "declaration"
      interfaceId := ← item.getObjValAs? String "interfaceId" }
    unless validMetadata value.role && validMetadata value.declaration &&
        validMetadata value.interfaceId do
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
    exactKeys item #["source", "path", "mediaType"]
    let value : SupportInput := {
      source := ← item.getObjValAs? String "source"
      path := ← item.getObjValAs? String "path"
      mediaType := ← item.getObjValAs? String "mediaType" }
    unless validPath value.source && validPath value.path && validMetadata value.mediaType do
      throw s!"invalid support file source/path/mediaType `{value.source}` → `{value.path}`"
    let foldedPath := value.path.toLower
    if foldedPath == "program.irpkg-set.json" || foldedPath == "program.irpkg" ||
        foldedPath.startsWith "parts/" || foldedPath == "parts" then
      throw s!"support destination `{value.path}` conflicts with generated program members"
    unless !supportFiles.any (fun f => f.path.toLower == value.path.toLower) do
      throw s!"duplicate support destination `{value.path}`"
    supportFiles := supportFiles.push value
  return { logicalId, modules, exports, supportFiles }

private def readRecipe (path : FilePath) : IO Recipe := do
  let json ← readJson path maxDescriptorBytes
  fromExcept "INVALID_RECIPE" (parseRecipe json)

private def checkOwner (root : FilePath) : IO Unit := checkDirectory root

private def checkedSupport (root : FilePath) (source : String) : IO FilePath := do
  checkOwner root
  let path := root / source
  checkFile path
  unless (← metadata? path).isSome do fail "MISSING_RESOURCE_FILE" path.toString
  return path

private def plan (recipePath compatibilityPath root : FilePath) : IO Unit := do
  let recipe ← readRecipe recipePath
  let _ ← compatibility compatibilityPath
  checkOwner root
  if recipe.modules.size != 1 then
    fail "COMPOSITION_MODULE_REQUIRED" "v1 accepts exactly one independently registered root module; create a composition module exporting the requested declarations"
  for support in recipe.supportFiles do
    let _ ← checkedSupport root support.source
  let moduleName := recipe.modules[0]!.toString
  let supportFiles := recipe.supportFiles.map fun support => Json.str support.source
  IO.println (Json.compress <| Json.mkObj [
    ("module", toJson moduleName),
    ("supportFiles", Json.arr supportFiles)])

private def runtimePlan (compatibilityPath lockPath root : FilePath) : IO Unit := do
  let _ ← compatibility compatibilityPath
  let json ← readJson lockPath maxMetadataBytes
  let (contentId, source) ← fromExcept "INVALID_RUNTIME_LOCK" do
    exactKeys json #["schemaVersion", "contentId", "source"]
    let version ← json.getObjValAs? Nat "schemaVersion"
    unless version == 1 do throw s!"unsupported schemaVersion {version}; expected 1"
    let contentId ← json.getObjValAs? String "contentId"
    unless contentId.utf8ByteSize == 64 &&
        contentId.toList.all ("0123456789abcdef".contains ·) do
      throw "contentId must be 64 lowercase hex digits"
    let source ← json.getObjValAs? String "source"
    unless validMetadata source do throw "source must be a bounded nonempty string"
    return (contentId, source)
  let source ← if source == "-" then pure source
    else if source.startsWith "https://" then do
      let host := ((source.drop "https://".length).toString.splitOn "/").head!
      unless !host.isEmpty && !source.toList.any (fun c =>
          c.isWhitespace || c.toNat < 33 || c.toNat == 127) do
        fail "INVALID_RUNTIME_LOCK" "HTTPS source must have a host and no whitespace/control characters"
      pure source
    else do
      unless validPath source do fail "INVALID_RUNTIME_LOCK" s!"unsafe local source `{source}`"
      let path ← checkedSupport root source
      pure path.toString
  IO.println (Json.compress <| Json.mkObj [
    ("contentId", toJson contentId), ("source", toJson source)])

private def packageMembers (descriptorPath : FilePath) : IO (Array String) := do
  let json ← readJson descriptorPath maxDescriptorBytes
  let members ← fromExcept "INVALID_PACKAGE_SET" do
    let packages ← (← json.getObjVal? "packages").getArr?
    if packages.isEmpty || packages.size > maxFiles then throw "invalid package count"
    packages.mapM fun member => member.getObjValAs? String "path"
  for path in members do
    unless validPath path do fail "INVALID_PACKAGE_PATH" path
  return members

private def addFile (files : Array File) (infos : Array FileInfo)
    (path mediaType : String) (bytes : ByteArray) : Array File × Array FileInfo :=
  (files.push { path, bytes }, infos.push {
    path, mediaType, byteLength := bytes.size, sha256 := sha256 bytes })

private def install (bytes : ByteArray) (destination : FilePath) : IO Unit := do
  checkFile destination
  if let some metadata ← metadata? destination then
    if metadata.byteSize.toNat == bytes.size then
      if (← readInput destination bytes.size "PACK_LIMIT") == bytes then return
  let parent := destination.parent.getD "."
  IO.FS.createDirAll parent
  checkParents parent
  let mut directory? := none
  for _ in [:8] do
    let nonce := sha256 (← IO.getRandomBytes 32)
    let directory := parent / s!".vir-program-{nonce}"
    try
      IO.FS.createDir directory
      directory? := some directory
      break
    catch e => match e with
      | .alreadyExists .. => pure ()
      | _ => throw e
  let some directory := directory? | fail "TEMPORARY_PATH_COLLISION" parent.toString
  let temporary := directory / "pack"
  try
    IO.FS.writeBinFile temporary bytes
    checkFile destination
    IO.FS.rename temporary destination
  finally
    if (← metadata? temporary).isSome then IO.FS.removeFile temporary
    IO.FS.removeDir directory

private def stage (compatibilityPath packPath outputPath : FilePath) : IO Unit := do
  let expected ← compatibility compatibilityPath
  let bytes ← readInput packPath (maxPayloadBytes + maxDescriptorBytes + 12) "PACK_LIMIT"
  let bundle ← fromResource (Pack.decode bytes)
  unless bundle.descriptor.compatibility == expected do
    fail "INCOMPATIBLE" s!"bundle {bundle.descriptor.logicalId} has {repr bundle.descriptor.compatibility}; expected {repr expected}"
  install bytes outputPath
  IO.println bundle.contentId

private unsafe def build (recipePath compatibilityPath setupPath root outputPath : FilePath) : IO Unit := do
  let recipe ← readRecipe recipePath
  let compat ← compatibility compatibilityPath
  checkOwner root
  if recipe.modules.size != 1 then
    fail "COMPOSITION_MODULE_REQUIRED" "v1 accepts exactly one independently registered root module; create a composition module exporting the requested declarations"
  let moduleName := recipe.modules[0]!
  let mut supports : Array (SupportInput × ByteArray) := #[]
  let mut supportTotal := 0
  for support in recipe.supportFiles do
    let path ← checkedSupport root support.source
    let bytes ← readInput path (maxPayloadBytes - supportTotal) "PAYLOAD_LIMIT"
    supportTotal := supportTotal + bytes.size
    supports := supports.push (support, bytes)
  let setup ← ModuleSetup.load setupPath
  unless setup.name == moduleName do
    fail "SETUP_MODULE_MISMATCH" s!"expected {moduleName}, got {setup.name}"
  IO.FS.withTempDir fun temporary => do
    let packagePath := temporary / "program.irpkg"
    let setPath := temporary / "program.irpkg-set.json"
    let shardDir := temporary / "parts"
    let reportPath := temporary / "report.md"
    IO.FS.createDir shardDir
    let required ← recipe.exports.mapM fun item =>
      fromExcept "INVALID_EXPORT" (Vir.parseDottedName item.declaration)
    let result ← Vir.GeneratePackage.runModuleSet
      #[{ origin := .module moduleName, mode := .marked }] moduleName
      packagePath setPath shardDir "program.irpkg" "parts" reportPath
      setup.importArts required (some sha256)
    unless result == 0 do fail "PROGRAM_GENERATION_FAILED" s!"see diagnostics for {moduleName}"
    let members ← packageMembers setPath
    let mut files : Array File := #[]
    let mut infos : Array FileInfo := #[]
    let setBytes ← readInput setPath maxDescriptorBytes "DESCRIPTOR_LIMIT"
    (files, infos) := addFile files infos "program.irpkg-set.json" "application/json" setBytes
    let mut total := setBytes.size + supportTotal
    if total > maxPayloadBytes then fail "PAYLOAD_LIMIT" "package set and support files exceed limit"
    for member in members do
      let path := temporary / member
      let bytes ← readInput path (maxPayloadBytes - total) "PAYLOAD_LIMIT"
      total := total + bytes.size
      (files, infos) := addFile files infos member "application/vnd.lean-vir.ir-package" bytes
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
    let packed ← fromResource (Pack.encode bundle)
    install packed outputPath
    IO.println bundle.contentId

def usage : String :=
  "usage: vir_resource_program plan RECIPE COMPAT OWNERROOT\n" ++
  "       vir_resource_program runtime-plan COMPAT LOCK OWNERROOT\n" ++
  "       vir_resource_program build RECIPE COMPAT SETUP OWNERROOT OUT\n" ++
  "       vir_resource_program stage COMPAT PACK OUT"

end Vir.ResourceProgram

unsafe def main (args : List String) : IO Unit := do
  match args with
  | ["plan", recipe, compatibility, root] =>
    Vir.ResourceProgram.plan recipe compatibility root
  | ["runtime-plan", compatibility, lock, root] =>
    Vir.ResourceProgram.runtimePlan compatibility lock root
  | ["build", recipe, compatibility, setup, root, out] =>
    Vir.ResourceProgram.build recipe compatibility setup root out
  | ["stage", compatibility, pack, out] =>
    Vir.ResourceProgram.stage compatibility pack out
  | _ => throw <| IO.userError Vir.ResourceProgram.usage
