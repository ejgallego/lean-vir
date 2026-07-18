/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Manifest

open Lean

namespace Vir.GeneratePackage

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
    ("effect", entry.effect.toJson),
    ("startup", jsonBool entry.startup)
  ]

def HostImport.toJson (entry : HostImport) : String :=
  jsonObject #[
    ("slot", jsonNat entry.slot),
    ("name", jsonName entry.name),
    ("source", jsonString entry.source),
    ("target", jsonString entry.target),
    ("boundary", jsonString entry.boundary.label),
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
    ("resolvedRoots", jsonArray (target.resolvedRoots.map jsonName))
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
    ("version", jsonNat currentInterfaceManifestVersion),
    ("artifact", jsonString packageMagic),
    ("metadata", manifest.metadata.toJson),
    ("exports", jsonArray (manifest.exports.map InterfaceExport.toJson)),
    ("hostImports", jsonArray (manifest.hostImports.map HostImport.toJson)),
    ("diagnostics", jsonArray (manifest.diagnostics.map PackageDiagnostic.toJson))
  ]

end Vir.GeneratePackage
