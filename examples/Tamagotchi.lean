/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser
import Vir.React

namespace Tamagotchi

open Lean.Vir.Browser (DomM)

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
  name : String
  mood : Mood
  trace : List Mood
  artwork : String
  turns : Nat
  care : Nat

def defaultName : String :=
  "Mochi"

def defaultOctopusName : String :=
  "Octi"

def maxCare : Nat :=
  5

def initialCare : Nat :=
  3

def normalizeArtwork (artwork : String) : String :=
  if artwork == "octopus" then "octopus" else "pet"

def defaultNameForArtwork (artwork : String) : String :=
  if normalizeArtwork artwork == "octopus" then defaultOctopusName else defaultName

def normalizeNameForArtwork (artwork name : String) : String :=
  if name == "" then defaultNameForArtwork artwork else name

def nameForArtworkChange (previousArtwork artwork name : String) : String :=
  let previousDefault := defaultNameForArtwork previousArtwork
  if name == "" || name == previousDefault then
    defaultNameForArtwork artwork
  else
    name

def clampCare (care : Nat) : Nat :=
  if care > maxCare then maxCare else care

def initialState (name artwork : String) : PetState :=
  let artwork := normalizeArtwork artwork
  {
    name := normalizeNameForArtwork artwork name,
    mood := happy,
    trace := [happy],
    artwork := artwork,
    turns := 0,
    care := initialCare
  }

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

def careAfter (current : Nat) (mood : Mood) (action : Action) : Nat :=
  let acted :=
    match action with
    | feed => current + 1
    | play => current + 1
    | nap => current
    | wake => current
    | ignore => current - 1
  let adjusted :=
    match mood with
    | happy => acted + 1
    | angry => acted - 1
    | dead => 0
    | _ => acted
  clampCare adjusted

def statusLabel (state : PetState) (actionLabel : String) : String :=
  s!"{state.name} is {state.mood.label}; last {actionLabel}; " ++
    s!"care {state.care}/{maxCare}; turn {state.turns}"

def natFromAttr (attr : Option String) (fallback : Nat) : Nat :=
  attr.bind String.toNat? |>.getD fallback

def withElement
    (selector : String) (f : Lean.Vir.Js Lean.Vir.Browser.Element → DomM Unit) : DomM Unit := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ()
  | some element => f element

def setText (selector text : String) : DomM Unit :=
  withElement selector fun element =>
    Lean.Vir.Browser.Element.setTextContent element text

def getAttribute (selector name : String) : DomM (Option String) := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure none
  | some element => Lean.Vir.Browser.Element.getAttribute element name

def setAttribute (selector name value : String) : DomM Unit :=
  withElement selector fun element =>
    Lean.Vir.Browser.Element.setAttribute element name value

def getChecked (selector : String) : DomM Bool := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure false
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure false
      | some input => Lean.Vir.Browser.HTMLInputElement.getChecked input

def setChecked (selector : String) (checked : Bool) : DomM Unit := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ()
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ()
      | some input => Lean.Vir.Browser.HTMLInputElement.setChecked input checked

def getValue (selector : String) : DomM String := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ""
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ""
      | some input => Lean.Vir.Browser.HTMLInputElement.getValue input

def setValue (selector value : String) : DomM Unit := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ()
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ()
      | some input => Lean.Vir.Browser.HTMLInputElement.setValue input value

def render (state : PetState) (actionLabel : String) : DomM Unit := do
  let artwork := normalizeArtwork state.artwork
  let state := {
    state with
    name := normalizeNameForArtwork artwork state.name,
    artwork := artwork,
    care := clampCare state.care
  }
  let moodLabel := state.mood.label
  setValue "#pet-name-input" state.name
  setText "#pet-name-display" state.name
  setText "#pet-mood-display" moodLabel
  setText "#pet-action-display" actionLabel
  setText "#pet-trace-display" (traceLabel state.trace)
  setText "#pet-care-display" s!"{state.care}/{maxCare}"
  setText "#pet-turn-display" (toString state.turns)
  setText "#pet-summary-display" (statusLabel state actionLabel)
  setAttribute "#pet-device" "data-mood" moodLabel
  setAttribute "#pet-device" "data-art" state.artwork
  setAttribute "#pet-device" "data-trace" (traceAttr state.trace)
  setAttribute "#pet-device" "data-name" state.name
  setAttribute "#pet-device" "data-turns" (toString state.turns)
  setAttribute "#pet-device" "data-care" (toString state.care)
  setAttribute "#pet-device" "aria-label" s!"{artLabel state.artwork} {state.name} mood {moodLabel}"
  setChecked "#pet-art-toggle" (state.artwork == "octopus")
  setText "#status" "Ready"
  setAttribute "#status" "data-ready" "true"

