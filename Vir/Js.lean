/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js.Generated

public section

namespace Lean.Vir

/--
Converts a `Nat` to an exact JavaScript number in `0..9007199254740991`
(`Number.MAX_SAFE_INTEGER`), or returns `none` above that range.
Checks the bound in `Nat` before converting to `Float`; never rounds or clamps
an out-of-range input. Unlike `ofNat`, this returns a number, not a bigint.
-/
def JsValue.ofNatNumber? (value : Nat) : RuntimeM (Option (Js Float)) := do
  if value ≤ 9007199254740991 then
    return some (← JsValue.ofFloat value.toFloat)
  else
    return none

namespace Js

namespace Function

-- These identity-only instantiations avoid passing erased type parameters to
-- the six-argument host ABI. They do not wrap the native function or its values.
/-- Plain binary invocation with exact native arguments and result. -/
@[inline] def call2 {α β γ : Type}
    (fn : Js.Function2 (Js α) (Js β) (Js γ)) (a : Js α) (b : Js β) :
    RuntimeM (Js γ) := by
  have invoke := Internal.call2
  unfold Js.Function2 Js.Any Js at *
  exact invoke fn a b

/-- Plain ternary invocation with exact native arguments and result. -/
@[inline] def call3 {α β γ δ : Type}
    (fn : Js.Function3 (Js α) (Js β) (Js γ) (Js δ))
    (a : Js α) (b : Js β) (c : Js γ) : RuntimeM (Js δ) := by
  have invoke := Internal.call3
  unfold Js.Function3 Js.Any Js at *
  exact invoke fn a b c

/-- Plain ternary invocation, discarding its native return value. -/
@[inline] def call3Void {α β γ : Type}
    (fn : Js.Function3 (Js α) (Js β) (Js γ) Unit)
    (a : Js α) (b : Js β) (c : Js γ) : RuntimeM Unit := by
  have invoke := Internal.call3Void
  unfold Js.Function3 Js.Any Js at *
  exact invoke fn a b c

end Function

