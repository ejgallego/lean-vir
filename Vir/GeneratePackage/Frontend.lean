/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

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
      names := names.push decl.name
      let loaded := { source := target.source.toString, decl }
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
      localDecls := index.localDecls.insert decl.name { source, decl }
    }
  return { index with sourceDecls := #[(source, names)] }

def DeclIndex.find? (index : DeclIndex) (name : Name) : Option LoadedDecl :=
  match index.localDecls.find? name with
  | some decl => some decl
  | none =>
      index.envs.findSome? fun (source, env) => do
        let decl <- findEnvDecl env name
        match decl with
        | .fdecl .. => some { source := s!"imported by {source}", decl }
        | .extern .. =>
            if isVirJsDecl decl then
              some { source := s!"imported by {source}", decl }
            else
              none

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
