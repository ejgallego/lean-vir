/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Interface.Collect
public import Vir.Package.Format

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def targetMetadataFor (index : DeclIndex) (target : Target) : PackageTargetMetadata :=
  {
    origin := target.origin
    mode := target.mode
    resolvedRoots := resolvedRootsForTarget index target
  }

def collectPackageMetadata (targets : Array Target) (index : DeclIndex) : PackageMetadata :=
  {
    generator := "tools/GeneratePackage.lean"
    packageFormatVersion := currentPackageFormatVersion
    manifestVersion := currentInterfaceManifestVersion
    leanVersion := Lean.versionString
    leanToolchain := Lean.toolchain
    leanGithash := Lean.githash
    targets := targets.map (targetMetadataFor index)
  }

def collectInterfaceManifest
    (metadata : PackageMetadata)
    (targets : Array Target)
    (index : DeclIndex)
    (hostImports : Array HostImport)
    (hostDiagnostics : Array PackageDiagnostic) : IO InterfaceManifest := do
  let mut manifest : InterfaceManifest := {
    metadata := metadata,
    hostImports := hostImports,
    diagnostics := hostDiagnostics ++ index.diagnostics
  }
  for target in targets do
    let source := target.publicSource
    match index.envForTarget? target with
    | none =>
        manifest := { manifest with diagnostics := manifest.diagnostics.push {
          name := .anonymous,
          source,
          reason := "target environment was not loaded"
        } }
    | some env =>
        let candidates := exportCandidatesFor index target
        if target.mode.selectsMarked && candidates.isEmpty then
          manifest := { manifest with diagnostics := manifest.diagnostics.push {
            name := .anonymous,
            source,
            reason := "no declarations are marked with `@[vir_export]` or `@[vir_startup]`"
          } }
        for name in candidates do
          match ← runCoreForSource source env (interfaceExportFor index source name) with
          | .ok entry =>
              if !manifest.exports.any (fun existing => existing.entry == entry.entry) then
                manifest := { manifest with exports := manifest.exports.push entry }
          | .error diagnostic =>
              manifest := { manifest with diagnostics := manifest.diagnostics.push diagnostic }
  return manifest

end Vir.GeneratePackage
