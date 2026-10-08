/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import Vir.Resources.Program
import Vir.Resources.Pack
meta import Vir.Resources.Program
meta import Vir.Resources.Pack

open Vir.Resources

private def require (condition : Bool) (label : String) : IO Unit :=
  unless condition do throw <| IO.userError label

public def main (args : List String) : IO Unit := do
  let [path, root] := args | throw <| IO.userError "usage: ProgramRead.lean PROGRAM ROOT"
  let bundle ← IO.ofExcept <| (Pack.decode (← IO.FS.readBinFile path)).mapError reprStr
  let program ← Program.read path root
  require (program.bundle.contentId == bundle.contentId) "persisted identity differs"
  require (!program.exports.isEmpty) "positive fixture requires actual root interface exports"
  require (program.members.size + 2 == bundle.files.size) "inventory differs"
  for member in program.members do
    require ((bundle.file? member.file.path).map (·.bytes) == some member.file.bytes)
      "adapted member bytes differ"
    require (bundle.descriptor.files.contains member.info) "admitted member identity differs"
  try
    discard <| Program.read path "Other.Root"
    throw <| IO.userError "wrong requested root accepted"
  catch error =>
    require ((error.toString.splitOn "INVALID_COMPILED_PROGRAM").length > 1)
      "wrong root rejection differs"
  IO.println "Program.read: persisted identity, inventory, member bytes and requested-root admission pass"
