/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Frontend
public import Vir.GeneratePackage.NativeExterns

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def addInitGlobal (name initName : Name) (state : Closure) : Closure :=
  if state.initGlobalSeen.contains name then
    state
  else
    { state with
      initGlobalSeen := state.initGlobalSeen.insert name
      initGlobals := state.initGlobals.push { name, initName } }

def DeclIndex.resolveNativeExtern? (index : DeclIndex) (spec : NativeExternSpec) : Option NativeExtern :=
  index.sources.findSome? fun source => spec.resolve source.env |>.toOption

private def DeclIndex.selectedNativeExternSpec?
    (index : DeclIndex) (name : Name) : Option NativeExternSpec :=
  nativeExternSpec? name <|> index.clientNativeExternSpecs.find? (·.name == name)

partial def collectName
    (index : DeclIndex)
    (name : Name)
    (path : Array Name)
    (state : Closure) : Closure :=
  if state.seen.contains name then
    state
  else
    let state := { state with seen := state.seen.insert name }
    match index.selectedNativeExternSpec? name with
    | some spec =>
        match index.resolveNativeExtern? spec with
        | some ext =>
            let state := { state with externs := state.externs.push ext }
            spec.deps.foldl (fun state dep => collectName index dep (path.push dep) state) state
        | none =>
            { state with missingExterns := state.missingExterns.push { name, path } }
    | none =>
        match index.find? name with
        | none =>
            let dependency : ClosureDependency := { name := name, path := path }
            if isNativeExternCandidate name then
              { state with missingExterns := state.missingExterns.push dependency }
            else
              { state with missingDecls := state.missingDecls.push dependency }
        | some loaded =>
            if isUnsupportedInitGlobal loaded.decl then
              match index.initFnNameFor? name with
              | some initName =>
                  let state := { state with decls := state.decls.push loaded }
                  let state := collectName index initName (path.push initName) state
                  addInitGlobal name initName state
              | none =>
                  { state with
                    decls := state.decls.push loaded
                    unsupportedInitGlobals := state.unsupportedInitGlobals.push {
                      name := name
                      path := path
                    } }
            else
              let state := { state with decls := state.decls.push loaded }
              refsOfDecl loaded.decl |>.foldl
                (fun state dep => collectName index dep (path.push dep) state) state

def rootsForTarget (index : DeclIndex) (target : Target) : Array Name :=
  match target.mode with
  | .all =>
      index.sourceForTarget? target |>.map (fun source => source.decls) |>.getD #[]
  | .marked | .markedModule _ => markedDeclNamesFor index target
  | .explicit roots | .packageOnly roots => roots

def boxedBaseName? : Name -> Option Name
  | .str pre "_boxed" => some pre
  | _ => none

def boxedName (name : Name) : Name :=
  .str name "_boxed"

def resolvedRootsForTarget (index : DeclIndex) (target : Target) : Array Name :=
  rootsForTarget index target |>.foldl (fun roots root =>
    let roots := if roots.contains root then roots else roots.push root
    match boxedBaseName? root with
    | some _ => roots
    | none =>
        let boxed := boxedName root
        if (index.find? boxed).isSome && !roots.contains boxed then
          roots.push boxed
        else
          roots) #[]

def collectClosure (targets : Array Target) (index : DeclIndex) : Closure :=
  targets.foldl (fun state target =>
    (resolvedRootsForTarget index target).foldl
      (fun state root => collectName index root #[root] state) state) {}

private def DeclIndex.opaqueImportedModuleForDecl?
    (index : DeclIndex) (name : Name) : Option Name :=
  index.sources.findSome? fun source => do
    let env := source.env
    let decl ← findEnvDecl env name
    if isOpaqueExternDecl decl then
      environmentModuleForDecl? env name
    else
      none

/--
Complete a package closure by loading compiled IR from each newly discovered
opaque declaration owner. This belongs to the IO generation pipeline, not to a
target-selection mode: every target kind has the same ownership semantics.
-/
unsafe def resolveImportedModuleClosure
    (targets : Array Target)
    (index : DeclIndex) : IO DeclIndex := do
  let closure := collectClosure targets index
  let deferred := closure.missingDecls ++ closure.missingExterns
  let modules := deferred.foldl (init := #[]) fun modules dependency =>
    match index.opaqueImportedModuleForDecl? dependency.name with
    | some moduleName =>
        if index.loadedModules.contains moduleName || modules.contains moduleName then
          modules
        else
          modules.push moduleName
    | none => modules
  if modules.isEmpty then
    return index
  let next ← modules.foldlM (fun index moduleName => index.loadImportedModule moduleName) index
  resolveImportedModuleClosure targets next

def Closure.moduleNames (closure : Closure) : Array Name :=
  closure.decls.foldl (init := #[]) fun modules loaded =>
    match loaded.module? with
    | some moduleName =>
        if modules.contains moduleName then modules else modules.push moduleName
    | none => modules

/--
Filter the dependency-first order reconstructed from Lean's loaded module
graphs to the modules reached by the package closure. The root is appended only
for the legacy source path, where its declarations do not carry imported-module
ownership.
-/
def Closure.moduleInitializationOrder
    (closure : Closure)
    (index : DeclIndex)
    (target : Target)
    (rootModule : Name) : Except String (Array Name) := do
  let ownedModules := closure.moduleNames
  let reachedModules := ownedModules.foldl
    (fun (modules : NameSet) moduleName => modules.insert moduleName) ({} : NameSet)
  let reachedModules := reachedModules.insert rootModule
  let some importedOrder := index.moduleInitializationOrderForTarget? target
    | throw s!"no Lean module order is available for package-set target `{target.source}`"
  let ordered := importedOrder.filter reachedModules.contains
  let ordered := if ordered.contains rootModule then ordered else ordered.push rootModule
  let missing := ownedModules.filter fun moduleName => !ordered.contains moduleName
  if !missing.isEmpty then
    let names := ", ".intercalate (missing.map (·.toString)).toList
    throw s!"reached package modules are absent from Lean's module order: {names}"
  if ordered.back? != some rootModule then
    throw s!"root module `{rootModule}` is not last in Lean's module order"
  return ordered

def Closure.forModule (closure : Closure) (moduleName rootModule : Name) : Closure :=
  let isRoot := moduleName == rootModule
  let owns (loaded : LoadedDecl) :=
    loaded.module? == some moduleName || (isRoot && loaded.module?.isNone)
  let decls := closure.decls.filter owns
  let ownedDeclNames : NameSet := decls.foldl
    (fun names loaded => names.insert loaded.decl.name) {}
  let allDeclNames : NameSet := closure.decls.foldl
    (fun names loaded => names.insert loaded.decl.name) {}
  let initOwned (entry : InitGlobal) :=
    ownedDeclNames.contains entry.name || (isRoot && !allDeclNames.contains entry.name)
  {
    decls
    externs := if isRoot then closure.externs else #[]
    initGlobals := closure.initGlobals.filter initOwned
  }

end Vir.GeneratePackage
