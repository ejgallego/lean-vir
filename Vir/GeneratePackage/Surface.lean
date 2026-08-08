/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import Lean.Compiler.InitAttr
public import Lean.Compiler.MetaAttr
public import Vir.GeneratePackage.Closure
public import Vir.GeneratePackage.Json

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def surfaceReportFormat : String := "lean-vir-library-surface"

def currentSurfaceReportVersion : Nat := 2

/-- Why a transitive IR closure cannot currently be executed by VIR. -/
inductive SurfaceBlockerKind where
  | missingDecl
  | missingExtern
  | unsupportedInitGlobal
  deriving BEq, Repr

def SurfaceBlockerKind.label : SurfaceBlockerKind → String
  | .missingDecl => "missingDecl"
  | .missingExtern => "missingExtern"
  | .unsupportedInitGlobal => "unsupportedInitGlobal"

/-- One terminal blocker reached from an analyzed function. -/
structure SurfaceBlocker where
  kind : SurfaceBlockerKind
  name : Name
  deriving Repr

/-- Classifies IR declarations without counting compiler helpers as public constants. -/
inductive SurfaceDeclKind where
  | publicConstant
  | privateConstant
  | boxed
  | generated
  deriving BEq, Repr

def SurfaceDeclKind.label : SurfaceDeclKind → String
  | .publicConstant => "publicConstant"
  | .privateConstant => "privateConstant"
  | .boxed => "boxed"
  | .generated => "generated"

/-- How VIR currently satisfies an imported Lean extern declaration. -/
inductive SurfaceExternStatus where
  | native
  | host
  | missing
  deriving BEq, Repr

def SurfaceExternStatus.label : SurfaceExternStatus → String
  | .native => "native"
  | .host => "host"
  | .missing => "missing"

/-- Shape of one backend target attached to an extern declaration. -/
inductive SurfaceExternTargetKind where
  | standard
  | inline
  | adhoc
  | opaque
  deriving Repr

def SurfaceExternTargetKind.label : SurfaceExternTargetKind → String
  | .standard => "standard"
  | .inline => "inline"
  | .adhoc => "adhoc"
  | .opaque => "opaque"

structure SurfaceExternTarget where
  kind : SurfaceExternTargetKind
  backend? : Option Name := none
  value? : Option String := none
  deriving Repr

/-- Module-owned extern boundary, kept separate from function coverage counts. -/
structure SurfaceExternResult where
  name : Name
  moduleName : Name
  status : SurfaceExternStatus
  targets : Array SurfaceExternTarget
  deriving Repr

/-- Static closure result for one Lean IR function. -/
structure SurfaceDeclResult where
  name : Name
  moduleName : Name
  kind : SurfaceDeclKind
  runnable : Bool
  blocker? : Option SurfaceBlocker := none
  blockerPath : Array Name := #[]
  deriving Repr

/-- Aggregate counts for a module or complete report. -/
structure SurfaceCounts where
  total : Nat := 0
  runnable : Nat := 0
  publicTotal : Nat := 0
  publicRunnable : Nat := 0
  privateTotal : Nat := 0
  boxedTotal : Nat := 0
  generatedTotal : Nat := 0
  deriving Repr

def SurfaceCounts.blocked (counts : SurfaceCounts) : Nat :=
  counts.total - counts.runnable

def SurfaceCounts.addResult
    (counts : SurfaceCounts) (result : SurfaceDeclResult) : SurfaceCounts :=
  let counts := {
    counts with
    total := counts.total + 1
    runnable := counts.runnable + if result.runnable then 1 else 0
  }
  let counts := match result.kind with
    | .publicConstant => {
        counts with
        publicTotal := counts.publicTotal + 1
        publicRunnable := counts.publicRunnable + if result.runnable then 1 else 0
      }
    | .privateConstant => { counts with privateTotal := counts.privateTotal + 1 }
    | .boxed => { counts with boxedTotal := counts.boxedTotal + 1 }
    | .generated => { counts with generatedTotal := counts.generatedTotal + 1 }
  counts

