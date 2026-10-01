/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import Lean
public import Lean.Data.Json.Basic
public import Vir.Resources.Types
public import Vir.NativePayload
import Vir.Resources.Pack
import Vir.GeneratePackage.PackageFormat

/-! Native-only support for bounded resource preparation.

This module is intentionally below the resource carriers. It owns the shared
filesystem, JSON/profile, and publication checks used by the two native tools;
it never acquires a generator or enters a runtime carrier.
-/

public section
namespace Vir.Resources.Build
open Lean System Vir.Resources

private def fail (code detail : String) : IO α :=
  throw <| IO.userError s!"{code}: {detail}"

private def fromExcept (code : String) (value : Except String α) : IO α :=
  match value with
  | .ok value => pure value
  | .error detail => fail code detail

private def fromResource (value : Except ResourceError α) : IO α :=
  match value with
  | .ok value => pure value
  | .error err => fail err.code (reprStr err)

def packLimit : Nat := maxPayloadBytes + maxDescriptorBytes + 12

def metadata? (path : FilePath) : IO (Option IO.FS.Metadata) :=
  Vir.NativePayload.metadata? path
-- These roots are read-only build inputs, not managed installation destinations.
def checkDirectory (path : FilePath) : IO Unit := do
  unless (← path.isDir) do fail "MISSING_RESOURCE_DIRECTORY" path.toString
def checkFile (path : FilePath) : IO Unit := Vir.NativePayload.checkFile path
def readInput (path : FilePath) (limit : Nat) (limitCode : String) : IO ByteArray :=
  Vir.NativePayload.readInput path limit limitCode

/-! Configuration uses ordinary JSON plus the typed field/schema checks below.
Canonical spelling belongs to persisted packs, not user-authored recipes. -/
def parseJson (bytes : ByteArray) : Except String Json := do
  let some source := String.fromUTF8? bytes | throw "invalid UTF-8"
  Json.parse source

def readJson (path : FilePath) (limit : Nat) : IO Json := do
  let bytes ← readInput path limit "JSON_LIMIT"
  fromExcept "INVALID_JSON" (parseJson bytes)

def exactKeys (json : Json) (keys : Array String) : Except String Unit := do
  let obj ← json.getObj?
  let actual := obj.toList.map (·.1)
  unless actual == keys.toList.mergeSort (· < ·) do
    throw s!"expected only fields {keys.toList}, got {actual}"

def validMetadata (value : String) : Bool :=
  !value.isEmpty && value.utf8ByteSize ≤ maxMetadataBytes

def currentCompatibility : Compatibility := {
  leanRevision := Lean.githash
  virVersion := Vir.GeneratePackage.currentVirCompatibilityVersion
}

def compatibility (path : FilePath) : IO Compatibility := do
  let json ← readJson path maxMetadataBytes
  let c ← fromExcept "INVALID_COMPATIBILITY" do
    exactKeys json #["leanRevision", "virVersion"]
    return {
      leanRevision := ← json.getObjValAs? String "leanRevision"
      virVersion := ← json.getObjValAs? Nat "virVersion" }
  unless c.leanRevision == Lean.githash do
    fail "LEAN_BUILD_MISMATCH" s!"expected {Lean.githash}, got {c.leanRevision}"
  unless c.virVersion == currentCompatibility.virVersion do
    fail "UNSUPPORTED_COMPATIBILITY"
      s!"expected {repr currentCompatibility}, got {repr c}"
  return c

def checkedSupport (root : FilePath) (source : String) : IO FilePath := do
  checkDirectory root
  let path := root / source
  discard <| Vir.NativePayload.regularInput path
  return path

/-! Write through a fresh sibling and rename. Never truncate or write through a
possibly hardlinked destination; identical bytes are a deliberate no-op. -/
def withSibling (destination : FilePath) (f : FilePath → IO α) : IO α :=
  Vir.NativePayload.withSibling destination f
