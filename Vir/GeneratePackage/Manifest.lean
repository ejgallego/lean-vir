/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Interface
import Vir.GeneratePackage.PackageFormat

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def targetMetadataFor (index : DeclIndex) (target : Target) : PackageTargetMetadata :=
  let mode :=
    if target.packageOnly then "packageOnly"
    else if target.includeAll then "all"
    else "explicit"
  {
    source := target.source.toString
    mode := mode
    roots := target.roots
    resolvedRoots := resolvedRootsForTarget index target
    packageOnly := target.packageOnly
    dropEvalCommands := target.dropEvalCommands
  }

def collectPackageMetadata (generatedAt : String) (targets : Array Target) (index : DeclIndex) : PackageMetadata :=
  {
    generator := "tools/GeneratePackage.lean"
    packageFormatVersion := currentPackageFormatVersion
    manifestVersion := currentInterfaceManifestVersion
    leanVersion := Lean.versionString
    leanToolchain := Lean.toolchain
    leanGithash := Lean.githash
    generatedAt := generatedAt
    targets := targets.map (targetMetadataFor index)
  }

def duplicateInterfaceExportDiagnostic? (exports : Array InterfaceExport) (entry : InterfaceExport) :
    Option PackageDiagnostic :=
  match exports.find? (fun existing => existing.id == entry.id) with
  | some existing =>
      some {
        name := entry.entry
        source := entry.source
        reason := s!"interface export id `{entry.id}` duplicates `{existing.entry}` from `{existing.source}`"
      }
  | none =>
      match exports.find? (fun existing => existing.jsName == entry.jsName) with
      | some existing =>
          some {
            name := entry.entry
            source := entry.source
            reason := s!"interface export JavaScript name `{entry.jsName}` duplicates `{existing.entry}` from `{existing.source}`"
          }
      | none => none

def collectInterfaceManifest
    (metadata : PackageMetadata)
    (targets : Array Target)
    (index : DeclIndex)
    (hostImports : Array HostImport)
    (hostDiagnostics : Array PackageDiagnostic) : IO InterfaceManifest := do
  let mut manifest : InterfaceManifest := {
    metadata := metadata,
    hostImports := hostImports,
    diagnostics := hostDiagnostics ++ index.diagnostics.map (·.toPackageDiagnostic)
  }
  for target in targets do
    let source := target.source.toString
    match index.envForSource? source with
    | none =>
        manifest := { manifest with diagnostics := manifest.diagnostics.push {
          name := .anonymous,
          source,
          reason := "source environment was not loaded"
        } }
    | some env =>
        for name in exportCandidatesFor index target do
          match ← runCoreForSource source env (interfaceExportFor index source name) with
          | .ok entry =>
              if !manifest.exports.any (fun existing => existing.entry == entry.entry) then
                match duplicateInterfaceExportDiagnostic? manifest.exports entry with
                | some diagnostic =>
                    manifest := { manifest with diagnostics := manifest.diagnostics.push diagnostic }
                | none =>
                    manifest := { manifest with exports := manifest.exports.push entry }
          | .error diagnostic =>
              manifest := { manifest with diagnostics := manifest.diagnostics.push diagnostic }
  return manifest

def InterfaceArg.toJson (arg : InterfaceArg) : String :=
  jsonObject #[
    ("name", jsonString arg.name),
    ("type", arg.type.toJson)
  ]

def InterfaceEffect.toJson (effect : InterfaceEffect) : String :=
  jsonString effect.label

def InterfaceExport.toJson (entry : InterfaceExport) : String :=
  jsonObject #[
    ("id", jsonString entry.id),
    ("jsName", jsonString entry.jsName),
    ("entry", jsonName entry.entry),
    ("source", jsonString entry.source),
    ("args", jsonArray (entry.args.map InterfaceArg.toJson)),
    ("result", entry.result.toJson),
    ("effect", entry.effect.toJson)
  ]

def HostImport.toJson (entry : HostImport) : String :=
  jsonObject #[
    ("slot", jsonNat entry.slot),
    ("name", jsonName entry.name),
    ("source", jsonString entry.source),
    ("target", jsonString entry.target),
    ("symbol", jsonString entry.symbol),
    ("arity", jsonNat entry.arity),
    ("erasedPrefixArgs", jsonNat entry.erasedPrefixArgs),
    ("args", jsonArray (entry.args.map InterfaceArg.toJson)),
    ("result", entry.result.toJson),
    ("effect", entry.effect.toJson)
  ]

def PackageDiagnostic.toJson (diagnostic : PackageDiagnostic) : String :=
  jsonObject #[
    ("name", jsonName diagnostic.name),
    ("source", jsonString diagnostic.source),
    ("reason", jsonString diagnostic.reason)
  ]

def PackageTargetMetadata.toJson (target : PackageTargetMetadata) : String :=
  jsonObject #[
    ("source", jsonString target.source),
    ("mode", jsonString target.mode),
    ("roots", jsonArray (target.roots.map jsonName)),
    ("resolvedRoots", jsonArray (target.resolvedRoots.map jsonName)),
    ("packageOnly", jsonBool target.packageOnly),
    ("dropEvalCommands", jsonBool target.dropEvalCommands)
  ]

def PackageMetadata.toJson (metadata : PackageMetadata) : String :=
  jsonObject #[
    ("generator", jsonString metadata.generator),
    ("packageFormatVersion", jsonNat metadata.packageFormatVersion),
    ("manifestVersion", jsonNat metadata.manifestVersion),
    ("leanVersion", jsonString metadata.leanVersion),
    ("leanToolchain", jsonString metadata.leanToolchain),
    ("leanGithash", jsonString metadata.leanGithash),
    ("generatedAt", jsonString metadata.generatedAt),
    ("targets", jsonArray (metadata.targets.map PackageTargetMetadata.toJson))
  ]

def InterfaceManifest.toJson (manifest : InterfaceManifest) : String :=
  jsonObject #[
    ("version", jsonNat 1),
    ("artifact", jsonString "lean-vir-ir-package"),
    ("metadata", manifest.metadata.toJson),
    ("exports", jsonArray (manifest.exports.map InterfaceExport.toJson)),
    ("hostImports", jsonArray (manifest.hostImports.map HostImport.toJson)),
    ("diagnostics", jsonArray (manifest.diagnostics.map PackageDiagnostic.toJson))
  ]

end Vir.GeneratePackage
