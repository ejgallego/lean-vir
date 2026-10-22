/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module
public import Init
public meta import Vir.Attributes
public section

namespace Primitives

@[vir_export] def byteSize (bytes : ByteArray) : USize := bytes.usize

@[vir_export] def byteSet (bytes : ByteArray) (index : USize) (value : UInt8) : ByteArray :=
  if h : index.toNat < bytes.size then bytes.uset index value h else bytes

-- Keep both results alive so uset must copy the shared input.
@[vir_export] def byteSetShared (bytes : ByteArray) (index : USize) (value : UInt8) :
    ByteArray × ByteArray :=
  (bytes, byteSet bytes index value)

-- The temporary input is owned exclusively when it reaches uset.
@[vir_export] def byteSetFresh (value : UInt8) : ByteArray :=
  byteSet (ByteArray.empty.push value |>.push 2 |>.push 3) 1 value

@[vir_export] def floatByte (value : Float) : UInt8 := value.toUInt8
@[vir_export] def floatInt (value : Float) : Int := value.toInt64.toInt
@[vir_export] def byteEqual (left right : ByteArray) : Bool := left == right

@[vir_export] def charValue (value : Nat) : Nat :=
  if h : value.isValidChar then (Char.ofNatAux value h).toNat else 0

-- Exercise the other declaration sharing the raw provider in the same package.
@[vir_export] def uintValue (value : Nat) : UInt32 := UInt32.ofNat value

-- Run the same operations through Lean's native providers for a differential check.
@[vir_export] def oracle (_ : Unit) : String := Id.run do
  let bytes := ByteArray.empty.push 1 |>.push 2 |>.push 255
  let shared := byteSetShared bytes 1 128
  let mut values := [toString (byteSize bytes), toString shared.1.data,
    toString shared.2.data, toString (byteSetFresh 42).data,
    toString (byteEqual shared.1 bytes), toString (byteEqual shared.1 shared.2)]
  for x in [0.0, -0.0, -1.5, 1.5, 255.9, 256.0, 0.0 / 0.0, 1.0 / 0.0,
      -1.0 / 0.0, 9223372036854775808.0, -9223372036854775808.0] do
    values := values ++ [toString (floatByte x), toString (floatInt x)]
  for n in [0, 65, 0xD7FF, 0xD800, 0xDFFF, 0xE000, 0x10FFFF, 0x110000,
      4294967296, 18446744073709551616] do
    values := values ++ [toString (charValue n), toString (uintValue n)]
  return String.intercalate "|" values

end Primitives

def main : IO Unit := IO.println (Primitives.oracle ())
