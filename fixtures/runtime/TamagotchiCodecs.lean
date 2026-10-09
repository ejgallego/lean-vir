/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import Lean.Data.Json
public import Vir.Js
public import Vir.Examples.Tamagotchi

public section

open Lean Lean.Vir

namespace TamagotchiCodecs

-- Application-supplied codecs, without changing the domain or standard instances.
private def encodeNat (value : Nat) : Json := .str (toString value)

private def decodeNat (json : Json) : Except String Nat := do
  let text ← json.getStr?
  let some value := text.toNat? | throw "expected a decimal Nat string"
  if toString value != text then throw "expected a canonical decimal Nat string"
  return value

private def encodeMood (mood : Tamagotchi.Mood) : Json := .str mood.label

private def decodeMood (json : Json) : Except String Tamagotchi.Mood := do
  let text ← json.getStr?
  let some mood := Tamagotchi.Mood.fromString? text | throw s!"unknown mood {text}"
  return mood

private def encodeState (state : Tamagotchi.PetState) : Json :=
  Json.mkObj [
    ("name", .str state.name),
    ("mood", encodeMood state.mood),
    ("trace", .arr (state.trace.toArray.map encodeMood)),
    ("artwork", .str state.artwork),
    ("turns", encodeNat state.turns),
    ("care", encodeNat state.care)]

private def decodeState (json : Json) : Except String Tamagotchi.PetState := do
  let trace ← (← (← json.getObjVal? "trace").getArr?).toList.mapM decodeMood
  return {
    name := ← json.getObjValAs? String "name"
    mood := ← decodeMood (← json.getObjVal? "mood")
    trace := trace
    artwork := ← json.getObjValAs? String "artwork"
    turns := ← decodeNat (← json.getObjVal? "turns")
    care := ← decodeNat (← json.getObjVal? "care")
  }

private def orThrow (result : Except String α) : IO α :=
  match result with
  | .ok value => pure value
  | .error message => throw (IO.userError message)

private def decodeAction (text : String) : Except String Tamagotchi.Action :=
  match ReactTamagotchi.actions.find? (fun action => action.label == text) with
  | some action => .ok action
  | none => .error s!"unknown action {text}"

@[vir_export]
def fromJsonText (text : String) : IO (JSL Tamagotchi.PetState) := do
  let state ← orThrow (Json.parse text >>= decodeState)
  RuntimeM.run (LeanRef.toJSL state)

@[vir_export]
def toJsonText (value : JSL Tamagotchi.PetState) : IO String := RuntimeM.run do
  return (encodeState (← LeanRef.fromJSL value)).compress

@[vir_export]
def create (name artwork : String) : RuntimeM (JSL Tamagotchi.PetState) :=
  LeanRef.toJSL (Tamagotchi.initialState name artwork)

@[vir_export]
def act (value : JSL Tamagotchi.PetState) (text : String) : IO (JSL Tamagotchi.PetState) := do
  let action ← orThrow (decodeAction text)
  RuntimeM.run do
    let state ← LeanRef.fromJSL value
    LeanRef.toJSL (Tamagotchi.nextState state action)

-- Independent observations do not use the encoder or a parallel wire model.
@[vir_export]
def name (value : JSL Tamagotchi.PetState) : RuntimeM String := do
  return (← LeanRef.fromJSL value).name

@[vir_export]
def mood (value : JSL Tamagotchi.PetState) : RuntimeM String := do
  return (← LeanRef.fromJSL value).mood.label

@[vir_export]
def artwork (value : JSL Tamagotchi.PetState) : RuntimeM String := do
  return (← LeanRef.fromJSL value).artwork

@[vir_export]
def turns (value : JSL Tamagotchi.PetState) : RuntimeM Nat := do
  return (← LeanRef.fromJSL value).turns

@[vir_export]
def care (value : JSL Tamagotchi.PetState) : RuntimeM Nat := do
  return (← LeanRef.fromJSL value).care

@[vir_export]
def traceLength (value : JSL Tamagotchi.PetState) : RuntimeM Nat := do
  return (← LeanRef.fromJSL value).trace.length

@[vir_export]
def traceAt (value : JSL Tamagotchi.PetState) (index : Nat) : RuntimeM String := do
  let state ← LeanRef.fromJSL value
  return (state.trace[index]?).map Tamagotchi.Mood.label |>.getD "out of range"

end TamagotchiCodecs