def stateFromDom : DomM PetState := do
  let currentAttr ← getAttribute "#pet-device" "data-mood"
  let traceAttrValue ← getAttribute "#pet-device" "data-trace"
  let turnsAttr ← getAttribute "#pet-device" "data-turns"
  let careAttr ← getAttribute "#pet-device" "data-care"
  let name ← getValue "#pet-name-input"
  let checked ← getChecked "#pet-art-toggle"
  let artwork := artworkFromChecked checked
  let current := currentAttr.bind Mood.fromString? |>.getD happy
  let trace := traceAttrValue.map traceFromAttr |>.getD [current]
  let trace := if trace.isEmpty then [current] else trace
  pure {
    name := normalizeNameForArtwork artwork name,
    mood := current,
    trace := trace,
    artwork := artwork,
    turns := natFromAttr turnsAttr (trace.length - 1),
    care := clampCare (natFromAttr careAttr initialCare)
  }

def uiReset (name artwork : String) : DomM PetState := do
  let state := initialState name artwork
  render state "..."
  pure state

def uiResetFromDom : DomM PetState := do
  let name ← getValue "#pet-name-input"
  let checked ← getChecked "#pet-art-toggle"
  let artwork := artworkFromChecked checked
  let previousArtwork ← getAttribute "#pet-device" "data-art"
  uiReset (nameForArtworkChange (previousArtwork.getD artwork) artwork name) artwork

@[inline] def nextState (state : PetState) (action : Action) : PetState :=
  let artwork := normalizeArtwork state.artwork
  let mood := step state.mood action
  {
    state with
    name := normalizeNameForArtwork artwork state.name,
    mood := mood,
    trace := snoc state.trace mood,
    artwork := artwork,
    turns := state.turns + 1,
    care := careAfter state.care mood action
  }

def uiStep (state : PetState) (action : Action) : DomM PetState := do
  let next := nextState state action
  render next action.label
  pure next

def uiStepFromDom (action : Action) : DomM PetState := do
  let current ← stateFromDom
  let next := nextState current action
  render next action.label
  pure next

def uiRenameFromDom : DomM PetState := do
  let current ← stateFromDom
  render current "rename"
  pure current

def mountCallback
    (selector event : String)
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → DomM Unit) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some element =>
      let _listener ← Lean.Vir.Browser.Element.addEventListener element event callback
      pure 1

def mountAction (action : Action) : DomM Nat :=
  mountCallback ("[data-action='" ++ action.label ++ "']") "click" fun _event =>
    discard <| uiStepFromDom action

def uiMountFromDom : DomM Nat := do
  let _ ← uiResetFromDom
  let mut mounted := 0
  for action in #[feed, play, nap, wake, ignore] do
    let count ← mountAction action
    mounted := mounted + count
  let resetCount ← mountCallback "#pet-reset-button" "click" fun _event =>
    discard uiResetFromDom
  mounted := mounted + resetCount
  let artCount ← mountCallback "#pet-art-toggle" "change" fun _event =>
    discard uiResetFromDom
  mounted := mounted + artCount
  let renameCount ← mountCallback "#pet-name-input" "change" fun _event =>
    discard uiRenameFromDom
  mounted := mounted + renameCount
  pure mounted

#eval trace happy demoScript
#eval run happy demoScript

end Tamagotchi

namespace ReactTamagotchi

open Lean.Vir.Browser (DomM)
open Lean.Vir.React

def actions : Array Tamagotchi.Action :=
  #[.feed, .play, .nap, .wake, .ignore]

def displayName (state : Tamagotchi.PetState) : String :=
  Tamagotchi.normalizeNameForArtwork state.artwork state.name

def summaryLabel (state : Tamagotchi.PetState) (actionLabel : String) : String :=
  s!"{displayName state} is {state.mood.label}; last {actionLabel}; " ++
    s!"care {state.care}/{Tamagotchi.maxCare}; turn {state.turns}"

def emptySpan (classes : Array String) : ReactM (Lean.Vir.Js Html) :=
  Html.spanWith
    #[Property.classList classes, Property.ariaHidden true]
    #[]
    #[]

