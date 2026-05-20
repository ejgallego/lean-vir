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

def uint32ArithmeticScore : Nat :=
  let a : UInt32 := 250
  let b : UInt32 := 12
  let c := ((a + b) * 2 - 5) / 3
  let wrap := (4294967295 : UInt32) + 2
  c.toNat + (a % b).toNat + wrap.toNat

def uint32BitwiseScore : Nat :=
  let a : UInt32 := 240
  let b : UInt32 := 51
  let andv := UInt32.land a b
  let xorv := UInt32.xor a b
  let shifted := UInt32.shiftRight (UInt32.shiftLeft andv 2) 1
  let combined := UInt32.lor shifted xorv
  let negBack := UInt32.neg (UInt32.neg 9)
  let compBack := UInt32.complement (UInt32.complement 13)
  combined.toNat + negBack.toNat + compBack.toNat

def uint32CompareScore : Nat :=
  let a : UInt32 := 17
  let b : UInt32 := 21
  let c : UInt32 := 17
  (if a < b then 10 else 0) +
  (if a <= c then 20 else 0) +
  (if a = c then 30 else 0) +
  (if b < a then 100 else 5)

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
