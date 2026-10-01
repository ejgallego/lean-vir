/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public meta import Lean.ToExpr
public meta import Vir.BinaryLiteral

namespace Vir.BinaryLiteral

/-- Embed owned bytes as a compact string literal and a call to the pure decoder.
Callers own input acquisition and validation; this operation never reads a file.
Keep this explicit rather than registering a global `ToExpr ByteArray` instance.
The caller's ordinary imports must make `Vir.BinaryLiteral.decode!` available. -/
public meta def toExpr (bytes : ByteArray) : Lean.Expr :=
  Lean.mkApp2 (Lean.mkConst ``decode!)
    (Lean.mkStrLit (encode bytes)) (Lean.toExpr bytes.size)

end Vir.BinaryLiteral
