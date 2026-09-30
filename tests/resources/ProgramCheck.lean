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

private def rejects (bundle : Bundle) (root code : String) : IO Unit :=
  match Program.check bundle root with
  | .ok _ => throw <| IO.userError s!"Program.check accepted invalid bundle: expected {code}"
  | .error message => require (message.startsWith code) s!"expected {code}, got {message}"

public def main (args : List String) : IO Unit := do
  let [path, root] := args | throw <| IO.userError "usage: ProgramCheck.lean PROGRAM ROOT"
  let bundle ← IO.ofExcept <| (Pack.decode (← IO.FS.readBinFile path)).mapError reprStr
  let checked ← IO.ofExcept <| Program.check bundle root
  let read ← Program.read path root
  require (checked.exports == read.exports && checked.members.size == read.members.size)
    "in-memory/file adapter mismatch"
  require (!checked.exports.isEmpty) "positive fixture requires actual root exports"

  -- In-memory construction cannot claim Pack.decode's container-integrity checks.
  -- These mutations leave the member/interface metadata unchanged and would pass
  -- the old public check; none depends on a malformed inner-format fixture.
  rejects { bundle with contentId := "wrong" } root "CONTENT_ID_MISMATCH"
  rejects { bundle with descriptor := { bundle.descriptor with schemaVersion := 2 } }
    root "SCHEMA_VERSION"
  let report := bundle.files.findIdx? (·.path == "report.md") |>.get!
  let reportInfo := bundle.descriptor.files.findIdx? (·.path == "report.md") |>.get!
  let payload := bundle.files[report]!
  require (!payload.bytes.isEmpty) "fixture report must be nonempty"
  let badHash := { payload with bytes := payload.bytes.set! 0 (payload.bytes[0]! ^^^ 1) }
  rejects { bundle with files := bundle.files.set! report badHash } root "HASH_MISMATCH"
  let badLength := { payload with bytes := payload.bytes.push 0 }
  rejects { bundle with files := bundle.files.set! report badLength } root "LENGTH_MISMATCH"
  let missingInfo := { bundle.descriptor with files := bundle.descriptor.files.filter (·.path != "report.md") }
  rejects { bundle with descriptor := missingInfo } root "INVENTORY_MISMATCH"
  let unsafeInfo := { bundle.descriptor.files[reportInfo]! with path := "../report.md" }
  let unsafePath := { bundle.descriptor with files := bundle.descriptor.files.set! reportInfo unsafeInfo }
  rejects { bundle with descriptor := unsafePath } root "INVALID_PATH"
  rejects bundle "Other.Root" "invalid compiled program identity"
  IO.println "Program.check: validated container, direct construction negatives and file/in-memory parity pass"
