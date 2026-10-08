/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Resources.Types
-- Only carriers need the pure binary-literal decoder, not resource data types.
public import Vir.BinaryLiteral
public meta import Lean.Elab.Term
meta import Lean.Elab.Deriving.ToExpr
meta import Lean.Util.Path
meta import Vir.Resources.Types
public meta import Vir.BinaryLiteral.ToExpr
public meta import Vir.Resources.Pack
public meta import Vir.NativePayload

/-! Inclusion is only an elaboration operation on a prepared, complete pack.
Lake owns preparation and tracing. No downloader, build, or runtime file access. -/

namespace Vir.Resources
open Lean Elab Term

meta section

private instance : ToExpr ByteArray where
  toTypeExpr := mkConst ``ByteArray
  toExpr := BinaryLiteral.toExpr

deriving instance ToExpr for BundleKind
deriving instance ToExpr for Compatibility
deriving instance ToExpr for FileInfo
deriving instance ToExpr for FileEntry
deriving instance ToExpr for Descriptor
deriving instance ToExpr for File
deriving instance ToExpr for Bundle

private def embedPrepared (resolved : System.FilePath) : TermElabM Expr := do
  let bytes ← Vir.NativePayload.readInput resolved
    (maxPayloadBytes + maxDescriptorBytes + 12) "PACK_LIMIT"
  match Pack.decode bytes with
  | .error error => throwError "invalid resource pack {resolved}: {repr error}"
  | .ok bundle => return toExpr bundle

/-- Embed an explicitly prepared source-relative pack. Low-level tools can use
this form without library preparation; ordinary clients use include_vir_program. -/
elab "include_vir_bundle " path:str : term => do
  let source := System.FilePath.mk (← readThe Lean.Core.Context).fileName
  let relative := System.FilePath.mk path.getString
  if relative.isAbsolute then throwError "include_vir_bundle expects a source-relative path"
  embedPrepared (source.parent.getD "." / relative)

/-- Embed the program prepared for this module by its library's virResourcePack
prerequisite. No library or filename key is part of the source API. Elaboration
reads prepared inputs only; it never resolves Lake jobs or builds. -/
elab "include_vir_program" : term => do
  let moduleName := (← getEnv).mainModule
  let source := (System.FilePath.mk (← readThe Lean.Core.Context).fileName).normalize
  -- Match Lean/Lake's complete semantic module suffix, including quoted Name
  -- components. Never split printed names, search ancestors or guess a root.
  let suffix := (Lean.modToFilePath "." moduleName "lean").components.drop 1
  let components := source.components
  unless components.length ≥ suffix.length &&
      components.drop (components.length - suffix.length) == suffix do
    throwError "CARRIER_SUFFIX_MISMATCH: {source} does not match this module's source path"
  let mut root := source
  for _ in [:suffix.length] do
    root := root.parent.getD "."
  let input := Lean.modToFilePath (root / ".vir-generated/inputs") moduleName "path"
  unless ← input.pathExists do
    throwError "VIR_RESOURCE_NOT_PREPARED: {moduleName}; build the owning library with its virResourcePack prerequisite (expected {input})"
  let prepared := System.FilePath.mk (← IO.FS.readFile input)
  embedPrepared prepared

end
end Vir.Resources
