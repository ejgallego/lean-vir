/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Init.Data.Nat.Bitwise.Basic
import Init.Data.Nat.Log2
import Init.Data.Array.Set
import Init.Data.ByteArray.Basic
import Init.Data.Float.Float32
import Init.Data.SInt.Basic
import Init.Data.String.Basic
import Init.Data.String.Modify
import Init.Data.String.Search
import Init.Data.String.Substring
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

@[noinline]
private def intDivisionCaseScore
    (a b expectedEdiv expectedTdiv : Int) (weight : Nat) : Nat :=
  (if a.ediv b == expectedEdiv then weight else 0) +
    (if a.tdiv b == expectedTdiv then weight * 2 else 0)

/-- Exercises Euclidean and truncating division for scalar and big integers. -/
def intDivisionScore : Nat :=
  let big : Int := 123456789012345678901234567891
  intDivisionCaseScore (-12) 7 (-2) (-1) 1 +
    intDivisionCaseScore 12 (-7) (-1) (-1) 4 +
    intDivisionCaseScore (-12) (-7) 2 1 16 +
    intDivisionCaseScore 12 0 0 0 64 +
    intDivisionCaseScore (-big) 10 (-12345678901234567890123456790)
      (-12345678901234567890123456789) 256 +
    intDivisionCaseScore (-big) (-10) 12345678901234567890123456790
      12345678901234567890123456789 1024

@[noinline]
private def scalarPrimitiveScore (a b : Int) : Nat :=
  let int8Ok := Int8.toInt (Int8.mul (Int8.ofInt a) (Int8.ofInt b)) == -42
  let int16Ok := Int16.toInt (Int16.mul (Int16.ofInt a) (Int16.ofInt b)) == -42
  let int32Ok := Int32.toInt (Int32.mul (Int32.ofInt a) (Int32.ofInt b)) == -42
  let int64Ok := Int64.toInt (Int64.mul (Int64.ofInt a) (Int64.ofInt b)) == -42
  let isizeOk := ISize.toInt (ISize.mul (ISize.ofInt a) (ISize.ofInt b)) == -42
  (if int8Ok then 1 else 0) +
    (if int16Ok then 2 else 0) +
    (if int32Ok then 4 else 0) +
    (if int64Ok then 8 else 0) +
    (if isizeOk then 16 else 0)

@[noinline]
private def stringPrimitiveScore (s : String) : Nat :=
  let listOk := s.toList == ['A', 'é', '∀', 'Z']
  let capitalizeOk := String.Internal.capitalize "lean" == "Lean"
  let intercalateOk := String.Internal.intercalate "|" ["a", "β", "c"] == "a|β|c"
  let anyOk := String.Internal.any s (· == '∀')
  let raw := s.toRawSubstring
  let extracted := Substring.Raw.Internal.extract raw raw.startPos raw.stopPos
  let substringOk := Substring.Raw.Internal.toString extracted == s
  (if listOk then 1 else 0) +
    (if capitalizeOk then 2 else 0) +
    (if intercalateOk then 4 else 0) +
    (if anyOk then 8 else 0) +
    (if substringOk then 16 else 0)

def scalarPrimitiveFrontierScore : Nat :=
  scalarPrimitiveScore (-7) 6

def stringPrimitiveFrontierScore : Nat :=
  stringPrimitiveScore "Aé∀Z"

def natPrimitiveFrontierScore : Nat :=
  (if Nat.gcd 84 30 == 6 then 1 else 0) +
    (if Nat.xor 13 11 == 6 then 2 else 0)

/-- Exercises representative scalar, Nat, String, and Substring primitive families. -/
def primitiveAbiFrontierScore : Nat :=
  scalarPrimitiveFrontierScore +
    32 * stringPrimitiveFrontierScore +
    1024 * natPrimitiveFrontierScore

def intCompareScore : Nat :=
  let a : Int := -12
  let b : Int := 5
  let c : Int := -12
  (if a = c then 10 else 0) +
  (if a <= b then 20 else 0) +
  (if b <= a then 100 else 5)

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

