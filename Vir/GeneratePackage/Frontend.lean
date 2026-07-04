/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Basic

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def jsExternPrefix : String := "__vir_js:"

def jsExplicitConversionExternPrefix : String := "__vir_js_explicit_conversion:"

def externTargetWithPrefix? (pfx symbol : String) : Option String :=
  if symbol.startsWith pfx then
    some (symbol.drop pfx.length).toString
  else
    none

def virJsTargetFromExternData? (data : ExternAttrData) : Option String :=
  data.entries.findSome? fun entry =>
    match entry with
    | .standard _ symbol =>
        externTargetWithPrefix? jsExternPrefix symbol <|>
          externTargetWithPrefix? jsExplicitConversionExternPrefix symbol
    | _ => none

def virJsTargetFromDecl? : Decl → Option String
  | .extern _ _ _ data => virJsTargetFromExternData? data
  | _ => none

def isVirJsDecl (decl : Decl) : Bool :=
  virJsTargetFromDecl? decl |>.isSome

def virJsExplicitConversionTargetFromExternData? (data : ExternAttrData) : Option String :=
  data.entries.findSome? fun entry =>
    match entry with
    | .standard _ symbol => externTargetWithPrefix? jsExplicitConversionExternPrefix symbol
    | _ => none

def isVirJsExplicitConversionDecl : Decl → Bool
  | .extern _ _ _ data => virJsExplicitConversionTargetFromExternData? data |>.isSome
  | _ => false

def dropEvalCommandLines (input : String) : String :=
  "\n".intercalate <|
    input.splitOn "\n" |>.filter fun line =>
      !(line.trimAsciiStart.copy.startsWith "#eval")

def frontendSource (target : Target) (contents : String) : String :=
  if target.dropEvalCommands then
    dropEvalCommandLines contents
  else
    contents

def moduleNameFor (path : System.FilePath) : Name :=
  .str (.str `VirIRInput (path.fileStem.getD "Input")) "Generated"

unsafe def frontendEnv (target : Target) : IO Environment := do
  -- Match Lean's CLI startup path: the frontend imports modules with loaded extensions.
  enableInitializersExecution
  let contents <- IO.FS.readFile target.source
  let opts := Elab.async.set ({} : Options) false
  let fileName := target.source.toString
  match <- Elab.runFrontend (frontendSource target contents) opts fileName (moduleNameFor target.source) with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed for {fileName}"

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

end Vir.GeneratePackage
