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
