/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
import Vir.GeneratePackage
import Vir.Resources.Program
import Vir.Resources.Pack
import Vir.Resources.Sha256

open Lean System Vir.Resources

private unsafe def build (setupPath output : FilePath) : IO Unit := do
  let setup ← ModuleSetup.load setupPath
  let diagnostic := output.addExtension "report.md"
  Build.checkFile diagnostic
  if (← Build.metadata? diagnostic).isSome then IO.FS.removeFile diagnostic
  IO.FS.withTempDir fun temporary => do
    let setPath := temporary / "program.irpkg-set.json"
    IO.FS.createDir (temporary / "parts")
    let result ← Vir.GeneratePackage.runModuleSet
      #[{ origin := .module setup.name, mode := .marked }] setup.name
      (temporary / "program.irpkg") setPath (temporary / "parts")
      "program.irpkg" "parts" (temporary / "report.md") setup.importArts #[] (some sha256)
    unless result == 0 do
      let report := temporary / "report.md"
      if (← Build.metadata? report).isSome then
        Build.atomicInstall diagnostic (← Build.readInput report maxPayloadBytes "PROGRAM_LIMIT")
      throw <| IO.userError s!"PROGRAM_GENERATION_FAILED: {setup.name}; report: {diagnostic}"
    let json ← Build.readJson setPath maxDescriptorBytes
    let members ← IO.ofExcept <| (json.getObjVal? "packages" >>= Json.getArr?)
    let paths ← IO.ofExcept <| members.mapM (fun member => member.getObjValAs? String "path")
    let mut files := #[]
    let mut infos := #[]
    let mut total := 0
    for path in #["program.irpkg-set.json", "report.md"] ++ paths do
      unless validPath path do throw <| IO.userError s!"INVALID_PACKAGE_PATH: {path}"
      let bytes ← Build.readInput (temporary / path) (maxPayloadBytes - total) "PROGRAM_LIMIT"
      total := total + bytes.size
      let file : File := { path, bytes }
      files := files.push file
      infos := infos.push <| Program.fileInfo file <|
        if path.endsWith ".json" then "application/json"
        else if path.endsWith ".md" then "text/markdown"
        else "application/vnd.lean-vir.ir-package"
    let descriptor : Descriptor := {
      schemaVersion := 1, logicalId := "vir-compiled/" ++ setup.name.toString,
      kind := .program, compatibility := Build.currentCompatibility, files := infos,
      fileEntries := #[{ role := "programSet", path := "program.irpkg-set.json" }], exports := #[] }
    let bundle : Bundle := { contentId := descriptor.contentId, descriptor, files }
    discard <| IO.ofExcept (Program.check bundle setup.name.toString)
    let packed ← IO.ofExcept <| (Pack.encode bundle).mapError (fun e => s!"{e.code}: {reprStr e}")
    Build.atomicInstall output packed

private def adapt (checkOnly : Bool) (input : FilePath) (root : String)
    (descriptor : FilePath) (rootPath shardDir reportPath : String) : IO Unit := do
  for path in #[rootPath, shardDir, reportPath] do
    unless validPath path do throw <| IO.userError s!"INVALID_OUTPUT_PATH: {path}"
  let program ← Program.read input root
  let files := Program.looseFiles program rootPath shardDir reportPath
  let base := descriptor.parent.getD "."
  -- Validate all destinations before installing any. Publish the descriptor last.
  for file in files do
    Build.checkFile (if file.path == "descriptor" then descriptor else base / file.path)
  for file in files.filter (·.path != "descriptor") ++ files.filter (·.path == "descriptor") do
    let path := if file.path == "descriptor" then descriptor else base / file.path
    if checkOnly then
      unless (← Build.readInput path file.bytes.size "PROGRAM_LIMIT") == file.bytes do
        throw <| IO.userError s!"STALE_PROGRAM_OUTPUT: {path}"
    else Build.atomicInstall path file.bytes

unsafe def main (args : List String) : IO Unit := do
  match args with
  | ["build", setup, output] => build setup output
  | ["verify", input, root] => discard <| Program.read input root
  | ["report", input, output] =>
    Build.atomicInstall output (← Build.readInput input maxPayloadBytes "PROGRAM_LIMIT")
  | [mode, input, root, descriptor, rootPath, shardDir, reportPath] =>
    unless mode == "check" || mode == "install" do throw <| IO.userError "expected check or install"
    adapt (mode == "check") input root descriptor rootPath shardDir reportPath
  | _ => throw <| IO.userError "usage: vir_program build SETUP OUT | verify INPUT ROOT | report INPUT OUTPUT | check/install INPUT ROOT DESCRIPTOR ROOTPATH SHARDDIR REPORTPATH"
