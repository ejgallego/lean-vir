/-
Copyright (c) 2025–2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: David Thrane Christiansen, Emilio J. Gallego Arias
-/
module

public import Init

/-! Internal binary-literal transport. Uses the Z85 technique from VersoUtil.BinFiles
at af35c08a123574b36aaf4f435eaaf492ce5da985 (Apache-2.0), without a Verso dependency.
Four bytes become five printable ASCII characters; the original length removes
zero padding. Decoding is checked, including overflow and nonzero padding.
This encoding is an implementation detail, not a resource interchange format. -/

namespace Vir.Resources.Bytes

private def alphabet : ByteArray :=
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#".toUTF8

private def lookup : Array Nat := Id.run do
  let mut result := Array.replicate 256 85
  for i in [:85] do result := result.set! alphabet[i]!.toNat i
  return result

public def encode (bytes : ByteArray) : String := Id.run do
  let mut out := ByteArray.emptyWithCapacity ((bytes.size + 3) / 4 * 5)
  for block in [:(bytes.size + 3) / 4] do
    let mut word : UInt32 := 0
    for i in [:4] do
      let offset := block * 4 + i
      word := (word <<< 8) ||| (bytes[offset]?.getD 0).toUInt32
    for divisor in #[52200625, 614125, 7225, 85, 1] do
      out := out.push alphabet[((word / divisor) % 85).toNat]!
  return String.fromUTF8! out

public def decode (text : String) (size : Nat) : Except String ByteArray := do
  let data := text.toUTF8
  unless data.size == (size + 3) / 4 * 5 do throw "binary literal length mismatch"
  let mut out := ByteArray.emptyWithCapacity size
  for block in [:data.size / 5] do
    let mut word : UInt64 := 0
    for i in [:5] do
      let digit := lookup[data[block*5+i]!.toNat]!
      if digit ≥ 85 then throw "invalid binary literal character"
      word := word * 85 + digit.toUInt64
    if word > 0xffffffff then throw "binary literal overflow"
    for i in [:4] do
      let byte := (word >>> ((3-i)*8).toUInt64).toUInt8
      if block*4+i < size then out := out.push byte
      else if byte != 0 then throw "nonzero binary literal padding"
  return out

/-- Used only for validated literals produced by the inclusion elaborator. -/
public def decode! (text : String) (size : Nat) : ByteArray :=
  match decode text size with
  | .ok bytes => bytes
  | .error message => panic! message

end Vir.Resources.Bytes