def pixelPet : ReactM (Lean.Vir.Js Html) := do
  let earLeft ← emptySpan #["pet-ear", "pet-ear-left"]
  let earRight ← emptySpan #["pet-ear", "pet-ear-right"]
  let body ← emptySpan #["pet-body"]
  let tentacle1 ← emptySpan #["pet-tentacle", "pet-tentacle-1"]
  let tentacle2 ← emptySpan #["pet-tentacle", "pet-tentacle-2"]
  let tentacle3 ← emptySpan #["pet-tentacle", "pet-tentacle-3"]
  let tentacle4 ← emptySpan #["pet-tentacle", "pet-tentacle-4"]
  let tentacle5 ← emptySpan #["pet-tentacle", "pet-tentacle-5"]
  let eyeLeft ← emptySpan #["pet-eye", "pet-eye-left"]
  let eyeRight ← emptySpan #["pet-eye", "pet-eye-right"]
  let mouth ← emptySpan #["pet-mouth"]
  let signal ← emptySpan #["pet-signal"]
  Html.divWith
    #[Property.classList #["pet-pixel-pet"], Property.ariaHidden true]
    #[]
    #[earLeft, earRight, body, tentacle1, tentacle2, tentacle3, tentacle4,
      tentacle5, eyeLeft, eyeRight, mouth, signal]

def device (state : Tamagotchi.PetState) : ReactM (Lean.Vir.Js Html) := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let moodLabel := state.mood.label
  let pet ← pixelPet
  let screen ← Html.divWith #[Property.classList #["pet-screen"]] #[] #[pet]
  let leftButton ← emptySpan #["pet-device-button", "pet-device-button-left"]
  let centerButton ← emptySpan #["pet-device-button", "pet-device-button-center"]
  let rightButton ← emptySpan #["pet-device-button", "pet-device-button-right"]
  Html.divWith
    #[
      Property.id "react-pet-device",
      Property.classList #["pet-device"],
      Property.role "img",
      Property.ariaLabel s!"{Tamagotchi.artLabel artwork} {displayName state} mood {moodLabel}",
      Property.data "art" artwork,
      Property.data "mood" moodLabel
    ]
    #[]
    #[screen, leftButton, centerButton, rightButton]

def stat (key label value : String) : ReactM (Lean.Vir.Js Html) := do
  let labelText ← Html.text label
  let labelNode ← Html.spanWith #[] #[] #[labelText]
  let valueText ← Html.text value
  let valueNode ← Html.spanWith #[] #[] #[valueText]
  Html.keyedDivWith key
    #[Property.classList #["react-pet-stat"]]
    #[]
    #[labelNode, valueNode]

