/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Compiler.InitAttr
import Lean.Elab.Frontend
import Lean.LabelAttribute
import Vir.GeneratePackage.Basic

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
  match target.markedModule? with
  | some moduleName => environmentModuleForDecl? env name == some moduleName
  | none => true

def labelledDecls (env : Environment) (attrName : Name) : IO (Array Name) := do
  match (← Lean.labelExtensionMapRef.get)[attrName]? with
  | none => return #[]
  | some ext => return ext.getState env

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
      names := names.push decl.name
      let loaded := {
        source := target.source.toString
        module? := target.markedModule? <|> environmentModuleForDecl? env decl.name
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
      loadedModules := match target.markedModule? with
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

/--
Return Lean's dependency-first module-initialization order for the environment
built from `target`. Lean records a module after recursively visiting its
imports; the caller may filter this complete order to a reached closure.
-/
def DeclIndex.moduleInitializationOrderForTarget?
    (index : DeclIndex) (target : Target) : Option (Array Name) :=
  index.envs.findSome? fun (source, env) =>
    if source == target.source.toString then some env.header.moduleNames else none

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
      match target.markedModule? with
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
