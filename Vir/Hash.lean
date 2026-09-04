/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean

public section

namespace Vir

private def nodeCmd : String :=
  if System.Platform.isWindows then "node.exe" else "node"

private def sha256Script : String :=
  "import { readFileSync } from \"node:fs\";" ++
  "import { createHash } from \"node:crypto\";" ++
  "for (const path of process.argv.slice(1)) {" ++
  "process.stdout.write(createHash(\"sha256\").update(readFileSync(path)).digest(\"hex\") + \"\\n\");" ++
  "}"

/-- Compute SHA-256 digests in one portable Node invocation. -/
def sha256Files (paths : Array System.FilePath) : IO (Array String) := do
  if paths.isEmpty then
    return #[]
  let out ← IO.Process.output {
    cmd := nodeCmd
    args := #["--input-type=module", "--eval", sha256Script, "--"] ++
      paths.map (fun path => path.toString)
  }
  if out.exitCode != 0 then
    throw <| IO.userError s!"SHA-256 helper failed: {out.stderr.trimAscii.toString}"
  let hashes := out.stdout.splitOn "\n" |>.filter (fun hash => !hash.isEmpty) |>.toArray
  unless hashes.size == paths.size && hashes.all (fun hash =>
      hash.length == 64 && hash.toList.all ("0123456789abcdef".contains ·)) do
    throw <| IO.userError "SHA-256 helper returned invalid batch output"
  return hashes

def sha256File (path : System.FilePath) : IO String := do
  let hashes ← sha256Files #[path]
  let some hash := hashes[0]?
    | throw <| IO.userError "SHA-256 helper returned no digest"
  return hash

end Vir
