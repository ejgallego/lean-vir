/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Compiler.Interface.Encode
public import Vir.GeneratePackage.Manifest
public import Vir.Package.Json
public import Vir.Package.Name
import Std.Data.HashMap

public section

open Lean

namespace Vir.GeneratePackage

open Vir.Interface

/-- Package-local conversion identities. Keys are complete deterministic pair
encodings, including instantiated fields and the selected value interface.
This is not Lean type equality: erased/phantom parameters may leave identical
conversion facts, and an index never identifies a declaration or runtime value. -/
private structure BoundaryTable where
  pairs : Array String := #[]
  indices : Std.HashMap String Nat := {}

private def boundaryIndex (type : InterfaceType) : StateM BoundaryTable Nat := do
  let encoded := type.toJson
  let table ← get
  if let some index := table.indices[encoded]? then
    return index
  let index := table.pairs.size
  set { table with pairs := table.pairs.push encoded, indices := table.indices.insert encoded index }
  return index

private def argumentJson (arg : InterfaceArg) : StateM BoundaryTable String := do
  return jsonObject #[
    ("name", jsonString arg.name),
    ("type", jsonNat (← boundaryIndex arg.type))
  ]

private def exportJson (entry : InterfaceExport) : StateM BoundaryTable String := do
  let args ← entry.args.mapM argumentJson
  let result ← boundaryIndex entry.result
  return jsonObject #[
    ("entry", jsonName entry.entry),
    ("nameKey", jsonString (Vir.nameKey entry.entry)),
    ("source", jsonString entry.source),
    ("args", jsonArray args),
    ("result", jsonNat result),
    ("effect", entry.effect.toJson),
    ("startup", jsonBool entry.startup)
  ]

private def hostImportJson (entry : HostImport) : StateM BoundaryTable String := do
  let args ← entry.args.mapM argumentJson
  let result ← boundaryIndex entry.result
  return jsonObject #[
    ("slot", jsonNat entry.slot),
    ("name", jsonName entry.name),
    ("nameKey", jsonString (Vir.nameKey entry.name)),
    ("source", jsonString entry.source),
    ("target", jsonString entry.target),
    ("boundary", jsonString entry.boundary.label),
    ("symbol", jsonString entry.symbol),
    ("arity", jsonNat entry.arity),
    ("erasedPrefixArgs", jsonNat entry.erasedPrefixArgs),
    ("args", jsonArray args),
    ("result", jsonNat result),
    ("effect", entry.effect.toJson)
  ]

def PackageDiagnostic.toJson (diagnostic : PackageDiagnostic) : String :=
  jsonObject #[
    ("name", jsonName diagnostic.name),
    ("source", jsonString diagnostic.source),
    ("reason", jsonString diagnostic.reason)
  ]

def PackageTargetMetadata.toJson (target : PackageTargetMetadata) : String :=
  let origin := match target.origin with
    | .snapshot document _ => ("source", jsonString document)
    | .module name => ("module", jsonName name)
  jsonObject #[
    origin,
    ("mode", jsonString (target.mode.metadataNameFor target.origin)),
    ("roots", jsonArray (target.mode.roots.map jsonName)),
    ("resolvedRoots", jsonArray (target.resolvedRoots.map jsonName))
  ]

def PackageSetMemberMetadata.toJson (member : PackageSetMemberMetadata) : String :=
  jsonObject #[
    ("module", jsonName member.moduleName),
    ("role", jsonString member.role.label)
  ]

def PackageMetadata.toJson (metadata : PackageMetadata) : String :=
  let fields := #[
    ("generator", jsonString metadata.generator),
    ("packageFormatVersion", jsonNat metadata.packageFormatVersion),
    ("manifestVersion", jsonNat metadata.manifestVersion),
    ("leanVersion", jsonString metadata.leanVersion),
    ("leanToolchain", jsonString metadata.leanToolchain),
    ("leanGithash", jsonString metadata.leanGithash),
    ("targets", jsonArray (metadata.targets.map PackageTargetMetadata.toJson))
  ]
  let fields := match metadata.packageSetMember? with
    | some member => fields.push ("packageSetMember", member.toJson)
    | none => fields
  jsonObject fields

def InterfaceManifest.toJson (manifest : InterfaceManifest) : String :=
  let encode : StateM BoundaryTable (Array String × Array String × Array String) := do
    let exports ← manifest.exports.mapM exportJson
    let operations ← manifest.codecOperations.mapM exportJson
    let hostImports ← manifest.hostImports.mapM hostImportJson
    return (exports, hostImports, operations)
  let ((exports, hostImports, operations), table) := encode.run {}
  jsonObject #[
    ("version", jsonNat currentInterfaceManifestVersion),
    ("artifact", jsonString packageMagic),
    ("metadata", manifest.metadata.toJson),
    ("interfaces", jsonArray table.pairs),
    ("exports", jsonArray exports),
    ("codecOperations", jsonArray operations),
    ("hostImports", jsonArray hostImports),
    ("diagnostics", jsonArray (manifest.diagnostics.map PackageDiagnostic.toJson))
  ]

end Vir.GeneratePackage
