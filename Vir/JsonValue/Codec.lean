/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Data.Json

public section

namespace Lean.Vir.JsonValue

/-- The initial number domain is mathematical integers exactly representable by JS. -/
def integer? (number : JsonNumber) : Except String Int := do
  let magnitude := number.mantissa.natAbs
  if magnitude == 0 then return 0
  let digits := magnitude.repr.toList.toArray
  if number.exponent >= digits.size then throw "fractional JSON number is unsupported"
  let length := digits.size - number.exponent
  if length > 16 then throw "JSON integer exceeds the safe range ±9007199254740991"
  let mut value := 0
  for i in [:digits.size] do
    let digit := digits[i]!
    if i < length then
      value := value * 10 + (digit.toNat - '0'.toNat)
    else if digit != '0' then
      throw "fractional JSON number is unsupported"
  if value > 9007199254740991 then
    throw "JSON integer exceeds the safe range ±9007199254740991"
  return if number.mantissa < 0 then -(Int.ofNat value) else Int.ofNat value

private def fieldPath (path key : String) : String :=
  path ++ "[" ++ (Json.str key).compress ++ "]"

/-- Bounds apply to the expanded JSON tree, including repeated input aliases. -/
def maxNodes : Nat := 1000000

/-- Bounds recursive conversion in both the native and interpreted paths. -/
def maxDepth : Nat := 256

private partial def validateBudget (value : Json) (path : String)
    (remaining depth : Nat) : Except String Nat := do
  if depth > maxDepth then throw s!"{path}: JSON nesting exceeds {maxDepth}"
  if remaining == 0 then throw s!"{path}: JSON tree exceeds {maxNodes} nodes"
  let mut remaining := remaining - 1
  match value with
  | .num number =>
    match integer? number with
    | .ok _ => pure ()
    | .error error => throw s!"{path}: {error}"
  | .arr values =>
    for i in [:values.size] do
      remaining ← validateBudget values[i]! s!"{path}[{i}]" remaining (depth + 1)
  | .obj fields =>
    for (key, value) in fields.toList do
      remaining ← validateBudget value (fieldPath path key) remaining (depth + 1)
  | _ => pure ()
  return remaining

/-- Validate before native JSON-RPC serialization can round a numeric payload. -/
def validate (value : Json) (path : String := "$") : Except String Unit := do
  let _ ← validateBudget value path maxNodes 0
  pure ()

/-- Explicitly selected ToJson representation, checked before it crosses the wire. -/
def encode [ToJson α] (value : α) : Except String Json := do
  let json := toJson value
  validate json
  return json

/-- Domain validation followed by the author's existing checked FromJson instance. -/
def decode [FromJson α] (value : Json) : Except String α := do
  validate value
  match fromJson? value with
  | .ok value => return value
  | .error error => throw s!"$: {error}"

end Lean.Vir.JsonValue