private def SurfaceCounts.add (lhs rhs : SurfaceCounts) : SurfaceCounts := {
  total := lhs.total + rhs.total
  runnable := lhs.runnable + rhs.runnable
  publicTotal := lhs.publicTotal + rhs.publicTotal
  publicRunnable := lhs.publicRunnable + rhs.publicRunnable
  privateTotal := lhs.privateTotal + rhs.privateTotal
  boxedTotal := lhs.boxedTotal + rhs.boxedTotal
  generatedTotal := lhs.generatedTotal + rhs.generatedTotal
}

/-- Per-module rollup for a surface scan. -/
structure SurfaceModuleResult where
  name : Name
  counts : SurfaceCounts
  deriving Repr

/-- Per-top-level-library rollup for a surface scan. -/
structure SurfaceLibraryResult where
  name : Name
  modulesWithFunctions : Nat
  counts : SurfaceCounts
  deriving Repr

/-- A terminal blocker and the roots for which it is the deterministic primary blocker. -/
structure SurfaceBlockerSummary where
  blocker : SurfaceBlocker
  roots : Nat := 0
  publicRoots : Nat := 0
  exampleRoot : Name := .anonymous
  examplePath : Array Name := #[]
  deriving Repr

/-- Complete static VIR-runnable report for a selected set of Lean modules. -/
structure SurfaceReport where
  selectedModules : Array Name
  loadedModules : Nat
  nativeExterns : Array NativeExtern
  counts : SurfaceCounts
  libraries : Array SurfaceLibraryResult
  modules : Array SurfaceModuleResult
  blockers : Array SurfaceBlockerSummary
  externs : Array SurfaceExternResult
  declarations : Array SurfaceDeclResult

private structure SurfaceNode where
  deps : Array Name := #[]
  blocker? : Option SurfaceBlocker := none

private abbrev SurfaceNameMap (α : Type) := Std.HashMap Name α

private abbrev SurfaceNameSet := Std.HashSet Name

private structure SurfaceGraph where
  nodes : SurfaceNameMap SurfaceNode := {}
  reverse : SurfaceNameMap (List Name) := {}

private structure BlockedBy where
  blocker : SurfaceBlocker
  next? : Option Name := none

private structure CatalogExtern where
  name : Name
  moduleName : Name
  decl : Decl

private def insertUnique (items : Array Name) (name : Name) : Array Name :=
  if items.contains name then items else items.push name

private def uniqueNames (items : Array Name) : Array Name := Id.run do
  let mut seen : SurfaceNameSet := {}
  let mut result := #[]
  for name in items do
    if seen.contains name then
      continue
    seen := seen.insert name
    result := result.push name
  return result

private def SurfaceGraph.addNode
    (graph : SurfaceGraph) (name : Name) (node : SurfaceNode) : SurfaceGraph := Id.run do
  let mut graph := { graph with nodes := graph.nodes.insert name node }
  for dep in node.deps do
    let predecessors := graph.reverse.get? dep |>.getD []
    graph := {
      graph with
      reverse := graph.reverse.insert dep (name :: predecessors)
    }
  return graph

