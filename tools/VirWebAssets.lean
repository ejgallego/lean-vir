/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Vir.GeneratePackage.Json
import Vir.GeneratePackage.PackageFormat

open Lean System
open Vir.GeneratePackage

namespace Vir.WebAssets

def webAssetsFormat : String := "lean-vir-web-assets"

def currentWebAssetsVersion : Nat := 1

structure ProgramArg where
  id : String
  packageName : String
  moduleName : String
  descriptor : FilePath

structure Options where
  out : FilePath := ".lake/build/vir/web-assets"
  sdkManifest : FilePath := ".lake/build/vir/sdk/lean-vir-artifact.json"
  virVersion : String := ""
  virCommit : String := ""
  hostPackage : String := ""
  programs : Array ProgramArg := #[]

def usage : String :=
  "usage: vir_web_assets --out DIR --sdk-manifest FILE --vir-version VERSION " ++
  "--vir-commit COMMIT --host-package PACKAGE " ++
  "[--program ID PACKAGE MODULE DESCRIPTOR]..."

partial def parseArgs (args : List String) (opts : Options := {}) : Except String Options :=
  match args with
  | [] =>
      if opts.virVersion.isEmpty then
        .error s!"missing --vir-version\n\n{usage}"
      else if opts.hostPackage.isEmpty then
        .error s!"missing --host-package\n\n{usage}"
      else if opts.programs.isEmpty then
        .error s!"at least one --program is required\n\n{usage}"
      else
        .ok opts
  | "--out" :: value :: rest => parseArgs rest { opts with out := FilePath.mk value }
  | "--sdk-manifest" :: value :: rest =>
      parseArgs rest { opts with sdkManifest := FilePath.mk value }
  | "--vir-version" :: value :: rest => parseArgs rest { opts with virVersion := value }
  | "--vir-commit" :: value :: rest => parseArgs rest { opts with virCommit := value }
  | "--host-package" :: value :: rest => parseArgs rest { opts with hostPackage := value }
  | "--program" :: id :: packageName :: moduleName :: descriptor :: rest =>
      parseArgs rest { opts with programs := opts.programs.push {
        id
        packageName
        moduleName
        descriptor := FilePath.mk descriptor
      } }
  | "--help" :: _ => .error usage
  | "-h" :: _ => .error usage
  | arg :: _ => .error s!"unknown or incomplete argument: {arg}\n\n{usage}"

def readJsonFile (path : FilePath) : IO Json := do
  let text ← IO.FS.readFile path
  match Json.parse text with
  | .ok json => pure json
  | .error err => throw <| IO.userError s!"failed to parse {path}: {err}"

def jsonField (source : String) (json : Json) (field : String)
    (read : Json → Except String α) : IO α := do
  match json.getObjVal? field >>= read with
  | .ok value => pure value
  | .error err => throw <| IO.userError s!"invalid {source} field `{field}`: {err}"

def optionalJsonString (source : String) (json : Json) (field : String) : IO (Option String) := do
  match json.getObjVal? field with
  | .error _ => pure none
  | .ok value =>
      match value.getStr? with
      | .ok text => pure (some text)
      | .error err => throw <| IO.userError s!"invalid {source} field `{field}`: {err}"

def validatedRelativePath (source path : String) : IO FilePath := do
  if path.isEmpty then
    throw <| IO.userError s!"{source} path must be non-empty"
  let filePath := FilePath.mk path
  if filePath.isAbsolute then
    throw <| IO.userError s!"{source} path must be relative: {path}"
  let components := filePath.components
  if components.any (fun component =>
      component.isEmpty || component == "." || component == "..") then
    throw <| IO.userError s!"{source} path must not contain empty, '.', or '..' components: {path}"
  return filePath.normalize

def validateProgramId (id : String) : IO Unit := do
  let path ← validatedRelativePath "program id" id
  if path.components.length != 1 then
    throw <| IO.userError s!"program id must be one safe path component: {id}"

