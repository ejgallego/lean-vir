/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module
public import Init.Data.Float
public meta import Vir.Attributes
public section
namespace FloatMinMax

-- Exercise the ordinary instances used by editor and SVG closures.
@[vir_export] def minimum (left right : Float) : Float := min left right
@[vir_export] def maximum (left right : Float) : Float := max left right
@[vir_export] def minimumBits (left right : UInt64) : UInt64 :=
  (minimum (Float.ofBits left) (Float.ofBits right)).toBits
@[vir_export] def maximumBits (left right : UInt64) : UInt64 :=
  (maximum (Float.ofBits left) (Float.ofBits right)).toBits

-- Include quiet/signaling NaNs, infinities, extremes, subnormals and both zeros.
def inputs : List UInt64 := [
  0x7ff8000000000001, 0x7ff0000000000001, 0xfff8000000000001,
  0xfff0000000000000, 0xffefffffffffffff, 0xbff0000000000000,
  0x8000000000000001, 0x8000000000000000, 0,
  1, 0x3ff0000000000000, 0x7fefffffffffffff, 0x7ff0000000000000]

def resultText (value : Float) : String :=
  if value.isNaN then "nan" else toString value.toBits

@[vir_export] def oracle (_ : Unit) : String := Id.run do
  let mut results : List String := []
  for left in inputs do
    for right in inputs do
      let left := Float.ofBits left
      let right := Float.ofBits right
      results := resultText (minimum left right) :: resultText (maximum left right) :: results
  return String.intercalate "|" results.reverse

end FloatMinMax

def main : IO Unit := IO.println (FloatMinMax.oracle ())