def uint16UInt32ConversionScore : Nat :=
  let narrow : UInt16 := 65000
  let widened := narrow.toUInt32
  let wrapped := (70000 : UInt32).toUInt16
  widened.toNat + wrapped.toNat

def arrayProofOpsScore : Nat :=
  let xs : Array Nat := #[10, 20, 30]
  let checked := xs.getInternal 1 (by decide)
  let fallback := xs.get!Internal 2
  let unchecked := xs.uget 0 (by decide)
  let setResult := xs.set 0 40 (by decide)
  let setBangResult := xs.set! 1 50
  let usetResult := (#[10, 20, 30] : Array Nat).uset 2 60 (by simp)
  let swapped := xs.swap 0 2 (by decide) (by decide)
  checked + fallback + unchecked +
    setResult.get!Internal 0 +
    setBangResult.get!Internal 1 +
    usetResult.get!Internal 2 +
    swapped.get!Internal 0

def byteArrayMkGetScore : Nat :=
  let bytes : ByteArray := ByteArray.mk #[65, 66, 67]
  (bytes.get 1 (by decide)).toNat + (bytes.get 2 (by decide)).toNat + bytes.size

/-- Exercises growing and overlapping byte-array copies; success scores 5795. -/
def byteArrayCopySliceFrontierScore : Nat :=
  let src : ByteArray := ByteArray.mk #[10, 20, 30, 40, 50]
  let dest : ByteArray := ByteArray.mk #[1, 2, 3]
  let grown := src.copySlice 1 dest 2 3
  let overlap := src.copySlice 0 src 1 4 false
  1000 * grown.size +
    (grown.get! 0).toNat + 2 * (grown.get! 1).toNat +
    3 * (grown.get! 2).toNat + 4 * (grown.get! 3).toNat +
    5 * (grown.get! 4).toNat +
    (overlap.get! 0).toNat + 2 * (overlap.get! 1).toNat +
    3 * (overlap.get! 2).toNat + 4 * (overlap.get! 3).toNat +
    5 * (overlap.get! 4).toNat

def stringParserDataScore : Nat :=
  let s := "Aé∀Z"
  let hashScore := s.hash.toNat % 97
  let validScore :=
    (if String.Pos.Raw.isValid s ⟨1⟩ then 10 else 0) +
    (if String.Pos.Raw.isValid s ⟨2⟩ then 100 else 3)
  let containsScore := if String.Internal.contains s '∀' then 20 else 0
  hashScore + validScore + containsScore

/-- Reads every raw byte of a mixed-width UTF-8 string; success scores 3944. -/
def stringInternalGetUTF8ByteFrontierScore : Nat :=
  let s := "Aé∀Z"
  (String.Internal.getUTF8Byte s 0 (by decide)).toNat +
    2 * (String.Internal.getUTF8Byte s 1 (by decide)).toNat +
    3 * (String.Internal.getUTF8Byte s 2 (by decide)).toNat +
    4 * (String.Internal.getUTF8Byte s 3 (by decide)).toNat +
    5 * (String.Internal.getUTF8Byte s 4 (by decide)).toNat +
    6 * (String.Internal.getUTF8Byte s 5 (by decide)).toNat +
    7 * (String.Internal.getUTF8Byte s 6 (by decide)).toNat

unsafe def nameHashSubstringPtrScore : Nat :=
  let sameName := Lean.Name.beq `Lean.Parser `Lean.Parser
  let diffName := Lean.Name.beq `Lean.Parser `Lean.Elab
  let smallNumeralName := Lean.Name.num `Lean.Parser 37
  let largestUInt64NumeralName := Lean.Name.num `Lean.Parser (UInt64.size - 1)
  let oversizedNumeralName := Lean.Name.num `Lean.Parser UInt64.size
  let nameHashScore :=
    (`Lean.Parser).hash.toNat % 1009 +
    (`Lean.Elab).hash.toNat % 1009 +
    smallNumeralName.hash.toNat % 1009 +
    largestUInt64NumeralName.hash.toNat % 1009 +
    oversizedNumeralName.hash.toNat % 1009
  let raw1 : Substring.Raw := ⟨"abcdef", ⟨1⟩, ⟨4⟩⟩
  let raw2 : Substring.Raw := ⟨"abcdef", ⟨1⟩, ⟨4⟩⟩
  let raw3 : Substring.Raw := ⟨"abcdef", ⟨2⟩, ⟨4⟩⟩
  let sameSubstring := Substring.Raw.Internal.beq raw1 raw2
  let diffSubstring := Substring.Raw.Internal.beq raw1 raw3
  let xs := [1, 2, 3]
  let samePtr := ptrAddrUnsafe xs == ptrAddrUnsafe xs
  (mixHash 17 23).toNat % 101 +
  nameHashScore +
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

@[noinline]
private def floatCorePrimitiveScore (a b : Float) (float32Bits : UInt32) : Nat :=
  let sum := Float.add a b
  let sumOk := Float.beq sum 3.75
  let orderOk := decide (a < b)
  let sumModelOk := (Float.toModel sum).toBits == 0x400e000000000000
  let value32 := Float32.ofBits float32Bits
  let order32Ok := decide (value32 ≤ value32)
  let model32Ok := (Float32.toModel value32).toBits == float32Bits
  (if sumOk then 1 else 0) +
    (if orderOk then 2 else 0) +
    (if sumModelOk then 4 else 0) +
    (if order32Ok then 8 else 0) +
    (if model32Ok then 16 else 0)

/-- Exercises the seven-member, size-priced Float/Float32 runtime frontier. -/
def floatCoreFrontierScore : Nat :=
  floatCorePrimitiveScore 1.5 2.25 0x3fc00000

@[noinline]
private def floatFormattingPrimitiveScore
    (positive negative : Float) (float32Bits : UInt32) : Nat :=
  let output :=
    Float.toString positive ++ "|" ++
    Float.toString negative ++ "|" ++
    Float32.toString (Float32.ofBits float32Bits)
  output.hash.toNat

/-- Exercises exact Float and Float32 formatting against the native oracle. -/
def floatFormattingFrontierScore : Nat :=
  floatFormattingPrimitiveScore 3.75 (-0.125) 0x3fc00000

@[noinline]
private def floatBasicCompletionPrimitiveScore
    (aBits bBits : UInt32) (infinityBits : UInt64) : Nat :=
  let a := Float32.ofBits aBits
  let b := Float32.ofBits bBits
  let addOk := Float32.beq (Float32.add a b) (Float32.ofBits 0x40600000)
  let mulOk := Float32.beq (Float32.mul a b) (Float32.ofBits 0x40400000)
  let divOk := Float32.beq (Float32.div b b) (Float32.ofBits 0x3f800000)
  let subOk := Float32.beq (Float32.sub b a) (Float32.ofBits 0x3f000000)
  let negOk := Float32.beq (Float32.neg a) (Float32.ofBits 0xbfc00000)
  let eqOk := Float32.beq a a
  let orderOk := decide (a < b)
  let infinityOk := Float.isInf (Float.ofBits infinityBits)
  (if addOk then 1 else 0) +
    (if mulOk then 2 else 0) +
    (if divOk then 4 else 0) +
    (if subOk then 8 else 0) +
    (if negOk then 16 else 0) +
    (if eqOk then 32 else 0) +
    (if orderOk then 64 else 0) +
    (if infinityOk then 128 else 0)

/-- Exercises the eight-member basic Float completion; success scores 255. -/
def floatBasicCompletionFrontierScore : Nat :=
  floatBasicCompletionPrimitiveScore 0x3fc00000 0x40000000 0x7ff0000000000000

end Vir.Fixtures.Boundary
