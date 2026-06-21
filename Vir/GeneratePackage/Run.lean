/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Emit
import Vir.GeneratePackage.Report

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

structure GeneratedPackage where
  closure : Closure
  manifest : InterfaceManifest
  report : String
  bytes : ByteArray

def hasBlockingDiagnostics (closure : Closure) (manifest : InterfaceManifest) : Bool :=
  !closure.missingDecls.isEmpty ||
  !closure.missingExterns.isEmpty ||
  !closure.unsupportedInitGlobals.isEmpty ||
  !manifest.diagnostics.isEmpty

def buildPackageFromIndex
    (generatedAt : String)
    (targets : Array Target)
    (index : DeclIndex) : IO (Except String GeneratedPackage) := do
  let closure := collectClosure targets index
  let (hostImports, hostDiagnostics) ← collectHostImports index closure
  let metadata := collectPackageMetadata generatedAt targets index
  let manifest ← collectInterfaceManifest metadata targets index hostImports hostDiagnostics
  let report := reportFor targets closure manifest
  if hasBlockingDiagnostics closure manifest then
    return .error report
  match emitPackage closure manifest with
  | .ok bytes =>
      return .ok {
        closure
        manifest
        report
        bytes
      }
  | .error err =>
      return .error err

unsafe def run (targets : Array Target) (packagePath reportPath : System.FilePath) : IO UInt32 := do
  let index <- loadDeclIndex targets
  let closure := collectClosure targets index
  let (hostImports, hostDiagnostics) ← collectHostImports index closure
  let metadata := collectPackageMetadata (← generatedAtUtc) targets index
  let manifest ← collectInterfaceManifest metadata targets index hostImports hostDiagnostics
  let report := reportFor targets closure manifest
  writeTextFile reportPath report
  if !closure.missingDecls.isEmpty || !closure.missingExterns.isEmpty || !closure.unsupportedInitGlobals.isEmpty || !manifest.diagnostics.isEmpty then
    if !closure.missingDecls.isEmpty then
      IO.eprintln "missing IR declarations:"
      for name in closure.missingDecls do
        IO.eprintln s!"  - {name}"
    if !closure.missingExterns.isEmpty then
      IO.eprintln "missing native extern registrations:"
      for name in closure.missingExterns do
        IO.eprintln s!"  - {name}"
    if !closure.unsupportedInitGlobals.isEmpty then
      IO.eprintln "unsupported initializer globals:"
      for name in closure.unsupportedInitGlobals do
        IO.eprintln s!"  - {name}"
    if !manifest.diagnostics.isEmpty then
      IO.eprintln "package diagnostics:"
      for diagnostic in manifest.diagnostics do
        IO.eprintln s!"  - {diagnostic.name}: {diagnostic.reason}"
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

end Vir.GeneratePackage
