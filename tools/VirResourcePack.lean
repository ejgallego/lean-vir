/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Vir.Resources.Build
import Vir.Resources.Pack

/-! Native build tool, deliberately below all resource carriers. Paths are build
inputs only: neither they nor transport URLs become bundle metadata. -/

namespace Vir.ResourcePack
open Lean System Vir.Resources

private def fail (code detail : String) : IO α :=
  throw <| IO.userError s!"{code}: {detail}"

/-! Materialize a canonical descriptor with actual regular-file payloads. The
descriptor determines both the allowed paths and their byte budgets. -/
private def pack (descriptorPath root destination : FilePath) : IO Unit := do
  Build.checkFile destination
  Build.checkParents root
  unless (← Build.metadata? root).isSome do
    fail "MISSING_RESOURCE_DIRECTORY" root.toString
  let descriptorBytes ← Build.readInput descriptorPath maxDescriptorBytes "DESCRIPTOR_LIMIT"
  let descriptor ← match Pack.decodeDescriptor descriptorBytes with
    | .ok value => pure value
    | .error e => fail e.code (reprStr e)
  unless descriptor.compatibility.leanBuildId == Lean.githash do
    fail "LEAN_BUILD_MISMATCH"
      s!"expected {Lean.githash}, got {descriptor.compatibility.leanBuildId}"
  let mut files := #[]
  for info in descriptor.files do
    let path := root / info.path
    let bytes ← Build.readInput path info.byteLength "LENGTH_MISMATCH"
    files := files.push { path := info.path, bytes : File }
  let bundle := { contentId := descriptor.contentId, descriptor, files : Bundle }
  let bytes ← match Pack.encode bundle with
    | .ok value => pure value
    | .error e => fail e.code (reprStr e)
  Build.atomicInstall destination bytes

private def acquire (expected source : String) (cache stage : FilePath) (offline : Bool) : IO Unit := do
  unless expected.length == 64 && expected.toList.all ("0123456789abcdef".contains ·) do
    fail "INVALID_CONTENT_ID" expected
  -- Check both destinations before doing any acquisition or committing a cache.
  Build.checkFile cache
  Build.checkFile stage
  let bytes ← match ← Build.candidate expected cache with
    | some bytes => pure bytes
    | none => match ← Build.candidate expected stage with
      | some bytes => pure bytes
      | none =>
        if source == "-" || (offline && source.startsWith "https://") then
          fail "RESOURCE_OFFLINE_MISS" s!"required bundle {expected}; cache {cache}"
        let bytes ← if source.startsWith "https://" then
          Build.withSibling cache fun temporary => do
            let result ← IO.Process.output {
              cmd := "curl"
              -- -q ignores per-user curl config (including credentials). Only
              -- HTTPS redirects are permitted; no gh/token/Node/source-build path.
              args := #["-q", "--fail", "--silent", "--show-error", "--location",
                "--proto", "=https", "--proto-redir", "=https",
                "--connect-timeout", "20", "--max-time", "120",
                "--max-filesize", toString Build.packLimit, "--output", temporary.toString,
                "--url", source] }
            unless result.exitCode == 0 do
              fail "RESOURCE_DOWNLOAD_FAILED" s!"bundle {expected}: {result.stderr.trimAscii}"
            Build.readInput temporary Build.packLimit "PACK_LIMIT"
        else
          if (source.splitOn "://").length > 1 then
            fail "UNSUPPORTED_RESOURCE_TRANSPORT" source
          Build.readInput source Build.packLimit "PACK_LIMIT"
        Build.verify expected bytes
        pure bytes
  Build.atomicInstall cache bytes
  Build.atomicInstall stage bytes

private def runtimePlan (compatibilityPath lockPath root : FilePath) : IO Unit :=
  Build.runtimePlan compatibilityPath lockPath root

private def stage (compatibilityPath packPath outputPath : FilePath) : IO Unit := do
  let contentId ← Build.stage compatibilityPath packPath outputPath
  IO.println contentId

def usage : String :=
  "usage: vir_resource_pack pack DESCRIPTOR ROOT OUT\n" ++
  "       vir_resource_pack acquire CONTENT_ID SOURCE CACHE STAGE [--offline]\n" ++
  "       vir_resource_pack runtime-plan COMPAT LOCK OWNERROOT\n" ++
  "       vir_resource_pack stage COMPAT PACK OUT\n" ++
  "SOURCE is a local pack, anonymous HTTPS URL, or '-' (available bytes only).\n" ++
  "Transport never overrides CONTENT_ID or the tool's exact Lean build identity."

end Vir.ResourcePack

def main (args : List String) : IO Unit := do
  match args with
  | ["pack", descriptor, root, out] =>
    Vir.ResourcePack.pack descriptor root out
  | ["acquire", expected, source, cache, stage] =>
    Vir.ResourcePack.acquire expected source cache stage false
  | ["acquire", expected, source, cache, stage, "--offline"] =>
    Vir.ResourcePack.acquire expected source cache stage true
  | ["runtime-plan", compatibility, lock, root] =>
    Vir.ResourcePack.runtimePlan compatibility lock root
  | ["stage", compatibility, pack, out] =>
    Vir.ResourcePack.stage compatibility pack out
  | _ => throw <| IO.userError Vir.ResourcePack.usage
