/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.Browser

namespace Tamagotchi

inductive Mood where
  | happy
  | hungry
  | sleepy
  | angry
  | asleep
  | dead
deriving Repr, DecidableEq

inductive Action where
  | feed
  | play
  | nap
  | wake
  | ignore
deriving Repr, DecidableEq

open Mood Action

def Mood.label : Mood → String
  | happy => "happy"
  | hungry => "hungry"
  | sleepy => "sleepy"
  | angry => "angry"
  | asleep => "asleep"
  | dead => "dead"

def Mood.fromString? : String → Option Mood
  | "happy" => some happy
  | "hungry" => some hungry
  | "sleepy" => some sleepy
  | "angry" => some angry
  | "asleep" => some asleep
  | "dead" => some dead
  | _ => none

def Action.label : Action → String
  | feed => "feed"
  | play => "play"
  | nap => "nap"
  | wake => "wake"
  | ignore => "ignore"

@[inline] def step : Mood -> Action -> Mood
  | dead,   _      => dead
  | happy,  feed   => happy
  | happy,  play   => sleepy
  | happy,  nap    => asleep
  | happy,  wake   => happy
  | happy,  ignore => hungry
  | hungry, feed   => happy
  | hungry, play   => angry
  | hungry, nap    => asleep
  | hungry, wake   => hungry
  | hungry, ignore => angry
  | sleepy, feed   => happy
  | sleepy, play   => angry
  | sleepy, nap    => asleep
  | sleepy, wake   => hungry
  | sleepy, ignore => asleep
  | angry,  feed   => hungry
  | angry,  play   => angry
  | angry,  nap    => asleep
  | angry,  wake   => angry
  | angry,  ignore => dead
  | asleep, feed   => asleep
  | asleep, play   => angry
  | asleep, nap    => asleep
  | asleep, wake   => happy
  | asleep, ignore => hungry

def run : Mood -> List Action -> Mood
  | s, []      => s
  | s, a :: as => run (step s a) as

def trace : Mood -> List Action -> List Mood
  | s, []      => [s]
  | s, a :: as => s :: trace (step s a) as

def demoScript : List Action :=
  [ignore, feed, play, nap, wake, ignore, ignore]

structure PetState where
  mood : Mood
  trace : List Mood
  artwork : String

def initialState (artwork : String) : PetState :=
  { mood := happy, trace := [happy], artwork := artwork }

def snoc : List α → α → List α
  | [], value => [value]
  | head :: tail, value => head :: snoc tail value

def traceLabel : List Mood → String
  | [] => ""
  | [mood] => mood.label
  | mood :: rest => mood.label ++ " -> " ++ traceLabel rest

def traceAttr (trace : List Mood) : String :=
  ",".intercalate (trace.map Mood.label)

def traceFromAttr (attr : String) : List Mood :=
  attr.splitOn "," |>.filterMap Mood.fromString?

def artworkFromChecked (checked : Bool) : String :=
  if checked then "octopus" else "pet"

def artLabel (artwork : String) : String :=
  if artwork == "octopus" then "Octopus" else "Virtual pet"

def withElement (selector : String) (f : Lean.Vir.Browser.Element → IO Unit) : IO Unit := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ()
  | some element => f element

def setText (selector text : String) : IO Unit :=
  withElement selector fun element =>
    Lean.Vir.Browser.Element.setTextContent element text

def getAttribute (selector name : String) : IO (Option String) := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure none
  | some element => Lean.Vir.Browser.Element.getAttribute element name

def setAttribute (selector name value : String) : IO Unit :=
  withElement selector fun element =>
    Lean.Vir.Browser.Element.setAttribute element name value

def getChecked (selector : String) : IO Bool := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure false
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure false
      | some input => Lean.Vir.Browser.HTMLInputElement.getChecked input

def setChecked (selector : String) (checked : Bool) : IO Unit := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ()
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ()
      | some input => Lean.Vir.Browser.HTMLInputElement.setChecked input checked

def render (state : PetState) (actionLabel : String) : IO Unit := do
  let moodLabel := state.mood.label
  setText "#pet-mood-display" moodLabel
  setText "#pet-action-display" actionLabel
  setText "#pet-trace-display" (traceLabel state.trace)
  setAttribute "#pet-device" "data-mood" moodLabel
  setAttribute "#pet-device" "data-art" state.artwork
  setAttribute "#pet-device" "data-trace" (traceAttr state.trace)
  setAttribute "#pet-device" "aria-label" s!"{artLabel state.artwork} mood {moodLabel}"
  setChecked "#pet-art-toggle" (state.artwork == "octopus")
  setText "#status" "Ready"
  setAttribute "#status" "data-ready" "true"

def stateFromDom : IO PetState := do
  let currentAttr ← getAttribute "#pet-device" "data-mood"
  let traceAttrValue ← getAttribute "#pet-device" "data-trace"
  let checked ← getChecked "#pet-art-toggle"
  let current := currentAttr.bind Mood.fromString? |>.getD happy
  let trace := traceAttrValue.map traceFromAttr |>.getD [current]
  pure {
    mood := current,
    trace := if trace.isEmpty then [current] else trace,
    artwork := artworkFromChecked checked
  }

def uiReset (artwork : String) : IO PetState := do
  let state := initialState artwork
  render state "..."
  pure state

def uiResetFromDom : IO PetState := do
  let checked ← getChecked "#pet-art-toggle"
  uiReset (artworkFromChecked checked)

@[inline] def nextState (current : Mood) (trace : List Mood) (artwork : String) (action : Action) : PetState :=
  let mood := step current action
  { mood := mood, trace := snoc trace mood, artwork := artwork }

def uiStep (current : Mood) (trace : List Mood) (artwork : String) (action : Action) : IO PetState := do
  let next := nextState current trace artwork action
  render next action.label
  pure next

def uiStepFromDom (action : Action) : IO PetState := do
  let current ← stateFromDom
  let next := nextState current.mood current.trace current.artwork action
  render next action.label
  pure next

#eval trace happy demoScript
#eval run happy demoScript

end Tamagotchi