def run (cmd : String) (args : Array String) : IO String := do
  let out ← IO.Process.output { cmd, args }
  if out.exitCode != 0 then
    let detail := if out.stderr.trimAscii.isEmpty then out.stdout else out.stderr
    throw <| IO.userError s!"{cmd} failed ({out.exitCode}): {detail.trimAscii}"
  return out.stdout.trimAscii.toString

def sha256 (path : FilePath) : IO String := do
  let line ← run "sha256sum" #[path.toString]
  return (line.splitOn " ").head?.getD ""

structure AssetFile where
  path : String
  sha256 : String
  byteSize : Nat

def inspectFile (path : FilePath) (relPath : String) : IO AssetFile := do
  unless (← path.pathExists) do
    throw <| IO.userError s!"asset does not exist: {path}"
  if ← path.isDir then
    throw <| IO.userError s!"asset must be a file: {path}"
  let metadata ← path.metadata
  return {
    path := relPath
    sha256 := ← sha256 path
    byteSize := metadata.byteSize.toNat
  }

def AssetFile.toJson (file : AssetFile) : String :=
  jsonObject #[
    ("path", jsonString file.path),
    ("sha256", jsonString file.sha256),
    ("byteSize", jsonNat file.byteSize)
  ]

structure Compatibility where
  packageFormatVersion : Nat
  manifestVersion : Nat
  runtimeAbiVersion : Nat
  leanVersion : String
  leanToolchain : String
  leanGithash : String

def readCompatibility (source : String) (json : Json) : IO Compatibility := do
  return {
    packageFormatVersion := ← jsonField source json "packageFormatVersion" Json.getNat?
    manifestVersion := ← jsonField source json "manifestVersion" Json.getNat?
    runtimeAbiVersion := ← jsonField source json "runtimeAbiVersion" Json.getNat?
    leanVersion := ← jsonField source json "leanVersion" Json.getStr?
    leanToolchain := ← jsonField source json "leanToolchain" Json.getStr?
    leanGithash := ← jsonField source json "leanGithash" Json.getStr?
  }

def readSdkCompatibility (source : String) (json : Json) : IO Compatibility := do
  return {
    packageFormatVersion := ← jsonField source json "packageFormatVersion" Json.getNat?
    manifestVersion := ← jsonField source json "manifestVersion" Json.getNat?
    runtimeAbiVersion := ← jsonField source json "runtimeAbiVersion" Json.getNat?
    leanVersion := ← jsonField source json "leanVersion" Json.getStr?
    leanToolchain := ← jsonField source json "leanToolchain" Json.getStr?
    leanGithash := (← optionalJsonString source json "leanGithash").getD ""
  }

def Compatibility.toJson (compatibility : Compatibility) : String :=
  jsonObject #[
    ("packageFormatVersion", jsonNat compatibility.packageFormatVersion),
    ("manifestVersion", jsonNat compatibility.manifestVersion),
    ("runtimeAbiVersion", jsonNat compatibility.runtimeAbiVersion),
    ("leanVersion", jsonString compatibility.leanVersion),
    ("leanToolchain", jsonString compatibility.leanToolchain),
    ("leanGithash", jsonString compatibility.leanGithash)
  ]

def validateCompatibility (source : String) (compatibility : Compatibility) : IO Unit := do
  if compatibility.packageFormatVersion != currentPackageFormatVersion then
    throw <| IO.userError <| s!"{source} package format mismatch: expected " ++
      s!"{currentPackageFormatVersion}, got {compatibility.packageFormatVersion}"
  if compatibility.manifestVersion != currentInterfaceManifestVersion then
    throw <| IO.userError <| s!"{source} interface manifest mismatch: expected " ++
      s!"{currentInterfaceManifestVersion}, got {compatibility.manifestVersion}"
  if compatibility.runtimeAbiVersion != currentRuntimeAbiVersion then
    throw <| IO.userError <| s!"{source} runtime ABI mismatch: expected " ++
      s!"{currentRuntimeAbiVersion}, got {compatibility.runtimeAbiVersion}"

