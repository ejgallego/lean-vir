/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Js.Generated

namespace Lean.Vir

namespace Js

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
