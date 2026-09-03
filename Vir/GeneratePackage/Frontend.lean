/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import Lean.Compiler.InitAttr
import Lean.Elab.Frontend
import Lean.LabelAttribute
import Vir.ExportValidation
public import Vir.GeneratePackage.Basic

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def moduleNameFor (path : System.FilePath) : Name :=
  .str (.str `VirIRInput (path.fileStem.getD "Input")) "Generated"

unsafe def frontendEnv (target : Target) : IO Environment := do
  -- Match Lean's CLI startup path: the frontend imports modules with loaded extensions.
  enableInitializersExecution
  let contents <- IO.FS.readFile target.source
  let opts := Elab.async.set ({} : Options) false
  let fileName := target.source.toString
  match <- Elab.runFrontend contents opts fileName (moduleNameFor target.source) with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed for {fileName}"

unsafe def frontendImportedModuleEnv (moduleName : Name) : IO Environment := do
  enableInitializersExecution
  let contents := s!"module\nimport all {moduleName}\n"
  let opts := Elab.async.set ({} : Options) false
  let fileName := s!"<VIR imported module {moduleName}>"
  let driverModule := .str (.str `VirIRInput moduleName.toString) "Generated"
  match ← Elab.runFrontend contents opts fileName driverModule with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed while importing all IR for `{moduleName}`"

def environmentModuleForDecl? (env : Environment) (name : Name) : Option Name := do
  let moduleIdx ← env.getModuleIdxFor? name
  env.header.moduleNames[moduleIdx]?

def targetOwnsDecl (target : Target) (env : Environment) (name : Name) : Bool :=
  match target.mode.markedModule? with
  | some moduleName => environmentModuleForDecl? env name == some moduleName
  | none => true

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
  findImported := index.envs.findSome? fun (_, env) => do
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

unsafe def loadDeclIndex (targets : Array Target) : IO DeclIndex := do
  initSearchPath (← getBuildDir)
  let mut index : DeclIndex := {}
  for target in targets do
    let env <- frontendEnv target
    let mut names : Array Name := #[]
    index := { index with envs := index.envs.push (target.source.toString, env) }
    for decl in getDecls env do
      if !targetOwnsDecl target env decl.name then
        continue
      if !Vir.ExportValidation.isExternFallbackClone env decl.name then
        names := names.push decl.name
      let loaded := {
        source := target.source.toString
        module? := target.mode.markedModule? <|> environmentModuleForDecl? env decl.name
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
      loadedModules := match target.mode.markedModule? with
        | some moduleName => index.loadedModules.insert moduleName
        | none => index.loadedModules
    }
    index := { index with sourceDecls := index.sourceDecls.push (target.source.toString, names) }
  return index

def declIndexFromEnvironment (source : String) (env : Environment) : DeclIndex := Id.run do
  let mut names : Array Name := #[]
  let mut index : DeclIndex := {
    envs := #[(source, env)]
  }
  for decl in getDecls env do
    if !Vir.ExportValidation.isExternFallbackClone env decl.name then
      names := names.push decl.name
    index := {
      index with
      localDecls := index.localDecls.insert decl.name {
        source
        module? := environmentModuleForDecl? env decl.name
        decl
      }
    }
  return { index with sourceDecls := #[(source, names)] }

def DeclIndex.find? (index : DeclIndex) (name : Name) : Option LoadedDecl :=
  match index.envs.findSome? fun (_, env) => Vir.ExportValidation.externFallbackClone? env name with
  | some clone =>
    match index.localDecls.find? clone with
    | some fallback => fallbackAdapter? index name fallback
    | none => none
  | none =>
    match index.localDecls.find? name with
    | some decl => some decl
    | none =>
      index.envs.findSome? fun (source, env) => do
        let decl <- findEnvDecl env name
        match decl with
        | .fdecl .. => some {
            source := s!"imported by {source}"
            module? := environmentModuleForDecl? env name
            decl
          }
        | .extern .. =>
            if isVirJsDecl decl then
              some {
                source := s!"imported by {source}"
                module? := environmentModuleForDecl? env name
                decl
              }
            else
              none

def DeclIndex.moduleForDecl? (index : DeclIndex) (name : Name) : Option Name :=
  match index.localDecls.find? name |>.bind (·.module?) with
  | some moduleName => some moduleName
  | none => index.envs.findSome? fun (_, env) => environmentModuleForDecl? env name

private def DeclIndex.loadedModuleGraph
    (index : DeclIndex) : Array Name × NameMap (Array Name) := Id.run do
  let mut modules := #[]
  let mut importsByModule : NameMap (Array Name) := {}
  for (_, env) in index.envs do
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
  unless index.envs.any (fun (source, _) => source == target.source.toString) do
    return none
  let (modules, importsByModule) := index.loadedModuleGraph
  let moduleSet := modules.foldl (init := ({} : NameSet)) fun names moduleName =>
    names.insert moduleName
  let mut remaining := modules
  let mut ordered := #[]
  let mut orderedSet : NameSet := {}
  while !remaining.isEmpty do
    let preferred := match target.mode.markedModule? with
      | some rootModule =>
          let withoutRoot := remaining.filter (· != rootModule)
          if withoutRoot.isEmpty then remaining else withoutRoot
      | none => remaining
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
  let env ← frontendImportedModuleEnv moduleName
  let source := s!"module {moduleName}"
  let mut index := {
    index with
    envs := index.envs.push (source, env)
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
  index.envs.findSome? fun (_, env) => getInitFnNameFor? env name

def markedDeclNamesFor (index : DeclIndex) (target : Target) : Array Name :=
  match index.envs.findSome? (fun (source, env) =>
      if source == target.source.toString then some env else none) with
  | none => #[]
  | some env =>
      match target.mode.markedModule? with
      | some moduleName =>
          (index.virExports ∪ index.virStartups).foldl (init := #[]) fun names name =>
            match env.getModuleIdxFor? name with
            | some moduleIdx =>
                if env.header.moduleNames[moduleIdx]? == some moduleName then names.push name else names
            | none => names
      | none =>
          index.sourceDecls.findSome? (fun (source, names) =>
            if source == target.source.toString then some names else none) |>.getD #[]
          |>.filter fun name =>
            index.virExports.contains name || index.virStartups.contains name

end Vir.GeneratePackage
