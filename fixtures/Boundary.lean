/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Vir.Fixtures.Boundary

def uint32LiteralToNatScore : Nat :=
  let x : UInt32 := 123
  x.toNat + 1

def floatToUInt32Score : Nat :=
  let x : Float := 3.0
  x.toUInt32.toNat

end Vir.Fixtures.Boundary