def normalizedLeanToolchain (toolchain : String) : String :=
  toolchain.replace ":v" ":"

structure SdkInfo where
  version : String
  gitCommit : String
  compatibility : Compatibility
  manifestFile : AssetFile
  files : Array AssetFile

def readSdk (opts : Options) : IO SdkInfo := do
  let manifest ← readJsonFile opts.sdkManifest
  let source := "SDK manifest"
  let name ← jsonField source manifest "name" Json.getStr?
  if name != "lean-vir-sdk" then
    throw <| IO.userError s!"expected SDK manifest name `lean-vir-sdk`, got `{name}`"
  let version ← jsonField source manifest "version" Json.getStr?
  if version != opts.virVersion then
    throw <| IO.userError s!"SDK version mismatch: lean_vir is {opts.virVersion}, SDK is {version}"
  let gitCommit ← jsonField source manifest "gitCommit" Json.getStr?
  if gitCommit.isEmpty then
    throw <| IO.userError "SDK manifest gitCommit must not be empty"
  if !opts.virCommit.isEmpty && gitCommit != opts.virCommit then
    throw <| IO.userError s!"SDK source mismatch: lean_vir is {opts.virCommit}, SDK is {gitCommit}"
  let compatibility ← readSdkCompatibility source manifest
  validateCompatibility source compatibility
  let fileJsons ← jsonField source manifest "files" Json.getArr?
  let sdkDir := opts.sdkManifest.parent.getD "."
  let mut files : Array AssetFile := #[]
  let mut paths : Array String := #[]
  for fileJson in fileJsons do
    let relPathString ← jsonField "SDK file" fileJson "path" Json.getStr?
    let relPath ← validatedRelativePath "SDK file" relPathString
    if paths.contains relPathString then
      throw <| IO.userError s!"duplicate SDK file path: {relPathString}"
    paths := paths.push relPathString
    let expectedHash ← jsonField "SDK file" fileJson "sha256" Json.getStr?
    let file ← inspectFile (sdkDir / relPath) relPathString
    if file.sha256 != expectedHash then
      throw <| IO.userError <| s!"SDK checksum mismatch for {relPathString}: expected " ++
        s!"{expectedHash}, got {file.sha256}"
    files := files.push file
  unless paths.contains "js/vir-runtime.js" do
    throw <| IO.userError "SDK does not contain js/vir-runtime.js"
  unless paths.contains "wasm/vir-upstream.wasm" do
    throw <| IO.userError "SDK does not contain wasm/vir-upstream.wasm"
  let manifestFile ← inspectFile opts.sdkManifest "lean-vir-artifact.json"
  return { version, gitCommit, compatibility, manifestFile, files }

structure ProgramInfo where
  arg : ProgramArg
  descriptorName : String
  compatibility : Compatibility
  files : Array AssetFile

