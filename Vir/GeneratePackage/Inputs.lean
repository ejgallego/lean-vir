/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import Lean.Compiler.InitAttr
import Lean.LabelAttribute
import Vir.ExportValidation
public import Vir.GeneratePackage.Basic

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

private unsafe def importModuleEnvCached (moduleName : Name)
    (cache : CompiledImportCache) : IO (Environment × CompiledImportCache) := do
  -- Match `module; import all M` without parsing or elaborating a driver.
  -- Init's runtime and meta imports are implicit in a non-prelude Lean header.
  -- The exported level is essential: the default private level disables the
  -- module system and would silently accept legacy inputs.
  enableInitializersExecution
  let opts := Elab.async.set ({} : Options) false
  let (env, cache) ← cache.importModules #[
    { module := `Init },
    { module := `Init, isMeta := true },
    { module := moduleName, importAll := true, isExported := false }
  ] opts
  return (env.setMainModule (.str (.str `VirIRInput moduleName.toString) "Generated"), cache)

def environmentModuleForDecl? (env : Environment) (name : Name) : Option Name := do
  let moduleIdx ← env.getModuleIdxFor? name
  env.header.moduleNames[moduleIdx]?

/-- Enumerate the selected input, not just the import environment's local
declarations. Loaded runtime IR takes precedence over opaque module entries. -/
def moduleDeclarations (moduleName : Name) (env : Environment) : Array Decl := Id.run do
  let some moduleIdx := env.header.moduleNames.findIdx? (· == moduleName)
    | return #[]
  let entries := declMapExt.getModuleIREntries env moduleIdx ++
    declMapExt.getModuleEntries env moduleIdx
  let mut seen : NameSet := {}
  let mut decls := #[]
  for decl in entries do
    unless seen.contains decl.name do
      seen := seen.insert decl.name
      decls := decls.push decl
  return decls

def labelledDecls (env : Environment) (attrName : Name) : IO (Array Name) := do
  match (← Lean.labelExtensionMapRef.get)[attrName]? with
  | none => return #[]
  | some ext => return ext.getState env

private def originalExternDecl? (index : DeclIndex) (name : Name) : Option Decl :=
  match index.localDecls.find? name |>.map (·.decl) with
  | some decl =>
      match decl with
      | .extern .. => some decl
      | _ => findImported
  | none => findImported
where
  findImported := index.sources.findSome? fun source => do
      let env := source.env
      let decl ← findEnvDecl env name
      match decl with
      | .extern .. => return decl
      | _ => none

private def fallbackAdapter?
    (index : DeclIndex) (original : Name) (fallback : LoadedDecl) : Option LoadedDecl := do
  let .extern _ originalParams originalResult _ ← originalExternDecl? index original | none
  let .fdecl clone cloneParams cloneResult _ info := fallback.decl | none
  if originalParams.size != cloneParams.size || originalResult != cloneResult then
    none
  else
    let pairs := originalParams.zip cloneParams
    if pairs.any fun pair => pair.1.ty != pair.2.ty then
      none
    else
      let resultIdx := originalParams.foldl (fun next param => max next (param.x.idx + 1)) 0
      let resultVar : VarId := { idx := resultIdx }
      let args := originalParams.map fun param =>
        if param.ty.isErased then .erased else .var param.x
      let afterCall := pairs.foldr (init := .ret (.var resultVar)) fun pair body =>
        let (originalParam, cloneParam) := pair
        if !originalParam.borrow && cloneParam.borrow && originalParam.ty.isPossibleRef then
          .dec originalParam.x 1 (!originalParam.ty.isDefiniteRef) false body
        else
          body
      let body := pairs.foldr
          (init := .vdecl resultVar originalResult (.fap clone args) afterCall) fun pair body =>
        let (originalParam, cloneParam) := pair
        if originalParam.borrow && !cloneParam.borrow && originalParam.ty.isPossibleRef then
          .inc originalParam.x 1 (!originalParam.ty.isDefiniteRef) false body
        else
          body
      return {
        source := s!"Lean reference body for `{original}`"
        module? := fallback.module?
        decl := .fdecl original originalParams originalResult body info
      }

private def importedLoadedDecl?
    (index : DeclIndex) (name : Name) (accept : Decl → Bool) : Option LoadedDecl :=
  index.sources.findSome? fun source => do
    let env := source.env
    let decl ← findEnvDecl env name
    guard <| accept decl
    return {
      source := s!"imported by {source.display}"
      module? := environmentModuleForDecl? env name
      decl
    }

unsafe def loadDeclIndex (targets : Array Target)
    (importArts : NameMap ImportArtifacts := {}) : IO DeclIndex := do
  initSearchPath (← getBuildDir)
  let mut index : DeclIndex := { compiledImports := .empty importArts }
  for target in targets do
    let .module moduleName := target.origin
      | throw <| IO.userError "live snapshots require prepareSnapshotInput, not filesystem acquisition"
    if index.loadedModules.contains moduleName then
      continue
    let (env, compiledImports) ← importModuleEnvCached moduleName index.compiledImports
    index := { index with compiledImports }
    let mut names : Array Name := #[]
    for decl in moduleDeclarations moduleName env do
      if environmentModuleForDecl? env decl.name != some moduleName then
        continue
      if !Vir.ExportValidation.isExternFallbackClone env decl.name then
        names := names.push decl.name
      let loaded := {
        source := target.publicSource
        module? := some moduleName
        decl
      }
      match index.localDecls.find? decl.name with
      | some existing =>
          if existing.source != loaded.source then
            index := { index with diagnostics := index.diagnostics.push {
              name := decl.name
              source := loaded.source
              reason := s!"declaration name collides with `{existing.source}`; package targets must use unique Lean declaration names"
            } }
      | none =>
          index := { index with localDecls := index.localDecls.insert decl.name loaded }
    let exports ← labelledDecls env `vir_export
    let startups ← labelledDecls env `vir_startup
    index := {
      index with
      virExports := exports.foldl (fun selected name => selected.insert name) index.virExports
      virStartups := startups.foldl (fun selected name => selected.insert name) index.virStartups
      loadedModules := index.loadedModules.insert moduleName
    }
    index := { index with sources := index.sources.push {
      origin := target.origin
      env
      decls := names
    } }
  return index

/-- Index the live environment without reopening its document or compiled root.
Local IR belongs to the current module, including private/generated declarations;
imported owners still come from Lean's module table. The source is provenance. -/
private def snapshotDeclIndex (source : String) (env : Environment) : DeclIndex := Id.run do
  let mut names : Array Name := #[]
  let mut index : DeclIndex := {
    -- Never replace unsaved local IR with the current module's disk artifacts.
    loadedModules := ({} : NameSet).insert env.mainModule
  }
  for decl in getDecls env do
    if !Vir.ExportValidation.isExternFallbackClone env decl.name then
      names := names.push decl.name
    index := {
      index with
      localDecls := index.localDecls.insert decl.name {
        source
        module? := environmentModuleForDecl? env decl.name <|> some env.mainModule
        decl
      }
    }
  return { index with sources := #[{
    origin := .snapshot source env.mainModule
    env
    decls := names
  }] }

/-- A validated live module target and its authoritative, already prepared IR. -/
structure SnapshotInput where
  target : Target
  index : DeclIndex

/-- No frontend, disk lookup or initializer execution. Even imported-only roots
require a module document; the target and local ownership come from this env. -/
def prepareSnapshotInput (document : String) (env : Environment) (roots : Array Name) :
    Except String SnapshotInput := do
  unless env.header.isModule do
    throw "VIR live packages require a `module` header; add `module` to the document (no save is required)"
  return {
    target := { origin := .snapshot document env.mainModule, mode := .explicit roots }
    index := snapshotDeclIndex document env
  }

def DeclIndex.find? (index : DeclIndex) (name : Name) : Option LoadedDecl :=
  match index.sources.findSome? fun source =>
      Vir.ExportValidation.externFallbackClone? source.env name with
  | some clone =>
    match index.localDecls.find? clone <|> importedLoadedDecl? index clone (fun _ => true) with
    | some fallback => fallbackAdapter? index name fallback
    | none => none
  | none =>
    match index.localDecls.find? name with
    | some decl => some decl
    | none =>
      importedLoadedDecl? index name fun decl =>
        match decl with
        | .fdecl .. => true
        | .extern .. => isVirJsDecl decl

private def DeclIndex.loadedModuleGraph
    (index : DeclIndex) : Array Name × NameMap (Array Name) := Id.run do
  let mut modules := #[]
  let mut importsByModule : NameMap (Array Name) := {}
  for source in index.sources do
    let env := source.env
    -- A live root is not an imported module. Record its actual import edges,
    -- rather than appending an ownerless synthetic root after sorting.
    if let .snapshot _ moduleName := source.origin then
      if !modules.contains moduleName then
        modules := modules.push moduleName
      importsByModule := importsByModule.insert moduleName <|
        env.header.imports.filterMap fun imported =>
          if imported.isMeta then none else some imported.module
    for h : moduleIdx in [:env.header.moduleNames.size] do
      let moduleName := env.header.moduleNames[moduleIdx]
      if !modules.contains moduleName then
        modules := modules.push moduleName
      let some data := env.header.moduleData[moduleIdx]? | continue
      let mut imports := importsByModule.find? moduleName |>.getD #[]
      for imported in data.imports do
        -- Meta imports execute while elaborating the module but are not part
        -- of the packaged program's runtime initialization order.
        if imported.isMeta then
          continue
        if !imports.contains imported.module then
          imports := imports.push imported.module
      importsByModule := importsByModule.insert moduleName imports
  return (modules, importsByModule)

/--
Return a dependency-first initialization order across the target environment
and every loaded owner-module environment.

A module-system root environment does not expose modules reached only through
private implementation imports. Package closure resolution loads those owner
modules separately; their module metadata is therefore part of the same order.
The marked root is considered last whenever possible, matching Lean's order
for a direct `import all` driver.
-/
def DeclIndex.moduleInitializationOrderForTarget?
    (index : DeclIndex) (target : Target) : Option (Array Name) := Id.run do
  unless (index.sourceForTarget? target).isSome do
    return none
  let (modules, importsByModule) := index.loadedModuleGraph
  let moduleSet := modules.foldl (init := ({} : NameSet)) fun names moduleName =>
    names.insert moduleName
  let mut remaining := modules
  let mut ordered := #[]
  let mut orderedSet : NameSet := {}
  while !remaining.isEmpty do
    let withoutRoot := remaining.filter (· != target.origin.moduleName)
    let preferred := if withoutRoot.isEmpty then remaining else withoutRoot
    let some next := preferred.find? fun moduleName =>
        (importsByModule.find? moduleName |>.getD #[]).all fun imported =>
          !moduleSet.contains imported || orderedSet.contains imported
      | return none
    ordered := ordered.push next
    orderedSet := orderedSet.insert next
    remaining := remaining.filter (· != next)
  return some ordered

unsafe def DeclIndex.loadImportedModule (index : DeclIndex) (moduleName : Name) : IO DeclIndex := do
  if index.loadedModules.contains moduleName then
    return index
  let (env, compiledImports) ← importModuleEnvCached moduleName index.compiledImports
  let source := s!"module {moduleName}"
  let mut index := {
    index with
    compiledImports
    sources := index.sources.push {
      origin := .module moduleName
      env
    }
    loadedModules := index.loadedModules.insert moduleName
  }
  for decl in getDecls env do
    if environmentModuleForDecl? env decl.name != some moduleName then
      continue
    let loaded : LoadedDecl := { source, module? := some moduleName, decl }
    match index.localDecls.find? decl.name with
    | some existing =>
        if existing.module? != some moduleName then
          index := { index with diagnostics := index.diagnostics.push {
            name := decl.name
            source
            reason := s!"declaration name collides with `{existing.source}` while loading module `{moduleName}`"
          } }
    | none =>
        index := { index with localDecls := index.localDecls.insert decl.name loaded }
  return index

def DeclIndex.initFnNameFor? (index : DeclIndex) (name : Name) : Option Name :=
  index.sources.findSome? fun source => getInitFnNameFor? source.env name

def markedDeclNamesFor (index : DeclIndex) (target : Target) : Array Name :=
  match index.envForTarget? target with
  | none => #[]
  | some env =>
      (index.virExports ∪ index.virStartups).foldl (init := #[]) fun names name =>
        if environmentModuleForDecl? env name == some target.origin.moduleName then
          names.push name
        else names

end Vir.GeneratePackage
