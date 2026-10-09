/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import Vir.Js.Json

public section

open Lean Lean.Vir

namespace JsonCodecs

structure Model where
  amount : Nat
  nested : Option (Option Nat)
  marker : Option Unit
  label : String

-- Application-supplied lossless representation, separate from standard JSON instances.
private def encodeNat (value : Nat) : Json := .str (toString value)

private def decodeNat (json : Json) : Except String Nat := do
  let text ← json.getStr?
  let some value := text.toNat? | throw "expected a decimal Nat string"
  if toString value != text then throw "expected a canonical decimal Nat string"
  return value

private def encodeOption (encode : α → Json) : Option α → Json
  | none => Json.mkObj [("kind", .str "none")]
  | some value => Json.mkObj [("kind", .str "some"), ("value", encode value)]

private def decodeOption (decode : Json → Except String α) (json : Json) : Except String (Option α) := do
  match ← json.getObjValAs? String "kind" with
  | "none" => return none
  | "some" => return some (← decode (← json.getObjVal? "value"))
  | kind => throw s!"unknown Option constructor {kind}"

private def encodeUnit (_ : Unit) : Json := .null

private def decodeUnit : Json → Except String Unit
  | .null => .ok ()
  | _ => .error "expected null for Unit"

private def encodeModel (model : Model) : Json :=
  Json.mkObj [
    ("amount", encodeNat model.amount),
    ("nested", encodeOption (encodeOption encodeNat) model.nested),
    ("marker", encodeOption encodeUnit model.marker),
    ("label", .str model.label)]

private def decodeModel (json : Json) : Except String Model := do
  return {
    amount := ← decodeNat (← json.getObjVal? "amount")
    nested := ← decodeOption (decodeOption decodeNat) (← json.getObjVal? "nested")
    marker := ← decodeOption decodeUnit (← json.getObjVal? "marker")
    label := ← json.getObjValAs? String "label"
  }

private def orThrow (result : Except String α) : IO α :=
  match result with
  | .ok value => pure value
  | .error message => throw (IO.userError message)

@[vir_export]
def fromJsonText (text : String) : IO (JSL Model) :=
  LeanRef.fromJsonText decodeModel text

@[vir_export]
def toJsonText (value : JSL Model) : IO String :=
  LeanRef.toJsonText encodeModel value

@[vir_export]
def advance (value : JSL Model) (delta : Nat) : RuntimeM (JSL Model) := do
  let model ← LeanRef.fromJSL value
  LeanRef.toJSL { model with amount := model.amount + delta }

-- Independent observations inspect Lean values, without going through the encoder.
@[vir_export]
def amount (value : JSL Model) : RuntimeM Nat := do
  return (← LeanRef.fromJSL value).amount

@[vir_export]
def nestedKind (value : JSL Model) : RuntimeM Nat := do
  match (← LeanRef.fromJSL value).nested with
  | none => return 0
  | some none => return 1
  | some (some _) => return 2

@[vir_export]
def nestedAmount (value : JSL Model) : RuntimeM Nat := do
  match (← LeanRef.fromJSL value).nested with
  | some (some n) => return n
  | _ => return 0

@[vir_export]
def markerPresent (value : JSL Model) : RuntimeM Bool := do
  return (← LeanRef.fromJSL value).marker.isSome

@[vir_export]
def label (value : JSL Model) : RuntimeM String := do
  return (← LeanRef.fromJSL value).label

private def huge : Nat := 900719925474099312345678901234567890

-- Direct compiled values exercise encoding independently of decoding.
@[vir_export]
def sample (index : Nat) : RuntimeM (JSL Model) :=
  LeanRef.toJSL <| match index with
  | 0 => { amount := 0, nested := none, marker := none, label := "plain" }
  | 1 => { amount := huge, nested := some none, marker := some (), label := "α雪" }
  | _ => { amount := huge + 2, nested := some (some (huge + 1)), marker := none, label := "nested" }

-- Controls use Lean's existing JSON instances, rather than the candidate codecs.
@[vir_export]
def standardNestedNone : String := (toJson (none : Option (Option Nat))).compress

@[vir_export]
def standardNestedSomeNone : String := (toJson (some none : Option (Option Nat))).compress

@[vir_export]
def standardUnitNone : String := (toJson (none : Option Unit)).compress

@[vir_export]
def standardUnitSome : String := (toJson (some () : Option Unit)).compress

@[vir_export]
def standardLargeNat : String := (toJson huge).compress

@[vir_export]
def standardDecodeNat (text : String) : IO Nat :=
  orThrow (Json.parse text >>= fromJson? (α := Nat))

@[vir_export]
def standardFromJsonText (text : String) : IO (JSL Nat) :=
  LeanRef.fromJsonText (fromJson? (α := Nat)) text

@[vir_export]
def standardToJsonText (value : JSL Nat) : IO String :=
  LeanRef.toJsonText toJson value

@[vir_export]
def standardValue (value : JSL Nat) : RuntimeM Nat :=
  LeanRef.fromJSL value

end JsonCodecs
