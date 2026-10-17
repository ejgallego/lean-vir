/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Lean.Data.Json.Printer
public section
namespace Vir.JsonSafeWriter

/-- Canonical protocol formatting, independent of application display instances. -/
def nat (value : Nat) (out : String) : String :=
  out ++ Lean.Json.renderString (Nat.repr value)

def int (value : Int) (out : String) : String :=
  out ++ Lean.Json.renderString (Int.repr value)

def unsigned (value : Nat) (out : String) : String := out ++ Nat.repr value

/-- Internal runtime support for generated writers. This streams one sequence
into the output accumulator without constructing a Lean.Json value graph. -/
def array (write : α → String → String) (values : Array α) (out : String) : String := Id.run do
  let mut out := out ++ "["
  let mut first := true
  for value in values do
    if !first then out := out ++ ","
    out := write value out
    first := false
  return out ++ "]"

/-- The linked-list counterpart of the generated array traversal. -/
def list (write : α → String → String) (values : List α) (out : String) : String := Id.run do
  let mut out := out ++ "["
  let mut first := true
  for value in values do
    if !first then out := out ++ ","
    out := write value out
    first := false
  return out ++ "]"

/-- Traverse byte storage directly, avoiding an intermediate boxed Array UInt8. -/
def bytes (values : ByteArray) (out : String) : String := Id.run do
  let mut out := out ++ "["
  for index in [:values.size] do
    if index != 0 then out := out ++ ","
    out := unsigned values[index]!.toNat out
  return out ++ "]"

end Vir.JsonSafeWriter