def atomicInstall (destination : FilePath) (bytes : ByteArray) : IO Unit :=
  Vir.NativePayload.atomicInstall destination bytes

def verifyIdentity (expected : String) (profile : Compatibility) (bundle : Bundle) : IO Unit := do
  unless bundle.contentId == expected do
    fail "CONTENT_ID_MISMATCH" s!"expected {expected}, got {bundle.contentId}"
  unless bundle.descriptor.compatibility.leanRevision == Lean.githash do
    fail "LEAN_BUILD_MISMATCH"
      s!"expected {Lean.githash}, got {bundle.descriptor.compatibility.leanRevision}"
  unless bundle.descriptor.compatibility == profile do
    fail "INCOMPATIBLE"
      s!"bundle {bundle.descriptor.logicalId} has {repr bundle.descriptor.compatibility}; expected {repr profile}"

def verify (expected : String) (profile : Compatibility) (bytes : ByteArray) : IO Unit := do
  match Pack.decode bytes with
  | .ok bundle => verifyIdentity expected profile bundle
  | .error e => fail e.code (reprStr e)

def verifyPayload (expected : String) (profile : Compatibility) (bytes : ByteArray)
    : IO Vir.NativePayload.VerifiedPayload :=
  Vir.NativePayload.verifyBytes bytes fun bytes => verify expected profile bytes

/-! A corrupt cache is a rejected candidate, never a new expected identity.
Path/permission errors remain errors rather than triggering network fallback. -/
def candidate (expected : String) (profile : Compatibility) (path : FilePath)
    : IO (Option Vir.NativePayload.VerifiedPayload) := do
  checkFile path
  unless (← metadata? path).isSome do return none
  let m ← path.metadata
  if m.byteSize.toNat > packLimit then return none
  let bytes ← readInput path packLimit "PACK_LIMIT"
  match Pack.decode bytes with
  | .error _ => return none
  | .ok bundle =>
    if bundle.contentId != expected then return none
    let verified ← Vir.NativePayload.verifyBytes bytes fun _ =>
      verifyIdentity expected profile bundle
    return some verified

def runtimePlan (compatibilityPath lockPath root : FilePath) : IO Unit := do
  let _ ← compatibility compatibilityPath
  let json ← readJson lockPath maxMetadataBytes
  let (contentId, source) ← fromExcept "INVALID_RUNTIME_LOCK" do
    exactKeys json #["schemaVersion", "contentId", "source"]
    let version ← json.getObjValAs? Nat "schemaVersion"
    unless version == 1 do throw s!"unsupported schemaVersion {version}; expected 1"
    let contentId ← json.getObjValAs? String "contentId"
    unless contentId.utf8ByteSize == 64 &&
        contentId.toList.all ("0123456789abcdef".contains ·) do
      throw "contentId must be 64 lowercase hex digits"
    let source ← json.getObjValAs? String "source"
    unless validMetadata source do throw "source must be a bounded nonempty string"
    return (contentId, source)
  let source ← if source == "-" then pure source
    else if source.startsWith "https://" then do
      fromExcept "INVALID_RUNTIME_LOCK" (Vir.NativePayload.checkAnonymousHttps source)
      pure source
    else do
      unless validPath source do fail "INVALID_RUNTIME_LOCK" s!"unsafe local source `{source}`"
      let path ← checkedSupport root source
      pure path.toString
  IO.println (Json.compress <| Json.mkObj [
    ("contentId", toJson contentId), ("source", toJson source)])

def stage (compatibilityPath packPath outputPath : FilePath) : IO String := do
  let expected ← compatibility compatibilityPath
  let bytes ← readInput packPath packLimit "PACK_LIMIT"
  let bundle ← fromResource (Pack.decode bytes)
  unless bundle.descriptor.compatibility == expected do
    fail "INCOMPATIBLE"
      s!"bundle {bundle.descriptor.logicalId} has {repr bundle.descriptor.compatibility}; expected {repr expected}"
  atomicInstall outputPath bytes
  return bundle.contentId

end Vir.Resources.Build