/-- An effectful JS string literal; expands to the explicit UTF-8 string conversion. -/
scoped macro "js#" value:str : term => `(Lean.Vir.JsValue.ofString $value)

/-- Native template interpolation: embedded Js values undergo JavaScript ToString
left-to-right, once each. Literal syntax uses Lean's interpolation escapes. -/
scoped syntax:max "js#!" interpolatedStr(term) : term

macro_rules
  | `(js#! $text:interpolatedStr) => do
    let mut result ← `(Lean.Vir.JsValue.ofString "")
    let mut started := false
    for chunk in text.raw.getArgs do
      match chunk.isInterpolatedStrLit? with
      | some literal =>
          if literal.isEmpty then continue
          let literal ← `(Lean.Vir.JsValue.ofString $(Lean.quote literal))
          if !started then
            result := literal
          else
            result ← `(do
              let text ← ($result)
              Lean.Vir.Js.String.concat text (← ($literal)))
          started := true
      | none =>
          let value : Lean.TSyntax `term := ⟨chunk⟩
          result ← `(do
            let text ← ($result)
            Lean.Vir.Js.String.interpolate text $value)
          started := true
    return result

/-- Binds the two native tuple entries, evaluating the source once and projecting
indices 0 then 1. This is indexed projection, not JavaScript iterator destructuring. -/
scoped macro "js#let" "(" first:ident "," second:ident ")" " ← " value:term : doElem =>
  `(doElem| do
    let tuple ← ($value)
    let $first ← Lean.Vir.Js.Tuple2.first tuple
    let $second ← Lean.Vir.Js.Tuple2.second tuple)

scoped macro "js#let" "(" first:ident "," second:ident ")" " := " value:term : doElem =>
  `(doElem| js#let ($first, $second) ← pure $value)

/-- Construction-only literal lifting; other expressions retain their effect semantics. -/
meta partial def liftConstructionString (value : Lean.TSyntax `term) :
    Lean.MacroM (Lean.TSyntax `term) :=
  match value with
  | `(js# $literal:str) => `(← Lean.Vir.JsValue.ofString $literal)
  | `(js#! $text:interpolatedStr) => `(← js#! $text)
  | `(($inner:term)) => liftConstructionString inner
  | _ => pure value

/-- Native object construction. Field values are exact JS values; conversions are explicit. -/
scoped syntax "js%{" (str " := " term),* "}" : term

macro_rules
  | `(js%{ $[$names:str := $values:term],* }) => do
    let object ← Lean.Macro.addMacroScope `object
    let object := Lean.mkIdent object
    let writes ← names.zip values |>.mapM fun (name, value) => do
      if (name : Lean.TSyntax `str).getString == "__proto__" then
        Lean.Macro.throwErrorAt name.raw "native object literals do not support `__proto__`; use explicit property operations for prototype semantics"
      let value ← liftConstructionString value
      `(doElem| Lean.Vir.Js.Construction.field $object
          (← Lean.Vir.JsValue.ofString $name) $value)
    `(do
      let $object ← Lean.Vir.Js.Object.empty
      $[$writes:doElem]*
      pure $object)

/-- Native array construction without an intermediate Lean array. -/
scoped syntax "js#[" term,* "]" : term

macro_rules
  | `(js#[ $values:term,* ]) => do
    let array ← Lean.Macro.addMacroScope `array
    let array := Lean.mkIdent array
    let writes ← values.getElems.mapM fun value => do
      let value ← liftConstructionString value
      `(doElem| Lean.Vir.Js.Construction.element $array $value)
    `(do
      let $array ← Lean.Vir.Js.Array.empty
      $[$writes:doElem]*
      pure $array)

/-- Expected JavaScript shape rejected by a checked cast. -/
structure TypeConvError where
  expected : String
deriving BEq, Repr

/--
Checked narrowing from an erased JavaScript value to a target phantom type.

Instances own the relevant JavaScript predicate. A successful check preserves
the exact JavaScript value; it does not decode, copy, or wrap it.
-/
class Cast (m : Type → Type) (target : Type) where
  expected : String
  check : @& Lean.Vir.Js.Any → m (Option (Lean.Vir.Js target))

/-- Returns a checked JavaScript narrowing as an `Option`. -/
def cast? [Cast m target]
    (value : @& Lean.Vir.Js.Any) : m (Option (Lean.Vir.Js target)) :=
  Cast.check value

/--
Narrows an erased JavaScript value with the predicate selected by `Cast`.
-/
def cast [Monad m] [Cast m target]
    (value : @& Lean.Vir.Js.Any) : m (Except TypeConvError (Lean.Vir.Js target)) := do
  match ← cast? value with
  | some result => pure (.ok result)
  | none => pure (.error { expected := Cast.expected (m := m) (target := target) })

namespace Nullable

def toOption {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM (Option (Lean.Vir.Js α)) := do
  if ← Lean.Vir.JsValue.toBool (← isNull value) then
    pure none
  else
    some <$> get value

def ofOption {α : Type} (value : Option (Lean.Vir.Js α)) : RuntimeM (Lean.Vir.Js.Nullable α) :=
  match value with
  | none => null
  | some value => ofJs value

end Nullable

namespace UndefinedOr

/-- Inspects native absence without decoding or copying a present value. -/
def toOption {α : Type} (value : @& Lean.Vir.Js.UndefinedOr α) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  if ← Lean.Vir.JsValue.toBool (← isUndefined value) then
    pure none
  else
    some <$> get value

end UndefinedOr

namespace Array

/-- Builds a native JavaScript array from JavaScript-owned values. -/
def ofArray {α : Type}
    (values : _root_.Array (Lean.Vir.Js α)) :
    RuntimeM (Lean.Vir.Js.Array α) := do
  let array ← empty
  for value in values do
    let _ ← push array value
  pure array

/-- Collects Lean views of the entries, preserving native values and unchecked-index semantics. -/
def toLeanArray {α : Type}
    (array : @& Lean.Vir.Js.Array α) :
    RuntimeM (_root_.Array (Lean.Vir.Js α)) := do
  let size := (← Lean.Vir.JsValue.toFloat (← length array)).toUInt64.toNat
  let mut values := _root_.Array.mkEmpty size
  for index in [:size] do
    let jsIndex ← Lean.Vir.JsValue.ofFloat index.toFloat
    values := values.push (← get array jsIndex)
  pure values

end Array

namespace NodeList

/-- Materializes independent Lean resource handles for the entries of a `NodeList`. -/
def toLeanArray {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList (Lean.Vir.Js α)) :
    RuntimeM (_root_.Array (Lean.Vir.Js α)) := do
  let size := (← Lean.Vir.JsValue.toFloat (← length nodes)).toUInt64.toNat
  let mut values := _root_.Array.mkEmpty size
  for index in [:size] do
    let jsIndex ← Lean.Vir.JsValue.ofFloat index.toFloat
    -- A live NodeList can shrink after the length snapshot.
    if let some value ← Lean.Vir.Js.Nullable.toOption (← item nodes jsIndex) then
      values := values.push value
  pure values

end NodeList

end Js

end Lean.Vir
