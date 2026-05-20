/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Init.Data.Nat.Bitwise.Basic
import Init.Data.Nat.Log2
import Init.Data.Array.Set
import Init.Data.ByteArray.Basic
import Init.Data.String.Basic
import Init.System.IO

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

def uint8OperationsScore : Nat :=
  let a : UInt8 := 250
  let b : UInt8 := 12
  let arith := ((a + b) * 2 - 5) / 3
  let wrap := (255 : UInt8) + 2
  let andv := UInt8.land 240 51
  let xorv := UInt8.xor 240 51
  let shifted := UInt8.shiftRight (UInt8.shiftLeft andv 2) 1
  let combined := UInt8.lor shifted xorv
  let negBack := UInt8.neg (UInt8.neg 9)
  let compBack := UInt8.complement (UInt8.complement 13)
  arith.toNat + (a % b).toNat + wrap.toNat + combined.toNat +
  negBack.toNat + compBack.toNat +
  (if (17 : UInt8) < 21 then 10 else 0) +
  (if (17 : UInt8) <= 17 then 20 else 0) +
  (if (17 : UInt8) = 17 then 30 else 0) +
  (if (21 : UInt8) < 17 then 100 else 5)

def uint16OperationsScore : Nat :=
  let a : UInt16 := 65000
  let b : UInt16 := 1234
  let arith := ((a + b) * 3 - 17) / 7
  let wrap := (65535 : UInt16) + 3
  let andv := UInt16.land 61680 4951
  let xorv := UInt16.xor 61680 4951
  let shifted := UInt16.shiftRight (UInt16.shiftLeft andv 2) 1
  let combined := UInt16.lor shifted xorv
  let negBack := UInt16.neg (UInt16.neg 19)
  let compBack := UInt16.complement (UInt16.complement 27)
  arith.toNat + (a % b).toNat + wrap.toNat + combined.toNat +
  negBack.toNat + compBack.toNat +
  (if (17 : UInt16) < 21 then 10 else 0) +
  (if (17 : UInt16) <= 17 then 20 else 0) +
  (if (17 : UInt16) = 17 then 30 else 0) +
  (if (21 : UInt16) < 17 then 100 else 5)

def uint64ArithmeticScore : Nat :=
  let a : UInt64 := 100000
  let b : UInt64 := 321
  let arith := ((a + b) * 7 - 20) / 11
  let wrap := (18446744073709551615 : UInt64) + 8
  arith.toNat + (a % b).toNat + wrap.toNat

def uint64BitwiseCompareScore : Nat :=
  let a : UInt64 := 16711935
  let b : UInt64 := 61680
  let andv := UInt64.land a b
  let xorv := UInt64.xor a b
  let shifted := UInt64.shiftRight (UInt64.shiftLeft andv 4) 2
  let combined := UInt64.lor shifted xorv
  let negBack := UInt64.neg (UInt64.neg 29)
  let compBack := UInt64.complement (UInt64.complement 31)
  combined.toNat + negBack.toNat + compBack.toNat +
  (if (17 : UInt64) < 21 then 10 else 0) +
  (if (17 : UInt64) <= 17 then 20 else 0) +
  (if (17 : UInt64) = 17 then 30 else 0) +
  (if (21 : UInt64) < 17 then 100 else 5)

def uint64LargeToNatScore : Nat :=
  let high := UInt64.shiftLeft 1 63
  (high + 12345).toNat

def largeNatLiteralScore : Nat :=
  let n : Nat := 18446744073709551616
  if n = UInt64.size then 42 else 0

def uint64ToFloatScore : Nat :=
  let n := Nat.shiftLeft 3 5
  let x := UInt64.ofNat n
  x.toFloat.toUInt32.toNat + 4

def usizeParserDataScore : Nat :=
  let a : USize := USize.ofNat 42
  let b : USize := USize.ofNat 5
  let diff := USize.sub a b
  let product := USize.mul diff 3
  let masked := USize.land (USize.shiftLeft product b) 255
  let shifted := USize.shiftRight masked 1
  product.toNat + shifted.toNat + (if b <= a then 11 else 0)

def uintConversionParserDataScore : Nat :=
  let wide := UInt64.ofNatLT 123456 (by decide)
  let narrowed := wide.toUSize
  let byte := (511 : UInt32).toUInt8
  narrowed.toNat + byte.toNat

def arrayProofOpsScore : Nat :=
  let xs : Array Nat := Array.emptyWithCapacity 4
  let xs := (xs.push 10).push 20 |>.push 30
  let mid := xs.getInternal 1 (by decide)
  let xs := xs.set 0 99 (by decide)
  let xs := xs.swap 0 2 (by decide) (by decide)
  mid +
  xs.getInternal 0 (by decide) +
  xs.getInternal 1 (by decide) +
  xs.getInternal 2 (by decide)

def byteArrayMkGetScore : Nat :=
  let bytes : ByteArray := ByteArray.mk #[65, 66, 67]
  (bytes.get 1 (by decide)).toNat + (bytes.get 2 (by decide)).toNat + bytes.size

def stringParserDataScore : Nat :=
  let s := "Aé∀Z"
  let hashScore := s.hash.toNat % 97
  let validScore :=
    (if String.Pos.Raw.isValid s ⟨1⟩ then 10 else 0) +
    (if String.Pos.Raw.isValid s ⟨2⟩ then 100 else 3)
  let containsScore := if String.Internal.contains s '∀' then 20 else 0
  hashScore + validScore + containsScore

unsafe def nameHashSubstringPtrScore : Nat :=
  let sameName := Lean.Name.beq `Lean.Parser `Lean.Parser
  let diffName := Lean.Name.beq `Lean.Parser `Lean.Elab
  let raw1 : Substring.Raw := ⟨"abcdef", ⟨1⟩, ⟨4⟩⟩
  let raw2 : Substring.Raw := ⟨"abcdef", ⟨1⟩, ⟨4⟩⟩
  let raw3 : Substring.Raw := ⟨"abcdef", ⟨2⟩, ⟨4⟩⟩
  let sameSubstring := Substring.Raw.Internal.beq raw1 raw2
  let diffSubstring := Substring.Raw.Internal.beq raw1 raw3
  let xs := [1, 2, 3]
  let samePtr := ptrAddrUnsafe xs == ptrAddrUnsafe xs
  (mixHash 17 23).toNat % 101 +
  (if sameName then 10 else 0) +
  (if diffName then 100 else 3) +
  (if sameSubstring then 20 else 0) +
  (if diffSubstring then 200 else 5) +
  (if samePtr then 30 else 0)

unsafe def ioRefReadBoundaryScore : Nat :=
  match unsafeIO do
    let initializing ← IO.initializing
    let ref ← IO.mkRef 41
    let value ← ref.get
    pure (value + if initializing then 100 else 1) with
  | .ok score => score
  | .error _ => 1000

unsafe def ioRefModifyBoundaryScore : Nat :=
  match unsafeIO do
    let ref ← IO.mkRef 40
    let old ← ref.modifyGet fun value => (value, value + 2)
    let value ← ref.get
    pure (old + value) with
  | .ok score => score
  | .error _ => 1000

def floatScaleScore : Nat :=
  let x := Float.scaleB 1.5 (2 : Int)
  x.toUInt32.toNat

def floatToUInt32Score : Nat :=
  let x : Float := 3.0
  x.toUInt32.toNat

end Vir.Fixtures.Boundary
