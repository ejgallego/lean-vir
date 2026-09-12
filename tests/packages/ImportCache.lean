/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import Lean.Compiler.IR.Format
import Vir.GeneratePackage.Inputs
import Vir.Host
public meta import Vir.GeneratePackage.Inputs
public meta import Vir.Host
public meta import Lean.Compiler.IR.Format
public meta import Lean.Util.Path

meta section

open Lean Lean.IR Vir.GeneratePackage

private def expect (label : String) (ok : Bool) : IO Unit := do
  unless ok do throw <| IO.userError s!"import cache: {label}"

private def importsFor (name : Name) : Array Import := #[
  { module := `Init },
  { module := `Init, isMeta := true },
  { module := name, importAll := true, isExported := false }
]

private def options : Options := Elab.async.set {} false

-- The cache API must not let callers keep regions while changing resolution.
example (_cache : CompiledImportCache) : True := by
  fail_if_success
    let _changed : CompiledImportCache := { _cache with importArts := {} }
  trivial

private unsafe def independent (imports : Array Import)
    (arts : NameMap ImportArtifacts) : IO Environment := do
  enableInitializersExecution
  Lean.importModules imports options (loadExts := true) (level := .exported) (arts := arts)

private unsafe def cachedImport (cache : CompiledImportCache) (imports : Array Import) :
    IO (Environment × CompiledImportCache) := do
  enableInitializersExecution
  cache.importModules imports options

private def checkEnvironment (label : String) (expected actual : Environment) : IO Unit := do
  expect s!"{label}: module header" <|
    expected.header.isModule == actual.header.isModule &&
    expected.header.imports == actual.header.imports &&
    expected.header.moduleNames == actual.header.moduleNames &&
    expected.header.modules.size == actual.header.modules.size
  for a in expected.header.modules, b in actual.header.modules do
    expect s!"{label}: effective import {a.module}" <|
      a.toImport == b.toImport && a.hasData == b.hasData && a.irPhases == b.irPhases
  for h : i in [:expected.header.moduleNames.size] do
    let name := expected.header.moduleNames[i]
    let a := declMapExt.getModuleIREntries expected i ++ declMapExt.getModuleEntries expected i
    let b := declMapExt.getModuleIREntries actual i ++ declMapExt.getModuleEntries actual i
    expect s!"{label}: IR inventory/bodies {name}" <| a.map toString == b.map toString
    for decl in a do
      expect s!"{label}: owner {decl.name}" <|
        environmentModuleForDecl? expected decl.name == environmentModuleForDecl? actual decl.name
      expect s!"{label}: initializer {decl.name}" <|
        getInitFnNameFor? expected decl.name == getInitFnNameFor? actual decl.name
    let aData := expected.header.moduleData[i]!
    let bData := actual.header.moduleData[i]!
    expect s!"{label}: direct import graph {name}" <| aData.imports == bData.imports
    for declName in aData.constNames do
      expect s!"{label}: constant visibility/type {declName}" <|
        (expected.find? declName |>.map (·.type)) == (actual.find? declName |>.map (·.type))
  for attr in #[`vir_export, `vir_startup] do
    expect s!"{label}: markers {attr}" <|
      (← labelledDecls expected attr) == (← labelledDecls actual attr)

private def partCount (entries : NameMap (Array (ModuleData × CompactedRegion))) : Nat :=
  entries.foldl (fun count _ parts => count + parts.size) 0

private unsafe def checkReuse (before after : CompiledImportCache) : IO Unit := do
  expect "repeated import added data parts" <| partCount before.data == partCount after.data
  expect "repeated import added IR parts" <| partCount before.ir == partCount after.ir
  -- Pointer identity is checked only as a resource invariant, never used to
  -- decide semantic equality. Full dependency-linked region groups stay shared.
  for entries in #[(before.data, after.data), (before.ir, after.ir)] do
    for (name, parts) in entries.1 do
      let some next := entries.2.find? name
        | throw <| IO.userError s!"import cache: dropped {name}"
      expect s!"{name}: region count changed" <| parts.size == next.size
      for a in parts, b in next do
        expect s!"{name}: remapped a cached region" <| ptrEq a.2 b.2

private unsafe def checkResolution (arts : NameMap ImportArtifacts) (name : Name) : IO Unit := do
  if arts.isEmpty then return
  -- No conventional project search path is available in resolved mode. A new
  -- context missing this root must fail, even after the successful cached reads.
  let mut rejected := false
  try
    discard <| cachedImport (.empty (arts.erase name)) (importsFor name)
  catch _ => rejected := true
  expect "fresh resolution context reused an earlier root" rejected

