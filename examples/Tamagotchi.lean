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

def artLabel (artwork : String) : String :=
  if artwork == "octopus" then "Octopus" else "Virtual pet"

def render (state : PetState) (actionLabel : String) : IO Unit := do
  let moodLabel := state.mood.label
  Lean.Vir.Browser.Document.setTextContent "#pet-mood-display" moodLabel
  Lean.Vir.Browser.Document.setTextContent "#pet-action-display" actionLabel
  Lean.Vir.Browser.Document.setTextContent "#pet-trace-display" (traceLabel state.trace)
  Lean.Vir.Browser.Document.setAttribute "#pet-device" "data-mood" moodLabel
  Lean.Vir.Browser.Document.setAttribute "#pet-device" "data-art" state.artwork
  Lean.Vir.Browser.Document.setAttribute "#pet-device" "aria-label" s!"{artLabel state.artwork} mood {moodLabel}"
  Lean.Vir.Browser.Document.setTextContent "#status" "Ready"
  Lean.Vir.Browser.Document.setAttribute "#status" "data-ready" "true"

def uiReset (artwork : String) : IO PetState := do
  let state := initialState artwork
  render state "..."
  pure state

@[inline] def nextState (current : Mood) (trace : List Mood) (artwork : String) (action : Action) : PetState :=
  let mood := step current action
  { mood := mood, trace := snoc trace mood, artwork := artwork }

def uiStep (current : Mood) (trace : List Mood) (artwork : String) (action : Action) : IO PetState := do
  let next := nextState current trace artwork action
  render next action.label
  pure next

#eval trace happy demoScript
#eval run happy demoScript

end Tamagotchi