def readProgram (arg : ProgramArg) : IO ProgramInfo := do
  validateProgramId arg.id
  let descriptor ← readJsonFile arg.descriptor
  let source := s!"package-set descriptor for {arg.moduleName}"
  let format ← jsonField source descriptor "format" Json.getStr?
  if format != packageSetFormat then
    throw <| IO.userError s!"{source} format mismatch: expected {packageSetFormat}, got {format}"
  let version ← jsonField source descriptor "version" Json.getNat?
  if version != currentPackageSetVersion then
    throw <| IO.userError <| s!"{source} version mismatch: expected " ++
      s!"{currentPackageSetVersion}, got {version}"
  let compatibilityJson ← jsonField source descriptor "compatibility" pure
  let compatibility ← readCompatibility source compatibilityJson
  validateCompatibility source compatibility
  let packageJsons ← jsonField source descriptor "packages" Json.getArr?
  if packageJsons.isEmpty then
    throw <| IO.userError s!"{source} must contain at least one package"
  let descriptorDir := arg.descriptor.parent.getD "."
  let some descriptorName := arg.descriptor.fileName
    | throw <| IO.userError s!"descriptor path has no file name: {arg.descriptor}"
  let mut files := #[← inspectFile arg.descriptor descriptorName]
  let mut moduleNames : Array String := #[]
  let mut paths : Array String := #[]
  for h : index in [0:packageJsons.size] do
    let packageJson := packageJsons[index]
    let moduleName ← jsonField "package-set member" packageJson "module" Json.getStr?
    if moduleName.isEmpty || moduleNames.contains moduleName then
      throw <| IO.userError s!"{source} has an empty or duplicate module: {moduleName}"
    moduleNames := moduleNames.push moduleName
    let role ← jsonField "package-set member" packageJson "role" Json.getStr?
    let expectedRole := if index + 1 == packageJsons.size then "root" else "dependency"
    if role != expectedRole then
      throw <| IO.userError s!"{source} member {moduleName} must have role {expectedRole}"
    if role == "root" && moduleName != arg.moduleName then
      throw <| IO.userError s!"{source} root is {moduleName}, expected {arg.moduleName}"
    let relPathString ← jsonField "package-set member" packageJson "path" Json.getStr?
    let relPath ← validatedRelativePath "package-set member" relPathString
    if paths.contains relPathString then
      throw <| IO.userError s!"{source} has duplicate member path: {relPathString}"
    paths := paths.push relPathString
    files := files.push (← inspectFile (descriptorDir / relPath) relPathString)
  return { arg, descriptorName, compatibility, files }

def copyFileIfChanged (source dest : FilePath) (expectedHash : String) : IO Unit := do
  let unchanged ← if ← dest.pathExists then
    if ← dest.isDir then pure false else pure ((← sha256 dest) == expectedHash)
  else
    pure false
  if unchanged then
    return
  if ← dest.pathExists then
    if ← dest.isDir then IO.FS.removeDirAll dest else IO.FS.removeFile dest
  if let some parent := dest.parent then
    IO.FS.createDirAll parent
  IO.FS.writeBinFile dest (← IO.FS.readBinFile source)

def fileContentsEqual (left right : FilePath) : IO Bool := do
  if !(← left.pathExists) || !(← right.pathExists) then
    return false
  if (← left.isDir) || (← right.isDir) then
    return false
  return (← IO.FS.readBinFile left) == (← IO.FS.readBinFile right)

def stageSdk (opts : Options) (sdk : SdkInfo) : IO Unit := do
  let sdkDir := opts.sdkManifest.parent.getD "."
  let destDir := opts.out / "sdk"
  let destManifest := destDir / "lean-vir-artifact.json"
  unless ← fileContentsEqual opts.sdkManifest destManifest do
    if ← destDir.pathExists then
      IO.FS.removeDirAll destDir
  for file in sdk.files do
    copyFileIfChanged (sdkDir / FilePath.mk file.path)
      (destDir / FilePath.mk file.path) file.sha256
  copyFileIfChanged opts.sdkManifest destManifest sdk.manifestFile.sha256

def stageProgram (opts : Options) (program : ProgramInfo) : IO Unit := do
  let sourceDir := program.arg.descriptor.parent.getD "."
  let destDir := opts.out / "programs" / program.arg.id
  let destDescriptor := destDir / program.descriptorName
  unless ← fileContentsEqual program.arg.descriptor destDescriptor do
    if ← destDir.pathExists then
      IO.FS.removeDirAll destDir
  for file in program.files do
    let source := if file.path == program.descriptorName then
      program.arg.descriptor
    else
      sourceDir / FilePath.mk file.path
    copyFileIfChanged source (destDir / FilePath.mk file.path) file.sha256

def removeStalePrograms (opts : Options) (programs : Array ProgramInfo) : IO Unit := do
  let programsDir := opts.out / "programs"
  unless ← programsDir.pathExists do
    return
  let expectedIds := programs.map (·.arg.id)
  for entry in ← programsDir.readDir do
    unless expectedIds.contains entry.fileName do
      if ← entry.path.isDir then IO.FS.removeDirAll entry.path else IO.FS.removeFile entry.path

