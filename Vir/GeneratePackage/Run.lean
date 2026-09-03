/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Emit
public import Vir.GeneratePackage.Report
import Vir.ClientNativeExternManifest

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def readTextFile? (path : System.FilePath) : IO (Option String) := do
  try
    return some (← IO.FS.readFile path)
  catch _ =>
    return none

def readBinFile? (path : System.FilePath) : IO (Option ByteArray) := do
  try
    return some (← IO.FS.readBinFile path)
  catch _ =>
    return none

def writeTextFile (path : System.FilePath) (content : String) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readTextFile? path) != some content then
    IO.FS.writeFile path content

def writeBinFile (path : System.FilePath) (content : ByteArray) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readBinFile? path) != some content then
    IO.FS.writeBinFile path content

def generatedAtUtc : IO String := do
  try
    let out <- IO.Process.output {
      cmd := "date"
      args := #["-u", "+%Y-%m-%dT%H:%M:%SZ"]
    }
    if out.exitCode == 0 then
      return out.stdout.trimAscii.toString
    else
      return "unknown"
  catch _ =>
    return "unknown"

def namesSummary (names : Array Name) : String :=
  if names.isEmpty then
    "(none)"
  else
    ", ".intercalate (names.map (fun n => n.toString)).toList

structure AnalyzedPackage where
  closure : Closure
  manifest : InterfaceManifest
  report : String

structure GeneratedPackage extends AnalyzedPackage where
  bytes : ByteArray

private unsafe def loadRunDeclIndex (targets : Array Target) : IO DeclIndex := do
  let index ← loadDeclIndex targets
  let index ← match ← Vir.readClientNativeExternManifestFromEnv with
    | none => pure index
    | some manifest =>
        let specs ← IO.ofExcept <| Vir.ClientNativeExternManifest.specs manifest
        pure { index with clientNativeExternSpecs := specs }
  resolveImportedModuleClosure targets index

def hasBlockingDiagnostics (closure : Closure) (manifest : InterfaceManifest) : Bool :=
  !closure.missingDecls.isEmpty ||
  !closure.missingExterns.isEmpty ||
  !closure.unsupportedInitGlobals.isEmpty ||
  !manifest.diagnostics.isEmpty

def printBlockingDiagnostics
    (closure : Closure)
    (manifest : InterfaceManifest)
    (missingDeclsHeading := "missing IR declarations:") : IO Unit := do
  if !closure.missingDecls.isEmpty then
    IO.eprintln missingDeclsHeading
    for dependency in closure.missingDecls do
      IO.eprintln s!"  - {dependency.name}{dependency.pathSuffix}"
  if !closure.missingExterns.isEmpty then
    IO.eprintln "missing native extern registrations:"
    for dependency in closure.missingExterns do
      IO.eprintln s!"  - {dependency.name}{dependency.pathSuffix}"
  if !closure.unsupportedInitGlobals.isEmpty then
    IO.eprintln "unsupported initializer globals:"
    for dependency in closure.unsupportedInitGlobals do
      IO.eprintln s!"  - {dependency.name}{dependency.pathSuffix}"
  if !manifest.diagnostics.isEmpty then
    IO.eprintln "package diagnostics:"
    for diagnostic in manifest.diagnostics do
      IO.eprintln s!"  - {diagnostic.name}: {diagnostic.reason}"

def analyzePackage
    (generatedAt : String)
    (targets : Array Target)
    (index : DeclIndex) : IO AnalyzedPackage := do
  let closure := collectClosure targets index
  let (hostImports, hostDiagnostics) ← collectHostImports index closure
  let metadata := collectPackageMetadata generatedAt targets index
  let manifest ← collectInterfaceManifest metadata targets index hostImports hostDiagnostics
  return {
    closure
    manifest
    report := reportFor targets closure manifest
  }

def buildPackageFromIndex
    (generatedAt : String)
    (targets : Array Target)
    (index : DeclIndex) : IO (Except String GeneratedPackage) := do
  let analysis ← analyzePackage generatedAt targets index
  if hasBlockingDiagnostics analysis.closure analysis.manifest then
    return .error analysis.report
  match emitPackage analysis.closure analysis.manifest with
  | .ok bytes =>
      return .ok {
        closure := analysis.closure
        manifest := analysis.manifest
        report := analysis.report
        bytes
      }
  | .error err =>
      return .error err

