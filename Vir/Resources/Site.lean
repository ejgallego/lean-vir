/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Resources.Validate

public section
namespace Vir.Resources

/-- Complete site files and output-relative loader paths. The host owns writing
these files and resolving paths relative to its generated page. -/
structure SiteFiles where
  files : Array File
  runtimeModule : String
  runtimeManifest : String
  /-- In the original program order, including references to repeated programs. -/
  programManifests : Array String

private def manifestBytes (bundle : Bundle) : ByteArray :=
  ("{\"contentId\":\"" ++ bundle.contentId ++ "\",\"descriptor\":" ++
    String.fromUTF8! (encodeDescriptor bundle.descriptor) ++ "}").toUTF8

/-- Prepare canonical manifests and complete payloads, validating/deduplicating
the resource set once. `outputPrefix` is a portable output-relative directory;
empty means the output root. Spellings are preserved, never normalized.
This performs no IO or runtime acquisition and does not make publication atomic. -/
def ResourceSet.forSite (resources : ResourceSet) (outputPrefix : String) :
    Except ResourceError SiteFiles := do
  unless outputPrefix.isEmpty || validPath outputPrefix do
    throw { code := "INVALID_PATH", path := some outputPrefix }
  let bundles ← resources.bundles
  let base (bundle : Bundle) :=
    if outputPrefix.isEmpty then bundle.contentId else outputPrefix ++ "/" ++ bundle.contentId
  let manifest (bundle : Bundle) := base bundle ++ "/bundle.json"
  -- The validated runtime has this required role; reuse its declared spelling.
  let some runtimeModule := resources.runtime.entryPath? "runtimeModule"
    | throw {
        code := "MISSING_ROLE"
        logicalId := resources.runtime.descriptor.logicalId
        role := some "runtimeModule" }
  let mut files := #[]
  for bundle in bundles do
    files := files.push { path := manifest bundle, bytes := manifestBytes bundle }
    for file in bundle.files do
      files := files.push { file with path := base bundle ++ "/" ++ file.path }
  return {
    files
    runtimeModule := base resources.runtime ++ "/" ++ runtimeModule
    runtimeManifest := manifest resources.runtime
    programManifests := resources.programs.map manifest }

end Vir.Resources
