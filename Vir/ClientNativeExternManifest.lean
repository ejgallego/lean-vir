/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Data.Json.Parser
public import Vir.GeneratePackage.NativeExterns

public section

open Lean

namespace Vir

open GeneratePackage

def clientNativeExternManifestEnv : String := "VIR_NATIVE_EXTERN_MANIFEST"

structure ClientNativeExternManifest where
  path : System.FilePath
  root : System.FilePath
  modules : Array Name
  externs : Array Name
  providerSources : Array System.FilePath

private def manifestError (path : System.FilePath) (message : String) : IO α :=
  throw <| IO.userError s!"invalid client-native extern manifest `{path}`: {message}"

private def jsonField
    (path : System.FilePath) (json : Json) (field : String)
    (read : Json → Except String α) : IO α := do
  match json.getObjVal? field >>= read with
  | .ok value => pure value
  | .error error => manifestError path s!"field `{field}`: {error}"

private def stringArrayField
    (path : System.FilePath) (json : Json) (field : String) : IO (Array String) := do
  let entries ← jsonField path json field Json.getArr?
  let mut values := #[]
  for entry in entries do
    let value ← match entry.getStr? with
      | .ok value => pure value
      | .error error => manifestError path s!"field `{field}`: {error}"
    if value.isEmpty then
      manifestError path s!"field `{field}` must not contain empty strings"
    if values.contains value then
      manifestError path s!"field `{field}` contains duplicate `{value}`"
    values := values.push value
  if values.isEmpty then
    manifestError path s!"field `{field}` must not be empty"
  return values

private def validateFields (path : System.FilePath) : Json → IO Unit
  | .obj fields =>
      for (field, _) in fields.toList do
        unless #["format", "version", "modules", "externs", "providerSources"].contains field do
          manifestError path s!"unknown field `{field}`"
  | _ => manifestError path "top-level JSON value must be an object"

private def parseNames
    (path : System.FilePath) (field : String) (values : Array String) : IO (Array Name) := do
  values.mapM fun value =>
    match parseDottedName value with
    | .ok name => pure name
    | .error error => manifestError path s!"field `{field}`: {error}"

private def resolveProviderSource
    (manifestPath root : System.FilePath) (source : String) : IO System.FilePath := do
  let relative := System.FilePath.mk source
  if relative.isAbsolute then
    manifestError manifestPath s!"provider source `{source}` must be relative to the manifest"
  if source.splitOn "/" |>.any fun part => part.isEmpty || part == "." || part == ".." then
    manifestError manifestPath s!"provider source `{source}` must be a normalized relative path"
  unless #[some "c", some "cc", some "cpp", some "cxx"].contains relative.extension do
    manifestError manifestPath s!"provider source `{source}` must be a C or C++ source file"
  let resolved := root / relative
  unless ← resolved.pathExists do
    manifestError manifestPath s!"provider source `{source}` does not exist"
  return resolved

def ClientNativeExternManifest.specs
    (manifest : ClientNativeExternManifest) : Except String (Array NativeExternSpec) := do
  for name in manifest.externs do
    if nativeExternSpecs.any (·.name == name) then
      throw s!"client-native extern `{name}` collides with the built-in native extern catalog"
  return manifest.externs.map fun name => { name, generateBoxedWrapper := true }

def readClientNativeExternManifest
    (path : System.FilePath) : IO ClientNativeExternManifest := do
  let source ← IO.FS.readFile path
  let json ← match Json.parse source with
    | .ok json => pure json
    | .error error => manifestError path s!"JSON parse failed: {error}"
  validateFields path json
  let format ← jsonField path json "format" Json.getStr?
  if format != "lean-vir-client-native-externs" then
    manifestError path s!"unsupported format `{format}`"
  let version ← jsonField path json "version" Json.getNat?
  if version != 1 then
    manifestError path s!"unsupported version {version}"
  let modules ← parseNames path "modules" (← stringArrayField path json "modules")
  let externs ← parseNames path "externs" (← stringArrayField path json "externs")
  let root := path.parent.getD "."
  let providerSources ← (← stringArrayField path json "providerSources").mapM
    (resolveProviderSource path root)
  let manifest : ClientNativeExternManifest := { path, root, modules, externs, providerSources }
  match ClientNativeExternManifest.specs manifest with
  | .ok _ => return manifest
  | .error error => manifestError path error

def readClientNativeExternManifestFromEnv : IO (Option ClientNativeExternManifest) := do
  match ← IO.getEnv clientNativeExternManifestEnv with
  | none => return none
  | some value =>
      if value.isEmpty then
        throw <| IO.userError s!"{clientNativeExternManifestEnv} must not be empty"
      return some (← readClientNativeExternManifest value)

end Vir
