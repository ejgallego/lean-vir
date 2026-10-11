/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module
public import Init.Data.Float
public meta import Vir.Attributes
public section
namespace FloatMath

@[vir_export] def exp (x : Float) : Float := x.exp
@[vir_export] def log (x : Float) : Float := x.log
@[vir_export] def isNaN (x : Float) : Bool := x.isNaN
@[vir_export] def isFinite (x : Float) : Bool := x.isFinite
@[vir_export] def ceil (x : Float) : Float := x.ceil
@[vir_export] def bits (x : Float) : UInt64 := x.toBits
@[vir_export] def pow (x y : Float) : Float := x ^ y
@[vir_export] def exp2 (x : Float) : Float := x.exp2
@[vir_export] def log10 (x : Float) : Float := x.log10
@[vir_export] def tan (x : Float) : Float := x.tan
@[vir_export] def asin (x : Float) : Float := x.asin
@[vir_export] def atan (x : Float) : Float := x.atan
@[vir_export] def narrow (x : Float) : Float32 := x.toFloat32
@[vir_export] def fma (x y z : Float) : Float := x.fma y z

@[vir_export] def nan32 (x : Float32) : Bool := x.isNaN
@[vir_export] def finite32 (x : Float32) : Bool := x.isFinite
@[vir_export] def inf32 (x : Float32) : Bool := x.isInf
@[vir_export] def bits32 (x : Float32) : UInt32 := x.toBits
@[vir_export] def widen (x : Float32) : Float := x.toFloat
@[vir_export] def abs32 (x : Float32) : Float32 := x.abs
@[vir_export] def sqrt32 (x : Float32) : Float32 := x.sqrt
@[vir_export] def floor32 (x : Float32) : Float32 := x.floor
@[vir_export] def ceil32 (x : Float32) : Float32 := x.ceil
@[vir_export] def round32 (x : Float32) : Float32 := x.round
@[vir_export] def fma32 (x y z : Float32) : Float32 := x.fma y z
end FloatMath
