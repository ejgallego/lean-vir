/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Surface.Report

open Lean

namespace Vir.AnalyzeSurface

open Vir.GeneratePackage

structure Options where
  jsonPath : System.FilePath
  markdownPath : System.FilePath
  modules : Array Name := #[]

def nameFromDotted (text : String) : Name :=
  text.splitOn "." |>.foldl (fun name part =>
    if part.isEmpty then name else .str name part) .anonymous

partial def parseOptions
    (args : List String) (options : Options) : Except String Options := do
  match args with
  | [] => return options
  | "--module" :: moduleName :: rest =>
      let name := nameFromDotted moduleName
      if name.isAnonymous then
        throw "--module requires a non-empty dotted Lean module name"
      parseOptions rest { options with modules := options.modules.push name }
  | arg :: _ => throw s!"unknown argument `{arg}`"

def writeTextFile (path : System.FilePath) (contents : String) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  IO.FS.writeFile path contents

private def mixCounts (state : UInt64) (counts : SurfaceCounts) : UInt64 :=
  let state := mixHash state (hash counts.total)
  let state := mixHash state (hash counts.runnable)
  let state := mixHash state (hash counts.publicTotal)
  let state := mixHash state (hash counts.publicRunnable)
  let state := mixHash state (hash counts.privateTotal)
  let state := mixHash state (hash counts.boxedTotal)
  mixHash state (hash counts.generatedTotal)

private def mixNames (state : UInt64) (names : Array Name) : UInt64 :=
  names.foldl (fun state name => mixHash state name.hash) state

/-- Force the complete in-memory analysis before measuring report rendering. -/
private def forceSurfaceReport (report : SurfaceReport) : UInt64 :=
  let state := mixNames (hash report.loadedModules) report.selectedModules
  let state := mixCounts state report.counts
  let state := report.libraries.foldl (fun state result =>
    mixCounts (mixHash (mixHash state result.name.hash) (hash result.modulesWithFunctions))
      result.counts) state
  let state := report.modules.foldl (fun state result =>
    mixCounts (mixHash state result.name.hash) result.counts) state
  let state := report.blockers.foldl (fun state summary =>
    let state := mixHash state summary.blocker.name.hash
    let state := mixHash state (hash summary.blocker.kind.label)
    let state := mixHash state (hash summary.roots)
    let state := mixHash state (hash summary.publicRoots)
    let state := mixHash state summary.exampleRoot.hash
    mixNames state summary.examplePath) state
  report.declarations.foldl (fun state result =>
    let state := mixHash state result.name.hash
    let state := mixHash state result.moduleName.hash
    let state := mixHash state (hash result.kind.label)
    let state := mixHash state (hash result.runnable)
    let state := match result.blocker? with
      | none => mixHash state 0
      | some blocker =>
          mixHash (mixHash state blocker.name.hash) (hash blocker.kind.label)
    mixNames state result.blockerPath) state

unsafe def run (options : Options) : IO UInt32 := do
  let started ← IO.monoNanosNow
  let modules ←
    if options.modules.isEmpty then
      discoverInstalledLibraryModules
    else
      pure <| options.modules.foldl (fun modules name =>
        if modules.contains name then modules else modules.push name) #[]
        |>.qsort fun lhs rhs => lhs.toString < rhs.toString
  if modules.isEmpty then
    IO.eprintln "surface scan selected no installed Lean modules"
    return 2
  IO.eprintln s!"surface scan: importing complete IR for {modules.size} selected module(s)"
  let env ← loadLibrarySurfaceEnvironment modules
  let imported ← IO.monoNanosNow
  IO.eprintln s!"surface scan: loaded {env.header.moduleNames.size} module(s) in {(imported - started) / 1000000} ms"
  let report := analyzeLibrarySurface env modules
  let fingerprint := forceSurfaceReport report
  IO.eprintln s!"surface scan: analysis checksum {fingerprint}"
  let analyzed ← IO.monoNanosNow
  IO.eprintln s!"surface scan: analyzed {report.counts.total} IR function(s) in {(analyzed - imported) / 1000000} ms"
  let json := report.toJson ++ "\n"
  let markdown := report.toMarkdown
  IO.eprintln s!"surface scan: rendered {json.utf8ByteSize + markdown.utf8ByteSize} byte(s)"
  let rendered ← IO.monoNanosNow
  IO.eprintln s!"surface scan: rendered reports in {(rendered - analyzed) / 1000000} ms"
  writeTextFile options.jsonPath json
  writeTextFile options.markdownPath markdown
  let finished ← IO.monoNanosNow
  IO.eprintln s!"surface scan: wrote `{options.jsonPath}` and `{options.markdownPath}` in {(finished - rendered) / 1000000} ms"
  return 0

end Vir.AnalyzeSurface

unsafe def main (args : List String) : IO UInt32 := do
  match args with
  | jsonPath :: markdownPath :: rest =>
      match Vir.AnalyzeSurface.parseOptions rest { jsonPath, markdownPath } with
      | .ok options =>
          try
            Vir.AnalyzeSurface.run options
          catch error =>
            IO.eprintln s!"surface scan failed: {error}"
            return 1
      | .error error =>
          IO.eprintln error
          IO.eprintln "usage: vir_surface <report.json> <report.md> [--module <Lean.Module>]..."
          return 2
  | _ =>
      IO.eprintln "usage: vir_surface <report.json> <report.md> [--module <Lean.Module>]..."
      return 2
