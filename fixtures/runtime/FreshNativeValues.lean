/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Js

public section
open Lean.Vir
open scoped Lean.Vir.Js

def narrowString := Js.String.fromAny
def narrowNumber := Js.Number.fromAny
def narrowBoolean := Js.Boolean.fromAny
def isString := Js.String.isString
def isNumber := Js.Number.isNumber
def isBoolean := Js.Boolean.isBoolean
def castString (value : Js.Any) : RuntimeM (Js.Nullable String) := do
  Js.Nullable.ofOption (← Js.cast? value)
def castNumber (value : Js.Any) : RuntimeM (Js.Nullable Float) := do
  Js.Nullable.ofOption (← Js.cast? value)
def castBoolean (value : Js.Any) : RuntimeM (Js.Nullable Bool) := do
  Js.Nullable.ofOption (← Js.cast? value)

def numberString := Js.Number.toString
def natString := Js.Nat.toString
def interpolate (value : Js.Any) : RuntimeM (Js String) := js#!"value:{value}!"
def interpolateSequence (first second : Js.Function0 Js.Any) : RuntimeM (Js String) :=
  js#!"{← Js.Function.call0 first}|{← Js.Function.call0 second}"

def arrayFilter (values : Js.Array Js.Any.Value)
    (predicate : Js.Function3 Js.Any (Js Float) (Js.Array Js.Any.Value) Js.Any) :=
  Js.Array.filter values predicate
def arrayFind (values : Js.Array Js.Any.Value)
    (predicate : Js.Function3 Js.Any (Js Float) (Js.Array Js.Any.Value) Js.Any) :=
  Js.Array.find values predicate
def arraySome (values : Js.Array Js.Any.Value)
    (predicate : Js.Function3 Js.Any (Js Float) (Js.Array Js.Any.Value) Js.Any) :=
  Js.Array.some values predicate
def arrayEvery (values : Js.Array Js.Any.Value)
    (predicate : Js.Function3 Js.Any (Js Float) (Js.Array Js.Any.Value) Js.Any) :=
  Js.Array.every values predicate
def arrayJoin (values : Js.Array Js.Any.Value) (separator : Js.UndefinedOr String) :=
  Js.Array.join values separator
def arrayForEach (values : Js.Array Js.Any.Value)
    (visit : Js.Function3 Js.Any (Js Float) (Js.Array Js.Any.Value) Unit) : RuntimeM Unit := do
  let visit ← Js.Function.ofLean3Void fun value index source =>
    Js.Function.call3Void visit value index source
  Js.Array.forEach values visit
def binaryVoid (visit : Js.Function2 Js.Any Js.Any Unit) (a b : Js.Any) : RuntimeM Unit := do
  let visit ← Js.Function.ofLean2Void fun a b => Js.Function.call2Void visit a b
  Js.Function.call2Void visit a b

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
