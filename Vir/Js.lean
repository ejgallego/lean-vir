/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js.Generated

public section

namespace Lean.Vir

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

def isNull {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM Bool := do
  let flag ← isNullJs value
  Lean.Vir.JsValue.toBool flag

def toOption {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM (Option (Lean.Vir.Js α)) := do
  if ← isNull value then
    pure none
  else
    some <$> get value

def ofOption {α : Type} (value : Option (Lean.Vir.Js α)) : RuntimeM (Lean.Vir.Js.Nullable α) :=
  match value with
  | none => null
  | some value => ofJs value

end Nullable

private def collectResourceItems {α : Type}
    (item : Nat → RuntimeM (Option (Lean.Vir.Js α))) :
    (remaining index : Nat) →
    _root_.Array (Lean.Vir.Js α) →
    RuntimeM (_root_.Array (Lean.Vir.Js α))
  | 0, _, values => pure values
  | remaining + 1, index, values => do
      let values :=
        match ← item index with
        | none => values
        | some value => values.push value
      collectResourceItems item remaining (index + 1) values

private def arrayResourceItem? {α : Type}
    (size : Nat)
    (item : Lean.Vir.Js Float → RuntimeM (Lean.Vir.Js α))
    (index : Nat) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  if index < size then
    let jsIndex ← Lean.Vir.JsValue.ofFloat index.toFloat
    some <$> item jsIndex
  else
    pure none

private def nullableCollectionResourceItem? {α : Type}
    (size : Nat)
    (item : Lean.Vir.Js Float → RuntimeM (Lean.Vir.Js.Nullable α))
    (index : Nat) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  if index < size then
    let jsIndex ← Lean.Vir.JsValue.ofFloat index.toFloat
    Lean.Vir.Js.Nullable.toOption (← item jsIndex)
  else
    pure none

namespace Array

/-- Reads one array slot with an explicitly selected JavaScript phantom type. -/
def getJs {α : Type}
    (array : @& Lean.Vir.Js.Array (Lean.Vir.Js α))
    (index : @& Lean.Vir.Js Float) :
    RuntimeM (Lean.Vir.Js α) :=
  getAs array index

/-- Builds a native JavaScript array from JavaScript-owned values. -/
def ofArray {α : Type}
    (values : _root_.Array (Lean.Vir.Js α)) :
    RuntimeM (Lean.Vir.Js.Array (Lean.Vir.Js α)) := do
  let array ← empty
  for value in values do
    let _ ← push array value
  pure array

/-- Returns the current JavaScript array length as a Lean `Nat`. -/
def length {α : Type} (array : @& Lean.Vir.Js.Array α) : RuntimeM Nat := do
  return (← Lean.Vir.JsValue.toFloat (← lengthJs array)).toUInt64.toNat

/-- Returns the resource at `index`, or `none` when the index is out of bounds. -/
def item {α : Type}
    (array : @& Lean.Vir.Js.Array (Lean.Vir.Js α))
    (index : Nat) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  arrayResourceItem? (← length array) (getJs array) index

/-- Materializes independent Lean resource handles for the entries of a JavaScript array. -/
def toLeanArray {α : Type}
    (array : @& Lean.Vir.Js.Array (Lean.Vir.Js α)) :
    RuntimeM (_root_.Array (Lean.Vir.Js α)) := do
  let size ← length array
  collectResourceItems
    (arrayResourceItem? size (getJs array))
    size 0 (_root_.Array.mkEmpty size)

end Array

namespace NodeList

/-- Returns the current `NodeList.length` as a Lean `Nat`. -/
def length {α : Type} (nodes : @& Lean.Vir.Js.NodeList α) : RuntimeM Nat := do
  return (← Lean.Vir.JsValue.toFloat (← lengthJs nodes)).toUInt64.toNat

/-- Calls `NodeList.item`, returning `none` when the index is out of bounds. -/
def item {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList (Lean.Vir.Js α))
    (index : Nat) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  nullableCollectionResourceItem? (← length nodes) (itemNullable nodes) index

/-- Materializes independent Lean resource handles for the entries of a `NodeList`. -/
def toLeanArray {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList (Lean.Vir.Js α)) :
    RuntimeM (_root_.Array (Lean.Vir.Js α)) := do
  let size ← length nodes
  collectResourceItems
    (nullableCollectionResourceItem? size (itemNullable nodes))
    size 0 (_root_.Array.mkEmpty size)

end NodeList

end Js

end Lean.Vir