partial def traceNodesAux (index : Nat) : List Tamagotchi.Mood → ReactM (Array (Lean.Vir.Js Html))
  | [] => pure #[]
  | mood :: rest => do
      let text ← Html.text mood.label
      let node ←
        Html.keyedSpanWith
          (toString index)
          #[
            Property.classList #["react-pet-trace-token", "react-pet-trace-" ++ mood.label],
            Property.role "listitem"
          ]
          #[]
          #[text]
      let restNodes ← traceNodesAux (index + 1) rest
      pure (#[node] ++ restNodes)

def traceNodes (trace : List Tamagotchi.Mood) : ReactM (Array (Lean.Vir.Js Html)) :=
  traceNodesAux 0 trace

def traceAriaLabel (trace : List Tamagotchi.Mood) : String :=
  "Mood trace: " ++ Tamagotchi.traceLabel trace

def normalizeViewState (state : Tamagotchi.PetState) : Tamagotchi.PetState :=
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  { state with artwork := artwork, care := Tamagotchi.clampCare state.care }

partial def renderInto
    (root : Lean.Vir.Js Root) (state : Tamagotchi.PetState) (actionLabel : String) : DomM Unit := do
  let state := normalizeViewState state
  let shownName := displayName state
  Root.render root do
    let actionButton := fun action => do
      let text ← Html.text action.label
      Html.keyedButtonWith
        action.label
        #[
          Property.id ("react-pet-action-" ++ action.label),
          Property.disabled (state.mood == .dead),
          Property.ariaLabel ("Tamagotchi action " ++ action.label)
        ]
        #[EventHandler.onClick (renderInto root (Tamagotchi.nextState state action) action.label)]
        #[text]
    let nameText ← Html.text "Name"
    let nameLabel ← Html.labelWith #[Property.htmlFor "react-pet-name-input"] #[] #[nameText]
    let nameInput ←
      Html.input
        #[
          Property.id "react-pet-name-input",
          Property.inputName "react-pet-name",
          Property.type "text",
          Property.inputValue state.name,
          Property.placeholder shownName,
          Property.maxLength 18,
          Property.autoComplete "off"
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.inputValue? event with
          | none => pure ()
          | some name => renderInto root { state with name := name } "rename"]
    let nameForm ←
      Html.formWith
        #[Property.id "react-pet-name-form"]
        #[EventHandler.onSubmitWith fun event => do
          Lean.Vir.Browser.Event.preventDefault event
          Lean.Vir.Browser.Event.stopPropagation event
          renderInto root { state with name := shownName } "rename"]
        #[nameLabel, nameInput]
    let artInput ←
      Html.input
        #[
          Property.id "react-pet-art-toggle",
          Property.type "checkbox",
          Property.checked (state.artwork == "octopus")
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.inputChecked? event with
          | none => pure ()
          | some checked =>
              let artwork := Tamagotchi.artworkFromChecked checked
              let name := Tamagotchi.nameForArtworkChange state.artwork artwork state.name
              renderInto root { state with artwork := artwork, name := name } "artwork"]
    let artText ← Html.text "Octopus"
    let artSpan ← Html.spanWith #[] #[] #[artText]
    let artLabel ←
      Html.labelWith
        #[Property.htmlFor "react-pet-art-toggle", Property.classList #["react-pet-toggle"]]
        #[]
        #[artInput, artSpan]
    let heading ←
      Html.divWith
        #[Property.classList #["react-pet-heading"]]
        #[]
        #[nameForm, artLabel]
    let deviceNode ← device state
    let moodLabelText ← Html.text "Mood"
    let moodLabelNode ← Html.spanWith #[] #[] #[moodLabelText]
    let moodText ← Html.text state.mood.label
    let moodValueNode ← Html.spanWith #[Property.id "react-pet-mood"] #[] #[moodText]
    let moodReadout ←
      Html.divWith
        #[Property.classList #["pet-mood-readout"]]
        #[]
        #[moodLabelNode, moodValueNode]
    let petState ←
      Html.divWith
        #[Property.classList #["pet-state"]]
        #[]
        #[deviceNode, moodReadout]
    let nameStat ← stat "name" "name" shownName
    let careStat ← stat "care" "care" s!"{state.care}/{Tamagotchi.maxCare}"
    let turnStat ← stat "turn" "turn" (toString state.turns)
    let lastStat ← stat "last" "last" actionLabel
    let stats ←
      Html.divWith
        #[Property.classList #["react-pet-stats"]]
        #[]
        #[nameStat, careStat, turnStat, lastStat]
    let actionButtons ← actions.mapM actionButton
    let actionsNode ←
      Html.divWith
        #[Property.classList #["action-grid", "react-pet-actions"]]
        #[]
        actionButtons
    let traceNodeList ← traceNodes state.trace
    let trace ←
      Html.divWith
        #[
          Property.classList #["react-pet-trace"],
          Property.id "react-pet-trace",
          Property.role "list",
          Property.ariaLabel (traceAriaLabel state.trace)
        ]
        #[]
        traceNodeList
    let summaryText ← Html.text (summaryLabel state actionLabel)
    let summary ←
      Html.divWith
        #[Property.classList #["react-pet-summary"], Property.id "react-pet-summary"]
        #[]
        #[summaryText]
    let resetText ← Html.text "Reset"
    let reset ←
      Html.buttonWith
        #[Property.id "react-pet-reset"]
        #[EventHandler.onClick (renderInto root (Tamagotchi.initialState state.name state.artwork) "...")]
        #[resetText]
    let body ←
      Html.divWith
        #[Property.classList #["react-pet-body"]]
        #[]
        #[petState, stats, actionsNode, trace, summary, reset]
    Html.divWith
      #[
        Property.id "react-pet-widget",
        Property.classList #["react-pet-widget"],
        Property.data "mood" state.mood.label
      ]
      #[]
      #[heading, body]

def mount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root =>
    renderInto root (Tamagotchi.initialState Tamagotchi.defaultOctopusName "octopus") "..."

def mountDefault : DomM Bool :=
  mount "#react-pet-root"

end ReactTamagotchi
