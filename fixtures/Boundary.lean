/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Init.Data.Nat.Bitwise.Basic
import Init.Data.Nat.Log2

namespace Vir.Fixtures.Boundary

def uint32LiteralToNatScore : Nat :=
  let x : UInt32 := 123
  x.toNat + 1

def natShiftPowDivScore : Nat :=
  let shifted := Nat.shiftLeft 5 3
  let back := Nat.shiftRight shifted 2
  back + Nat.pow 2 5 + Nat.log2 64 + Nat.div 17 3

def intArithmeticScore : Nat :=
  let x : Int := ((10 : Int) + (-3 : Int)) * (2 : Int) - (5 : Int)
  x.toNat

def uint32OfNatToNatScore : Nat :=
  let n := Nat.shiftLeft 7 4
  let x := UInt32.ofNat n
  x.toNat + 2

def uint64ToFloatScore : Nat :=
  let n := Nat.shiftLeft 3 5
  let x := UInt64.ofNat n
  x.toFloat.toUInt32.toNat + 4

def floatScaleScore : Nat :=
  let x := Float.scaleB 1.5 (2 : Int)
  x.toUInt32.toNat

def floatToUInt32Score : Nat :=
  let x : Float := 3.0
  x.toUInt32.toNat

end Vir.Fixtures.Boundary
