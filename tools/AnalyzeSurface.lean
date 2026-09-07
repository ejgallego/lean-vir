/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.DocString
import Lean.Meta
import Vir.GeneratePackage.Surface.Report

open Lean

namespace Vir.AnalyzeSurface

open Vir.GeneratePackage

structure Options where
  jsonPath : System.FilePath
  markdownPath : System.FilePath
  modules : Array Name := #[]
  roots : Array Name := #[]
  source? : Option System.FilePath := none
  sourceModule? : Option Name := none
  extraNativeExterns : Array Name := #[]

partial def parseOptions
    (args : List String) (options : Options) : Except String Options := do
  match args with
  | [] => return options
  | "--module" :: moduleName :: rest =>
      let name ← Vir.parseDottedName moduleName
      parseOptions rest { options with modules := options.modules.push name }
  | "--root" :: declarationName :: rest =>
      let name ← Vir.parseDottedName declarationName
      if options.roots.contains name then
        throw s!"duplicate --root `{name}`"
      parseOptions rest { options with roots := options.roots.push name }
  | "--source" :: source :: rest =>
      if options.source?.isSome then
        throw "duplicate --source"
      parseOptions rest { options with source? := some source }
  | "--source-module" :: moduleName :: rest =>
      if options.sourceModule?.isSome then
        throw "duplicate --source-module"
      let name ← Vir.parseDottedName moduleName
      parseOptions rest { options with sourceModule? := some name }
  | "--native-extern" :: externName :: rest =>
      let name ← Vir.parseDottedName externName
      if options.extraNativeExterns.contains name then
        throw s!"duplicate --native-extern `{name}`"
      parseOptions rest { options with extraNativeExterns := options.extraNativeExterns.push name }
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

private def mixOptionalString (state : UInt64) (value : Option String) : UInt64 :=
  value.map (mixHash state <| hash ·) |>.getD (mixHash state 0)

private def compactWhitespace (text : String) : String :=
  (" ".toSlice.intercalate <|
    (text.split Char.isWhitespace).filter (!·.isEmpty) |>.toList)

private def declarationMetadata
    (env : Environment) (name : Name) : MetaM (Option String × Option String) := do
  let typeSignature? ← match env.find? name with
    | some info => pure <| some (compactWhitespace (toString (← Meta.ppExpr info.type)))
    | none => pure none
  let docString? := (← findDocString? env name).map fun doc => doc.trimAscii.toString
  return (typeSignature?, docString?)

private def attachSurfaceMetadata
    (env : Environment) (report : SurfaceReport) : MetaM SurfaceReport := do
  let declarations ← report.declarations.mapM fun result => do
    let (typeSignature?, docString?) ← declarationMetadata env result.name
    return { result with typeSignature?, docString? }
  let externs ← report.externs.mapM fun result => do
    let (typeSignature?, docString?) ← declarationMetadata env result.name
    return { result with typeSignature?, docString? }
  return { report with declarations, externs }

private unsafe def resolveSurfaceNativeExterns
    (env : Environment) (extraNames : Array Name) : IO (Array NativeExtern) := do
  match resolveNativeExternsWithExtras env extraNames with
  | .ok externs => return externs
  | .error _ =>
      -- A module-scoped scan need not import every declaration in the runtime
      -- catalog. Resolve policy against Lean's umbrella module in that case.
      let catalogEnv ← loadLibrarySurfaceEnvironment #[`Lean]
      match resolveNativeExternsWithExtras catalogEnv extraNames with
      | .ok externs => return externs
      | .error error => throw <| IO.userError s!"native extern catalog: {error}"

/-- Force the complete in-memory analysis before measuring report rendering. -/
private def forceSurfaceReport (report : SurfaceReport) : UInt64 :=
  let state := mixNames (mixNames (hash report.loadedModules) report.selectedModules)
    report.selectedDeclarations
  let state := mixHash state (hash report.rootReachableNodes)
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
  let state := report.externs.foldl (fun state result =>
    let state := mixHash state result.name.hash
    let state := mixHash state result.moduleName.hash
    let state := mixHash state (hash result.status.label)
    let state := result.targets.foldl (fun state target =>
      let state := mixHash state (hash target.kind.label)
      let state := target.backend?.map (mixHash state ·.hash) |>.getD state
      target.value?.map (mixHash state ·.hash) |>.getD state) state
    mixOptionalString (mixOptionalString state result.typeSignature?) result.docString?) state
  report.declarations.foldl (fun state result =>
    let state := mixHash state result.name.hash
    let state := mixHash state result.moduleName.hash
    let state := mixHash state (hash result.kind.label)
    let state := mixHash state (hash result.runnable)
    let state := match result.blocker? with
      | none => mixHash state 0
      | some blocker =>
          mixHash (mixHash state blocker.name.hash) (hash blocker.kind.label)
    let state := mixNames state result.blockerPath
    mixOptionalString (mixOptionalString state result.typeSignature?) result.docString?) state

unsafe def run (options : Options) : IO UInt32 := do
  let started ← IO.monoNanosNow
  if options.source?.isSome != options.sourceModule?.isSome then
    throw <| IO.userError "--source and --source-module must be used together"
  if options.source?.isSome && !options.modules.isEmpty then
    throw <| IO.userError "--source cannot be combined with --module"
  if options.source?.isSome && options.roots.isEmpty then
    throw <| IO.userError "--source requires at least one --root"
  let modules ← match options.sourceModule? with
    | some moduleName => pure #[moduleName]
    | none =>
        if options.modules.isEmpty then
          discoverInstalledLibraryModules
        else
          pure <| options.modules.foldl (fun modules name =>
            if modules.contains name then modules else modules.push name) #[]
            |>.qsort fun lhs rhs => lhs.toString < rhs.toString
  if modules.isEmpty then
    IO.eprintln "surface scan selected no installed Lean modules"
    return 2
  let env ← match options.source?, options.sourceModule? with
    | some source, some moduleName =>
        IO.eprintln s!"surface scan: compiling `{source}` as `{moduleName}`"
        loadLibrarySurfaceSourceEnvironment source moduleName
    | none, none =>
        IO.eprintln s!"surface scan: importing complete IR for {modules.size} selected module(s)"
        loadLibrarySurfaceEnvironment modules
    | _, _ => unreachable!
  let nativeExterns ← resolveSurfaceNativeExterns env options.extraNativeExterns
  let imported ← IO.monoNanosNow
  IO.eprintln s!"surface scan: loaded {env.header.moduleNames.size} module(s) in {(imported - started) / 1000000} ms"
  let report ← IO.ofExcept <|
    analyzeLibrarySurface env modules nativeExterns options.roots options.sourceModule?
  let report ← (Meta.MetaM.run' <| attachSurfaceMetadata env report).toIO'
    { fileName := options.source?.map (·.toString) |>.getD "<surface-analysis>", fileMap := default }
    { env }
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
          IO.eprintln <|
            "usage: vir_surface <report.json> <report.md> " ++
            "[--module <Lean.Module>]... [--root <Lean.Name>]... " ++
            "[--source <file.lean> --source-module <Lean.Module>] " ++
            "[--native-extern <Lean.Name>]..."
          return 2
  | _ =>
      IO.eprintln <|
        "usage: vir_surface <report.json> <report.md> " ++
        "[--module <Lean.Module>]... [--root <Lean.Name>]... " ++
        "[--source <file.lean> --source-module <Lean.Module>] " ++
        "[--native-extern <Lean.Name>]..."
      return 2
