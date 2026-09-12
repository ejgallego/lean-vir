/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Copyright (c) 2019 Microsoft Corporation. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: Leonardo de Moura, Emilio J. Gallego Arias
-/

module

import all Lean.Environment
public import Lean.Environment

open Lean

namespace Vir.GeneratePackage

/-- Raw compiled artifacts shared within one generation. Import visibility and
extension states are deliberately not cached. Never free these regions: imported
extensions can retain references beyond the declaration index's lifetime. -/
public structure CompiledImportCache where
  private mk ::
  /-- Fixed resolution context; changing paths requires a fresh cache. -/
  importArts : NameMap ImportArtifacts
  data : NameMap (Array (ModuleData × CompactedRegion)) := {}
  ir : NameMap (Array (ModuleData × CompactedRegion)) := {}

/-- Begin one generation with Lake-resolved paths, or conventional search paths
when no mapping is supplied. The private constructor prevents replacing the
resolution map while retaining regions read under a different map. -/
public def CompiledImportCache.empty (importArts : NameMap ImportArtifacts := {}) :
    CompiledImportCache := { importArts }

private abbrev CachedImportM := StateRefT ImportState (StateRefT CompiledImportCache IO)

/-- Lean 4.33's `importModulesCore` at exported level, with interpretation IR
(`loadIRSig = false`). Only its artifact reads are memoized. Each call starts
with a fresh ImportState, so flags, traversal order and private visibility cannot
leak from another target. Keep this adapter aligned with the pinned importer. -/
private partial def importCore (imports : Array Import) : CachedImportM Unit := do
  go imports true true true false
  for i in imports do
    if let some mod := (← get).moduleNameMap[i.module]?.bind (·.mainModule?) then
      if !mod.isModule then
        throw <| IO.userError s!"cannot import non-`module` {i.module} from `module`"
where
  loadData (i : Import) := do
    if let some parts := (← getThe CompiledImportCache).data.find? i.module then
      return parts
    let parts ← if let some arts := (← getThe CompiledImportCache).importArts.find? i.module then
        readModuleDataParts (arts.oleanParts (inServer := false))
      else readModuleDataPartsOfMod i.module
    modifyThe CompiledImportCache fun cache =>
      { cache with data := cache.data.insert i.module parts }
    return parts
  loadIR (i : Import) := do
    if let some parts := (← getThe CompiledImportCache).ir.find? i.module then
      return parts
    let parts ← if let some arts := (← getThe CompiledImportCache).importArts.find? i.module then
        readModuleDataParts arts.irParts
      else readIRPartsOfMod i.module
    modifyThe CompiledImportCache fun cache =>
      { cache with ir := cache.ir.insert i.module parts }
    return parts
  go (imports : Array Import) (importAll isExported needsData needsIRTrans : Bool) := do
    for i in imports do
      let needsData := needsData && (i.isExported || importAll)
      let importAll := importAll && i.importAll
      let isExported := isExported && i.isExported
      let needsIRTrans := needsIRTrans || (needsData && i.isMeta)
      let needsIR := needsIRTrans || importAll
      if !needsData && !needsIR then
        continue
      let irPhases := if importAll then .all else if needsIRTrans then .comptime else .runtime
      let goRec mod := do
        if let some mod := mod.mainModule? then
          go mod.imports importAll isExported needsData needsIRTrans
      if let some mod := (← get).moduleNameMap[i.module]? then
        let importAll := importAll || mod.importAll
        let isExported := isExported || mod.isExported
        let needsData := needsData || mod.hasData
        let needsIRTrans := needsIRTrans || mod.needsIRTrans
        let irPhases := if irPhases == mod.irPhases then irPhases else .all
        let parts ← if needsData && mod.parts.isEmpty then loadData i else pure mod.parts
        let irParts ← if (needsIRTrans || importAll) && mod.irParts.isEmpty then loadIR i else pure mod.irParts
        if importAll != mod.importAll || isExported != mod.isExported ||
            needsIRTrans != mod.needsIRTrans || needsData != mod.hasData || irPhases != mod.irPhases then
          modify fun s => { s with moduleNameMap := s.moduleNameMap.insert i.module { mod with
            importAll, isExported, irPhases, parts, irParts, hasData := needsData, needsIRTrans } }
          goRec mod
        continue
      let parts ← if needsData then loadData i else pure #[]
      let irParts ← if needsIR then loadIR i else pure #[]
      let mod := { i with importAll, isExported, irPhases, parts, irParts, needsIRTrans, hasData := needsData }
      goRec mod
      modify fun s => { s with
        moduleNameMap := s.moduleNameMap.insert i.module mod
        moduleNames := s.moduleNames.push i.module
      }

/-- Import one independent module context, sharing only immutable file contents
with earlier imports in this generation. No global cache or source acquisition.
The caller must enable initializer execution, as for Lean.importModules with
loadExts. Search paths and compiled files must remain fixed during cache use. -/
public def CompiledImportCache.importModules (cache : CompiledImportCache)
    (imports : Array Import) (opts : Options) : IO (Environment × CompiledImportCache) := do
  for imp in imports do
    if imp.module matches .anonymous then
      throw <| IO.userError "import failed, trying to import module with anonymous name"
  withImporting do
    let ((_, state), cache) ← (importCore imports |>.run {}).run cache
    let env ← finalizeImport state imports opts 0 (leakEnv := false) (loadExts := true)
      (level := .exported)
    return (env, cache)

end Vir.GeneratePackage