private def nodeFor
    (env : Environment) (decls : SurfaceNameMap Decl)
    (capabilities : SurfaceNameMap NativeExtern) (name : Name) : SurfaceNode :=
  match capabilities.get? name with
  | some ext => { deps := ext.deps }
  | none =>
      match decls.get? name with
      | some decl@(.fdecl ..) =>
          if isUnsupportedInitGlobal decl then
            match getInitFnNameFor? env name with
            | some initName => { deps := #[initName] }
            | none => { blocker? := some { kind := .unsupportedInitGlobal, name } }
          else
            { deps := uniqueNames (refsOfDecl decl) }
      | some decl@(.extern ..) =>
          if isVirJsDecl decl then
            {}
          else
            { blocker? := some { kind := .missingExtern, name } }
      | none =>
          let kind := if isNativeExternCandidate name then .missingExtern else .missingDecl
          { blocker? := some { kind, name } }

private def buildSurfaceGraph
    (env : Environment) (decls : SurfaceNameMap Decl)
    (capabilities : SurfaceNameMap NativeExtern) (roots : Array Name) : SurfaceGraph := Id.run do
  let mut graph : SurfaceGraph := {
    nodes := Std.HashMap.emptyWithCapacity roots.size
    reverse := Std.HashMap.emptyWithCapacity roots.size
  }
  let mut expanded : SurfaceNameSet := Std.HashSet.emptyWithCapacity roots.size
  let mut pending := roots
  let mut scheduled := roots.foldl (fun names name => names.insert name)
    (Std.HashSet.emptyWithCapacity roots.size : SurfaceNameSet)
  let mut cursor := 0
  while cursor < pending.size do
    let name := pending[cursor]!
    cursor := cursor + 1
    if expanded.contains name then
      continue
    expanded := expanded.insert name
    let node := nodeFor env decls capabilities name
    graph := graph.addNode name node
    for dep in node.deps do
      if !scheduled.contains dep then
        scheduled := scheduled.insert dep
        pending := pending.push dep
  return graph

private def propagateBlockers (graph : SurfaceGraph) : SurfaceNameMap BlockedBy := Id.run do
  let mut terminals : Array (Name × SurfaceBlocker) := #[]
  for (name, node) in graph.nodes.toList do
    if let some blocker := node.blocker? then
      terminals := terminals.push (name, blocker)
  terminals := terminals.qsort fun lhs rhs => lhs.1.quickLt rhs.1
  let mut blocked : SurfaceNameMap BlockedBy :=
    Std.HashMap.emptyWithCapacity graph.nodes.size
  let mut pending : Array Name := #[]
  for (name, blocker) in terminals do
    blocked := blocked.insert name { blocker }
    pending := pending.push name
  let mut cursor := 0
  while cursor < pending.size do
    let name := pending[cursor]!
    cursor := cursor + 1
    let some blockedBy := blocked.get? name | continue
    for predecessor in graph.reverse.get? name |>.getD [] do
      if blocked.contains predecessor then
        continue
      blocked := blocked.insert predecessor { blocker := blockedBy.blocker, next? := some name }
      pending := pending.push predecessor
  return blocked

private def blockerPathFor
    (blocked : SurfaceNameMap BlockedBy) (maxDepth : Nat) (root : Name) : Array Name := Id.run do
  let mut path := #[root]
  let mut current := root
  let mut remaining := maxDepth
  while remaining > 0 do
    remaining := remaining - 1
    let some info := blocked.get? current | break
    let some next := info.next? | break
    path := path.push next
    current := next
  return path

private def declKind (env : Environment) (name : Name) : SurfaceDeclKind :=
  if (boxedBaseName? name).isSome then
    .boxed
  else if isPrivateName name then
    .privateConstant
  else if (env.find? name).isSome then
    .publicConstant
  else
    .generated

private def moduleForSurfaceDecl (env : Environment) (name : Name) : Name :=
  match env.getModuleIdxFor? name with
  | some moduleIdx => env.header.modules[moduleIdx]?.map (·.module) |>.getD .anonymous
  | none => .anonymous

private def resultFor
    (env : Environment) (blocked : SurfaceNameMap BlockedBy) (maxPathDepth : Nat)
    (name : Name) : SurfaceDeclResult :=
  match blocked.get? name with
  | none => {
      name
      moduleName := moduleForSurfaceDecl env name
      kind := declKind env name
      runnable := true
    }
  | some info => {
      name
      moduleName := moduleForSurfaceDecl env name
      kind := declKind env name
      runnable := false
      blocker? := some info.blocker
      blockerPath := blockerPathFor blocked maxPathDepth name
    }

private def aggregateModules (results : Array SurfaceDeclResult) : Array SurfaceModuleResult := Id.run do
  let mut countsByModule : SurfaceNameMap SurfaceCounts :=
    Std.HashMap.emptyWithCapacity 4096
  for result in results do
    let counts := countsByModule.get? result.moduleName |>.getD {}
    countsByModule := countsByModule.insert result.moduleName (counts.addResult result)
  let mut modules := countsByModule.toList.toArray.map fun (name, counts) => ({ name, counts })
  modules := modules.qsort fun lhs rhs => lhs.name.toString < rhs.name.toString
  return modules

private def rootName : Name → Name
  | .str .anonymous part => .str .anonymous part
  | .str pre _ => rootName pre
  | .num pre _ => rootName pre
  | .anonymous => .anonymous

private def aggregateLibraries
    (modules : Array SurfaceModuleResult) : Array SurfaceLibraryResult := Id.run do
  let mut libraries : SurfaceNameMap SurfaceLibraryResult := {}
  for moduleResult in modules do
    let root := rootName moduleResult.name
    let previous := libraries.get? root |>.getD {
      name := root
      modulesWithFunctions := 0
      counts := {}
    }
    libraries := libraries.insert root {
      previous with
      modulesWithFunctions := previous.modulesWithFunctions + 1
      counts := previous.counts.add moduleResult.counts
    }
  let mut results := libraries.toList.toArray.map (·.2)
  results := results.qsort fun lhs rhs => lhs.name.toString < rhs.name.toString
  return results

private def summarizeBlockers (results : Array SurfaceDeclResult) : Array SurfaceBlockerSummary := Id.run do
  let mut summaries : SurfaceNameMap SurfaceBlockerSummary := {}
  for result in results do
    let some blocker := result.blocker? | continue
    match summaries.get? blocker.name with
    | some summary =>
        summaries := summaries.insert blocker.name {
          summary with
          roots := summary.roots + 1
          publicRoots := summary.publicRoots + if result.kind == .publicConstant then 1 else 0
        }
    | none =>
        summaries := summaries.insert blocker.name {
          blocker
          roots := 1
          publicRoots := if result.kind == .publicConstant then 1 else 0
          exampleRoot := result.name
          examplePath := result.blockerPath
        }
  let summariesArray := summaries.toList.toArray.map (·.2)
  return summariesArray.qsort fun lhs rhs =>
    lhs.roots > rhs.roots ||
      (lhs.roots == rhs.roots && lhs.blocker.name.toString < rhs.blocker.name.toString)

private def externTarget : ExternEntry → SurfaceExternTarget
  | .standard backend value => { kind := .standard, backend? := some backend, value? := some value }
  | .inline backend value => { kind := .inline, backend? := some backend, value? := some value }
  | .adhoc backend => { kind := .adhoc, backend? := some backend }
  | .opaque => { kind := .opaque }

private def externResult
    (capabilities : SurfaceNameMap NativeExtern) (catalog : CatalogExtern) : SurfaceExternResult :=
  let status :=
    if capabilities.contains catalog.name then
      SurfaceExternStatus.native
    else if isVirJsDecl catalog.decl then
      SurfaceExternStatus.host
    else
      SurfaceExternStatus.missing
  let targets := match catalog.decl with
    | .extern _ _ _ data => data.entries.toArray.map externTarget
    | _ => #[]
  { name := catalog.name, moduleName := catalog.moduleName, status, targets }

private def catalogDecls
    (env : Environment) (selectedModules : SurfaceNameSet) :
    SurfaceNameMap Decl × Array Name × Array CatalogExtern := Id.run do
  let capacity := env.header.moduleData.foldl
    (fun size data => size + data.constNames.size + data.extraConstNames.size) 0
  let mut decls : SurfaceNameMap Decl := Std.HashMap.emptyWithCapacity capacity
  let mut roots : Array Name := #[]
  let mut externs : Array CatalogExtern := #[]
  for moduleIdx in [0:env.header.moduleData.size] do
    let data := env.header.moduleData[moduleIdx]!
    let moduleName := env.header.modules[moduleIdx]!.module
    for name in data.constNames ++ data.extraConstNames do
      if decls.contains name then
        continue
      let some decl := findEnvDecl env name | continue
      decls := decls.insert name decl
      if selectedModules.contains moduleName then
        match decl with
        | .fdecl .. => roots := roots.push name
        | .extern .. => externs := externs.push { name, moduleName, decl }
  roots := roots.qsort fun lhs rhs => lhs.quickLt rhs
  externs := externs.qsort fun lhs rhs =>
    lhs.moduleName.toString < rhs.moduleName.toString ||
      (lhs.moduleName == rhs.moduleName && lhs.name.toString < rhs.name.toString)
  return (decls, roots, externs)

/-- Analyze all IR functions owned by `selectedModules` in one imported environment. -/
def analyzeLibrarySurface
    (env : Environment) (selectedModules : Array Name)
    (nativeExterns : Array NativeExtern) : SurfaceReport :=
  let selectedSet := selectedModules.foldl (fun names name => names.insert name)
    (Std.HashSet.emptyWithCapacity selectedModules.size : SurfaceNameSet)
  let (decls, roots, catalogExterns) := catalogDecls env selectedSet
  let capabilities := nativeExterns.foldl (fun capabilities ext => capabilities.insert ext.name ext)
    (Std.HashMap.emptyWithCapacity nativeExterns.size : SurfaceNameMap NativeExtern)
  let graph := buildSurfaceGraph env decls capabilities roots
  let blocked := propagateBlockers graph
  let maxPathDepth := graph.nodes.size + 1
  let declarations := roots.map (resultFor env blocked maxPathDepth)
  let counts := declarations.foldl (fun counts result => counts.addResult result) {}
  let modules := aggregateModules declarations
  {
    selectedModules
    loadedModules := env.header.moduleNames.size
    nativeExterns
    counts
    libraries := aggregateLibraries modules
    modules
    blockers := summarizeBlockers declarations
    externs := catalogExterns.map (externResult capabilities)
    declarations
  }

private def nameFromPathParts (parts : List String) : Name :=
  parts.foldl (fun name part => .str name part) .anonymous

private def moduleNameFromIRPath? (libDir path : System.FilePath) : Option Name := do
  guard (path.extension == some "ir")
  let parts := path.withExtension "" |>.components.drop libDir.components.length
  guard (!parts.isEmpty)
  return nameFromPathParts parts

/-- Discover installed `.ir` modules below the requested top-level Lean libraries. -/
def discoverInstalledLibraryModules
    (libraryRoots : Array Name := #[`Init, `Lean, `Std, `Lake]) : IO (Array Name) := do
  let libDir ← getLibDir (← findSysroot)
  let selectedRoots := libraryRoots.foldl (fun names name => names.insert name)
    (Std.HashSet.emptyWithCapacity libraryRoots.size : SurfaceNameSet)
  let mut modules : Array Name := #[]
  for path in ← libDir.walkDir do
    let some moduleName := moduleNameFromIRPath? libDir path | continue
    let root := rootName moduleName
    if selectedRoots.contains root then
      modules := insertUnique modules moduleName
  return modules.qsort fun lhs rhs => lhs.toString < rhs.toString

/-- Import complete IR for all selected modules into one host analysis environment. -/
unsafe def loadLibrarySurfaceEnvironment (modules : Array Name) : IO Environment := do
  enableInitializersExecution
  initSearchPath (← findSysroot)
  let imports := modules.map fun moduleName => ({ module := moduleName, importAll := true } : Import)
  let opts := Elab.async.set ({} : Options) false
  importModules (loadExts := true) imports opts

end Vir.GeneratePackage
