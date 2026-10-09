/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Package.Name
import Vir.Resources.Program
import Vir.Resources.Pack

/-! Thin native adapter over the shared compiled program. Lake supplies the
registered root and returned artifact; callable inventory stays in the root
interface. No recipe, source compilation or artifact-path discovery. -/

open Lean System Vir.Resources

private def build (root : String) (compatibilityPath programPath outputPath : FilePath) : IO Unit := do
  let name ← IO.ofExcept (Vir.parseDottedName root)
  unless name.toString == root do
    throw <| IO.userError s!"INVALID_PROGRAM_ROOT: {root}"
  let compatibility ← Build.compatibility compatibilityPath
  let program ← Program.read programPath root
  unless program.bundle.descriptor.compatibility == compatibility do
    throw <| IO.userError s!"PROGRAM_COMPATIBILITY_MISMATCH: {root}"
  let descriptor : Descriptor := {
    schemaVersion := 2
    logicalId := root
    kind := .program
    compatibility
    files := program.bundle.descriptor.files.filter (·.path != "report.md")
    fileEntries := program.bundle.descriptor.fileEntries }
  let bundle : Bundle := {
    contentId := descriptor.contentId
    descriptor
    files := program.bundle.files.filter (·.path != "report.md") }
  let bytes ← IO.ofExcept <| (Pack.encode bundle).mapError (fun e => s!"{e.code}: {reprStr e}")
  Build.atomicInstall outputPath bytes
  IO.println bundle.contentId

def main (args : List String) : IO Unit := do
  if (← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST").isSome then
    throw <| IO.userError "VIR_RESOURCE_NATIVE_PROFILE_UNSUPPORTED: unset VIR_NATIVE_EXTERN_MANIFEST; resource programs require the locked runtime profile"
  match args with
  | ["build", root, compatibility, program, output] =>
    build root compatibility program output
  | _ => throw <| IO.userError "usage: vir_resource_program build ROOT COMPAT PROGRAM OUT"