unsafe def run (targets : Array Target) (packagePath reportPath : System.FilePath) : IO UInt32 := do
  let index ← loadRunDeclIndex targets
  let analysis ← analyzePackage (← generatedAtUtc) targets index
  let closure := analysis.closure
  let manifest := analysis.manifest
  let report := analysis.report
  writeTextFile reportPath report
  if hasBlockingDiagnostics closure manifest then
    printBlockingDiagnostics closure manifest
    IO.eprintln s!"see {reportPath}"
    return 1
  match emitPackage closure manifest with
  | .ok bytes =>
      writeBinFile packagePath bytes
      IO.println s!"wrote {packagePath}"
      IO.println s!"wrote {reportPath}"
      IO.println s!"package format: {manifest.metadata.packageFormatVersion}"
      IO.println s!"toolchain: {manifest.metadata.leanToolchain}"
      IO.println s!"generated at: {manifest.metadata.generatedAt}"
      IO.println s!"declarations: {closure.decls.size + closure.externs.size} ({closure.decls.size} Lean IR, {closure.externs.size} native externs)"
      IO.println s!"JavaScript host imports: {manifest.hostImports.size}"
      IO.println s!"interface exports: {manifest.exports.size}"
      for target in manifest.metadata.targets do
        IO.println s!"target: {target.source} [{target.mode}] roots: {namesSummary target.resolvedRoots}"
      return 0
  | .error err =>
      IO.eprintln err
      return 1

def packageSetMemberJson (moduleName role path : String) : String :=
  jsonObject #[
    ("module", jsonString moduleName),
    ("role", jsonString role),
    ("path", jsonString path)
  ]

def packageSetDescriptorJson (members : Array String) : String :=
  jsonObject #[
    ("format", jsonString packageSetFormat),
    ("version", jsonNat currentPackageSetVersion),
    ("packages", jsonArray members)
  ] ++ "\n"

unsafe def runModuleSet
    (targets : Array Target)
    (rootModule : Name)
    (packagePath descriptorPath shardDir : System.FilePath)
    (rootRelativePath shardRelativeDir : String)
    (reportPath : System.FilePath) : IO UInt32 := do
  if targets.size != 1 then
    IO.eprintln s!"module package-set generation requires exactly one target, got {targets.size}"
    return 1
  let some target := targets[0]?
    | IO.eprintln "module package-set generation requires one target"
      return 1
  if let some targetModule := target.mode.markedModule? then
    if targetModule != rootModule then
      IO.eprintln s!"module package-set root `{rootModule}` does not match target `{targetModule}`"
      return 1

  let index ← loadRunDeclIndex targets
  let analysis ← analyzePackage (← generatedAtUtc) targets index
  let closure := analysis.closure
  let manifest := analysis.manifest
  let report := analysis.report
  writeTextFile reportPath report
  if hasBlockingDiagnostics closure manifest then
    printBlockingDiagnostics closure manifest
      "missing IR declarations after loading imported module IR:"
    IO.eprintln s!"see {reportPath}"
    return 1

  let moduleOrder? ← match closure.moduleInitializationOrder index target rootModule with
    | .ok moduleOrder => pure (some moduleOrder)
    | .error err =>
        IO.eprintln err
        pure none
  let some moduleOrder := moduleOrder? | return 1

  let dependencyManifest : InterfaceManifest := {
    metadata := manifest.metadata
  }
  let dependencyModules := moduleOrder.filter (· != rootModule)
  let mut members : Array String := #[]
  for moduleName in dependencyModules do
    let moduleClosure := closure.forModule moduleName rootModule
    if moduleClosure.decls.isEmpty && moduleClosure.initGlobals.isEmpty then
      continue
    let fileName := moduleName.toString ++ ".irpkg"
    let outputPath := shardDir / fileName
    match emitPackage moduleClosure dependencyManifest with
    | .error err =>
        IO.eprintln s!"while emitting module shard `{moduleName}`: {err}"
        return 1
    | .ok bytes =>
        writeBinFile outputPath bytes
        members := members.push <| packageSetMemberJson
          moduleName.toString "dependency" (System.FilePath.mk shardRelativeDir / fileName).toString

  let rootClosure := closure.forModule rootModule rootModule
  match emitPackage rootClosure manifest with
  | .error err =>
      IO.eprintln s!"while emitting root module `{rootModule}`: {err}"
      return 1
  | .ok bytes =>
      writeBinFile packagePath bytes
      members := members.push <| packageSetMemberJson
        rootModule.toString "root" rootRelativePath
      writeTextFile descriptorPath (packageSetDescriptorJson members)
      IO.println s!"wrote {descriptorPath}"
      IO.println s!"wrote {packagePath}"
      IO.println s!"wrote {reportPath}"
      IO.println s!"package set members: {members.size}"
      IO.println s!"package format: {manifest.metadata.packageFormatVersion}"
      IO.println s!"declarations: {closure.decls.size + closure.externs.size} ({closure.decls.size} Lean IR, {closure.externs.size} native externs)"
      IO.println s!"interface exports: {manifest.exports.size}"
      return 0

end Vir.GeneratePackage
