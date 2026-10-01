/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
import Vir.NativePayload

open Vir.NativePayload System

private def rejected (label code : String) (action : IO Unit) : IO Unit := do
  let error? ← try action; pure none catch e => pure (some e.toString)
  let some error := error? | throw <| IO.userError s!"{label}: unexpectedly accepted"
  unless (error.splitOn code).length > 1 do
    throw <| IO.userError s!"{label}: wrong error {error}"

def main (args : List String) : IO Unit := do
  let [root] := args | throw <| IO.userError "expected owned fixture root"
  let root := FilePath.mk root
  let destination := root / "managed/link/new/payload"
  let outside := root / "outside/new"
  IO.FS.writeBinFile (root / "source/retained") "source bytes".toUTF8
  let payload ← verifyDirectory (root / "source") fun _ => pure ()
  rejected "directory staging" "UNSAFE_RESOURCE_DIRECTORY"
    (withSiblingDirectory destination fun _ => pure ())
  rejected "directory promotion" "UNSAFE_RESOURCE_DIRECTORY" (promote destination payload)
  rejected "managed file destination" "UNSAFE_RESOURCE_DIRECTORY"
    (checkFile destination)
  unless !(← outside.pathExists) do
    throw <| IO.userError "rejected managed path created an outside directory"
  unless (← IO.FS.readBinFile (root / "source/retained")) == "source bytes".toUTF8 do
    throw <| IO.userError "rejected promotion changed source bytes"
  match checkAnonymousHttps "https://user:pass@example.invalid/pack" with
  | .error _ => pure ()
  | .ok _ => throw <| IO.userError "credential-bearing URL accepted"
  unless !(← (root / "download").pathExists) do
    throw <| IO.userError "rejected URL created an output"
  -- Missing ordinary ancestors remain supported, with the staged directory
  -- moved only after validation and no temporary sibling left behind.
  let ordinary := root / "managed/ordinary/new/payload"
  withSiblingDirectory ordinary fun temporary => do
    unless (← temporary.isDir) do throw <| IO.userError "missing staging directory"
  promote ordinary payload
  unless (← IO.FS.readBinFile (ordinary / "retained")) == "source bytes".toUTF8 do
    throw <| IO.userError "directory promotion changed source bytes"
  -- Exercise the shared bound at the read boundary with small safe inputs.
  let file := root / "small"
  IO.FS.writeBinFile file "abcd".toUTF8
  unless (← readInput file 4 "TEST_LIMIT") == "abcd".toUTF8 do
    throw <| IO.userError "exact read limit changed bytes"
  rejected "read beyond limit" "TEST_LIMIT" (discard <| readInput file 3 "TEST_LIMIT")
  IO.FS.writeBinFile file ByteArray.empty
  unless (← readInput file 0 "TEST_LIMIT").isEmpty do
    throw <| IO.userError "empty bounded read failed"
  IO.println "native payload: ancestor rejection before creation, anonymous transport and bounded reads passed"
