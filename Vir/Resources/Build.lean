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
import Vir.Package.Format
import Vir.Release

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

/-! Write through a fresh sibling and rename. Never truncate or write through a
possibly hardlinked destination; identical bytes are a deliberate no-op. -/
def withSibling (destination : FilePath) (f : FilePath → IO α) : IO α :=
  Vir.NativePayload.withSibling destination f
def atomicInstall (destination : FilePath) (bytes : ByteArray) : IO Unit :=
  Vir.NativePayload.atomicInstall destination bytes

private def verifyIdentity (expected : String) (profile : Compatibility) (bundle : Bundle) : IO Unit := do
  unless bundle.contentId == expected do
    fail "CONTENT_ID_MISMATCH" s!"expected {expected}, got {bundle.contentId}"
  unless bundle.descriptor.compatibility.leanRevision == Lean.githash do
    fail "LEAN_BUILD_MISMATCH"
      s!"expected {Lean.githash}, got {bundle.descriptor.compatibility.leanRevision}"
  unless bundle.descriptor.compatibility == profile do
    fail "INCOMPATIBLE"
      s!"bundle {bundle.descriptor.logicalId} has {repr bundle.descriptor.compatibility}; expected {repr profile}"

private def verify (expected : String) (profile : Compatibility) (bytes : ByteArray) : IO Unit := do
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

/-- Selection records one immutable expected identity before any acquisition. -/
inductive RuntimeIdentity where
  | sourceRevision (revision : String)
  | contentId (contentId : String)
  deriving Repr, BEq

namespace RuntimeIdentity

def kind : RuntimeIdentity → String
  | .sourceRevision _ => "sourceRevision"
  | .contentId _ => "contentId"

def value : RuntimeIdentity → String
  | .sourceRevision revision => revision
  | .contentId cid => cid

def parse (kind value : String) : Except String RuntimeIdentity := do
  let length ← match kind with
    | "sourceRevision" => pure 40
    | "contentId" => pure 64
    | _ => throw "expected sourceRevision or contentId"
  unless value.length == length && value.toList.all ("0123456789abcdef".contains ·) do
    throw s!"expected {length} lowercase hexadecimal digits"
  return if kind == "sourceRevision" then .sourceRevision value else .contentId value

end RuntimeIdentity

structure RuntimeSelection where
  identity : RuntimeIdentity
  source : String

private def selectRuntime (root : FilePath) : IO RuntimeSelection := do
  match ← IO.getEnv "VIR_RUNTIME_PACK" with
  | some path =>
    let path := FilePath.mk path
    let path := if path.isAbsolute then path else root / path
    let bundle ← fromResource (Pack.decode (← readInput path packLimit "PACK_LIMIT"))
    return { identity := .contentId bundle.contentId, source := path.toString }
  | none =>
    let revision ← Vir.Release.sourceRevision root
    return { identity := .sourceRevision revision
             source := s!"https://github.com/ejgallego/lean-vir/releases/download/{Vir.Release.tag}/{Vir.Release.runtimeName revision}" }

def runtimePlan (root : FilePath) : IO Unit := do
  let selection ← selectRuntime root
  IO.println (Json.compress <| Json.mkObj [
    ("identity", Json.mkObj [("kind", toJson selection.identity.kind),
      ("value", toJson selection.identity.value)]),
    ("source", toJson selection.source)])

/-- Pure domain validation; filesystem failures are never cache misses. -/
def validateRuntime (identity : RuntimeIdentity) (bytes : ByteArray) : Except ResourceError Unit := do
  let bundle ← Pack.decode bytes
  unless bundle.descriptor.kind == .runtime do throw { code := "EXPECTED_RUNTIME" }
  unless bundle.descriptor.compatibility == currentCompatibility do
    throw { code := "INCOMPATIBLE", expected := some (reprStr currentCompatibility) }
  match identity with
  | .contentId expected =>
    unless bundle.contentId == expected do
      throw { code := "CONTENT_ID_MISMATCH", expected := some expected, actual := some bundle.contentId }
  | .sourceRevision revision =>
    let expected := Vir.Release.runtimeLogicalId revision
    unless bundle.descriptor.logicalId == expected do
      throw { code := "RUNTIME_SOURCE_MISMATCH"
              expected := some expected
              actual := some bundle.descriptor.logicalId }

def verifyRuntime (identity : RuntimeIdentity) (bytes : ByteArray) : IO Vir.NativePayload.VerifiedPayload :=
  Vir.NativePayload.verifyBytes bytes fun bytes => fromResource (validateRuntime identity bytes)

def runtimeCandidate (identity : RuntimeIdentity) (path : FilePath)
    : IO (Option Vir.NativePayload.VerifiedPayload) := do
  checkFile path
  let some metadata ← metadata? path | return none
  if metadata.byteSize.toNat > packLimit then return none
  let bytes ← readInput path packLimit "PACK_LIMIT"
  match validateRuntime identity bytes with
  | .error _ => return none
  | .ok _ => return some (← Vir.NativePayload.verifyBytes bytes fun _ => pure ())

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
