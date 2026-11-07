/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import Lean

public section
namespace Vir.Release

def tagForVersion (version : String) : String := "v" ++ version

def tag : String := tagForVersion Lean.versionString

def runtimeName (revision : String) : String := s!"runtime-{revision}.virres"

def runtimeLogicalId (revision : String) : String := s!"lean-vir/runtime/{revision}"

/-- Resolve the owning checkout, never an enclosing consumer repository. -/
def sourceRevision (root : System.FilePath) : IO String := do
  unless ← (root / ".git").pathExists do
    throw <| IO.userError "VIR_SOURCE_REVISION_UNAVAILABLE: use a Git dependency or supply VIR_RUNTIME_PACK for a source archive"
  let result ← IO.Process.output {
    cmd := "git", args := #["-C", root.toString, "rev-parse", "HEAD"] }
  let revision := result.stdout.trimAscii.toString
  unless result.exitCode == 0 && revision.length == 40 &&
      revision.toList.all ("0123456789abcdef".contains ·) do
    throw <| IO.userError "VIR_SOURCE_REVISION_UNAVAILABLE: cannot resolve the VIR source commit"
  let status ← IO.Process.output {
    cmd := "git", args := #["-C", root.toString, "status", "--porcelain", "--untracked-files=normal"] }
  unless status.exitCode == 0 && status.stdout.trimAscii.toString.isEmpty do
    throw <| IO.userError "VIR_UNRELEASED_SOURCE: dirty VIR source requires an explicit VIR_RUNTIME_PACK candidate"
  return revision

end Vir.Release