def ProgramInfo.toJson (program : ProgramInfo) : String :=
  jsonObject #[
    ("id", jsonString program.arg.id),
    ("package", jsonString program.arg.packageName),
    ("module", jsonString program.arg.moduleName),
    ("descriptor", jsonString s!"programs/{program.arg.id}/{program.descriptorName}"),
    ("compatibility", program.compatibility.toJson),
    ("files", jsonArray <| program.files.map fun file =>
      { file with path := s!"programs/{program.arg.id}/{file.path}" }.toJson)
  ]

def manifestJson (opts : Options) (sdk : SdkInfo) (programs : Array ProgramInfo) : String :=
  jsonObject #[
    ("format", jsonString webAssetsFormat),
    ("version", jsonNat currentWebAssetsVersion),
    ("hostPackage", jsonString opts.hostPackage),
    ("vir", jsonObject #[
      ("version", jsonString opts.virVersion),
      ("gitCommit", jsonString opts.virCommit)
    ]),
    ("sdk", jsonObject #[
      ("manifest", jsonString "sdk/lean-vir-artifact.json"),
      ("version", jsonString sdk.version),
      ("gitCommit", jsonString sdk.gitCommit),
      ("compatibility", sdk.compatibility.toJson),
      ("runtimeModule", jsonString "sdk/js/vir-runtime.js"),
      ("wasm", jsonString "sdk/wasm/vir-upstream.wasm"),
      ("files", jsonArray <| (#[sdk.manifestFile] ++ sdk.files).map fun file =>
        { file with path := s!"sdk/{file.path}" }.toJson)
    ]),
    ("programs", jsonArray <| programs.map ProgramInfo.toJson)
  ] ++ "\n"

def writeTextIfChanged (path : FilePath) (content : String) : IO Unit := do
  let unchanged ← if ← path.pathExists then
    if ← path.isDir then pure false else pure ((← IO.FS.readFile path) == content)
  else
    pure false
  if unchanged then
    return
  if ← path.pathExists then
    if ← path.isDir then IO.FS.removeDirAll path else IO.FS.removeFile path
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  IO.FS.writeFile path content

def compose (opts : Options) : IO Unit := do
  let outputManifest := opts.out / "VIR_WEB_ASSETS.json"
  if ← outputManifest.pathExists then
    IO.FS.removeFile outputManifest
  let mut ids : Array String := #[]
  let mut modules : Array String := #[]
  for arg in opts.programs do
    if ids.contains arg.id then
      throw <| IO.userError s!"duplicate web-assets program id: {arg.id}"
    if modules.contains s!"{arg.packageName}/{arg.moduleName}" then
      throw <| IO.userError s!"duplicate web-assets program: {arg.packageName}/{arg.moduleName}"
    ids := ids.push arg.id
    modules := modules.push s!"{arg.packageName}/{arg.moduleName}"
  let sdk ← readSdk opts
  let mut programs := #[]
  for arg in opts.programs do
    let program ← readProgram arg
    if normalizedLeanToolchain program.compatibility.leanToolchain !=
        normalizedLeanToolchain sdk.compatibility.leanToolchain then
      throw <| IO.userError <| s!"Lean toolchain mismatch for {arg.packageName}/{arg.moduleName}: " ++
        s!"program is {program.compatibility.leanToolchain}, SDK is {sdk.compatibility.leanToolchain}"
    programs := programs.push program
  IO.FS.createDirAll opts.out
  stageSdk opts sdk
  for program in programs do
    stageProgram opts program
  removeStalePrograms opts programs
  writeTextIfChanged outputManifest (manifestJson opts sdk programs)
  IO.println s!"wrote {outputManifest}"

def main (args : List String) : IO UInt32 := do
  match parseArgs args with
  | .error err =>
      IO.eprintln err
      return if err == usage then 0 else 2
  | .ok opts =>
      try
        compose opts
        return 0
      catch e =>
        IO.eprintln e.toString
        return 1

end Vir.WebAssets

def main (args : List String) : IO UInt32 :=
  Vir.WebAssets.main args
