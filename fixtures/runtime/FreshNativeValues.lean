/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Js

public section
open Lean.Vir

def stringEqual := Js.String.equal
def stringConcat := Js.String.concat
def stringSlice := Js.String.slice
def stringIncludes := Js.String.includes
def stringStartsWith := Js.String.startsWith
def stringEndsWith := Js.String.endsWith
def stringTrim := Js.String.trim
def stringToLowerCase := Js.String.toLowerCase
def stringToUpperCase := Js.String.toUpperCase
def numberAdd := Js.Number.add
def numberSub := Js.Number.sub
def numberMul := Js.Number.mul
def numberDiv := Js.Number.div
def numberRem := Js.Number.rem
def numberNeg := Js.Number.neg
def numberEqual := Js.Number.equal
def numberLt := Js.Number.lt
def numberLe := Js.Number.le
def numberIsNaN := Js.Number.isNaN
def numberIsFinite := Js.Number.isFinite
def numberIsInteger := Js.Number.isInteger
def natAdd := Js.Nat.add
def natMul := Js.Nat.mul
def natEqual := Js.Nat.equal
def natLt := Js.Nat.lt
def natLe := Js.Nat.le
def booleanNot := Js.Boolean.not
def booleanEqual := Js.Boolean.equal

def call0 (fn : Js.Function0 Js.Any) : RuntimeM Js.Any :=
  Js.Function.call0 fn

def call0Void (fn : Js.Function0 Unit) : RuntimeM Unit :=
  Js.Function.call0Void fn

def call1 (fn : Js.Function1 Js.Any Js.Any) (a0 : Js.Any) : RuntimeM Js.Any :=
  Js.Function.call fn a0

def call1Void (fn : Js.Function1 Js.Any Unit) (a0 : Js.Any) : RuntimeM Unit :=
  Js.Function.callVoid fn a0

def call2 (fn : Js.Function2 Js.Any Js.Any Js.Any) (a0 : Js.Any) (a1 : Js.Any) : RuntimeM Js.Any :=
  Js.Function.call2 fn a0 a1

def call2Void (fn : Js.Function2 Js.Any Js.Any Unit) (a0 : Js.Any) (a1 : Js.Any) : RuntimeM Unit :=
  Js.Function.call2Void fn a0 a1

def call3 (fn : Js.Function3 Js.Any Js.Any Js.Any Js.Any) (a0 : Js.Any) (a1 : Js.Any) (a2 : Js.Any) : RuntimeM Js.Any :=
  Js.Function.call3 fn a0 a1 a2

def call3Void (fn : Js.Function3 Js.Any Js.Any Js.Any Unit) (a0 : Js.Any) (a1 : Js.Any) (a2 : Js.Any) : RuntimeM Unit :=
  Js.Function.call3Void fn a0 a1 a2