private unsafe def checkModule (arts : NameMap ImportArtifacts) : IO Unit := do
  let selected := `ModuleSetFixture.InputSelection
  let imports := importsFor selected
  let baseline ← independent imports arts
  let (cached, cache) ← cachedImport (.empty arts) imports
  checkEnvironment "selected root" baseline cached
  let privateDecls := moduleDeclarations selected cached |>.filter (isPrivateName ·.name)
  expect "private input IR was not loaded" <| !privateDecls.isEmpty
  for decl in privateDecls do
    expect "private input owner changed" <| environmentModuleForDecl? cached decl.name == some selected

  -- A context loaded after the richer root must not inherit that root's names,
  -- import-all flags, hidden implementation modules, or markers.
  let leftImports := importsFor `ModuleSetFixture.Left
  let leftBaseline ← independent leftImports arts
  let (left, cache) ← cachedImport cache leftImports
  checkEnvironment "isolated left" leftBaseline left
  expect "unrelated root leaked into left" <| (left.find? `ModuleSetFixture.Root.answer).isNone
  expect "private selected declaration leaked into left" <|
    privateDecls.all (fun decl => (left.find? decl.name).isNone)

  -- Same dependency first public, then private-all/meta: exercise both data
  -- visibility and IR-phase joins within one import graph.
  let upgraded := (importsFor `ModuleSetFixture.Left).push {
    module := `ModuleSetFixture.Shared, importAll := true, isExported := false, isMeta := true
  }
  let upgradeBaseline ← independent upgraded arts
  let (upgrade, cache) ← cachedImport cache upgraded
  checkEnvironment "import-level upgrade" upgradeBaseline upgrade

  -- Closure resolution opens private implementation owners separately.
  let ownerImports := importsFor `ModuleSetFixture.InternalBase
  let ownerBaseline ← independent ownerImports arts
  let (owner, cache) ← cachedImport cache ownerImports
  checkEnvironment "private implementation owner" ownerBaseline owner
  expect "owner initializer missing" <| (getInitFnNameFor? owner `ModuleSetFixture.InternalBase.value).isSome
  let (again, after) ← cachedImport cache imports
  checkEnvironment "root after other contexts" baseline again
  checkReuse cache after
  checkResolution arts selected

private unsafe def checkHost (arts : NameMap ImportArtifacts) : IO Unit := do
  let name := `fixtures.HostInterop
  let imports := importsFor name
  let baseline ← independent imports arts
  let (cached, cache) ← cachedImport (.empty arts) imports
  checkEnvironment "host fixture" baseline cached
  let mut hostCount := 0
  let mut privateCount := 0
  for decl in moduleDeclarations name cached do
    if let some a := virJsAttr.getParam? baseline decl.name then
      let some b := virJsAttr.getParam? cached decl.name
        | throw <| IO.userError s!"import cache: host metadata missing for {decl.name}"
      expect s!"host metadata target {decl.name}" <| a.target == b.target
      expect s!"host metadata analysis {decl.name}" <|
        a.analysis.boundary == b.analysis.boundary &&
        a.analysis.signature.args.map (fun arg => (arg.name, arg.type)) ==
          b.analysis.signature.args.map (fun arg => (arg.name, arg.type)) &&
        a.analysis.signature.result == b.analysis.signature.result &&
        a.analysis.signature.effect == b.analysis.signature.effect &&
        a.analysis.signature.erasedPrefixArgs == b.analysis.signature.erasedPrefixArgs
      hostCount := hostCount + 1
      if isPrivateName decl.name then privateCount := privateCount + 1
  expect "host fixture metadata check was vacuous" <| hostCount > 0 && privateCount > 0
  let (again, after) ← cachedImport cache imports
  checkEnvironment "repeated host fixture" baseline again
  checkReuse cache after
  checkResolution arts name

/-- Run cases separately: upstream imports intentionally do not share regions,
so retaining every reference oracle in one process would inflate the test itself. -/
public unsafe def main (args : List String) : IO Unit := do
  enableInitializersExecution
  initSearchPath (← getBuildDir)
  let (mode, arts) ← match args with
    | [mode] => pure (mode, {})
    | [mode, setup] => do
      let setup ← ModuleSetup.load setup
      expect "resolved artifact map is empty" (!setup.importArts.isEmpty)
      -- The frontend has already loaded the test itself. Runtime imports may
      -- now find project modules only through the explicit relocated mapping;
      -- toolchain modules still exercise conventional fallback reads.
      searchPathRef.set [(← getBuildDir) / "lib" / "lean"]
      pure (mode, setup.importArts)
    | _ => throw <| IO.userError "usage: ImportCache.lean module|host [setup.json]"
  match mode with
  | "module" => checkModule arts
  | "host" => checkHost arts
  | _ => throw <| IO.userError s!"unknown import cache case: {mode}"
  IO.println s!"import cache equivalence ok: {args.head!}"
