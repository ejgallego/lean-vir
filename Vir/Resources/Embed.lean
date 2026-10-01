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
deriving instance ToExpr for ProgramExport
deriving instance ToExpr for Descriptor
deriving instance ToExpr for File
deriving instance ToExpr for Bundle

/-- Embed validated bytes from a source-relative prepared pack. The producer's
library prerequisite must establish this file and trace all semantic inputs. -/
elab "include_vir_bundle " path:str : term => do
  let source := System.FilePath.mk (← readThe Lean.Core.Context).fileName
  -- A bare filename passed to `lean` is relative to its working directory.
  let directory := source.parent.getD "."
  let relative := System.FilePath.mk path.getString
  if relative.isAbsolute then throwError "include_vir_bundle expects a source-relative path"
  let resolved := directory / relative
  let bytes ← Vir.NativePayload.readInput resolved
    (maxPayloadBytes + maxDescriptorBytes + 12) "PACK_LIMIT"
  match Pack.decode bytes with
  | .error error => throwError "invalid resource pack {resolved}: {repr error}"
  | .ok bundle => return toExpr bundle

end
end Vir.Resources
