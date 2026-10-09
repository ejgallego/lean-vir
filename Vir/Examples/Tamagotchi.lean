/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser
public import Vir.Examples.Style
public import Vir.ProofWidgets.Jsx

public section

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
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure ()
  | some element => f element

def setText (selector text : String) : DomM Unit := do
  withElement selector fun element => do
    let jsText ← Lean.Vir.JsValue.ofString text
    Lean.Vir.Browser.Element.setTextContent element (← Lean.Vir.Js.Nullable.ofJs jsText)

def getAttribute (selector name : String) : DomM (Option String) := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure none
  | some element => do
      let value ← Lean.Vir.Browser.Element.getAttribute element (← Lean.Vir.JsValue.ofString name)
      (← Lean.Vir.Js.Nullable.toOption value).mapM fun value => do
        Lean.Vir.JsValue.toString value

def setAttribute (selector name value : String) : DomM Unit :=
  withElement selector fun element => do
    Lean.Vir.Browser.Element.setAttribute element
      (← Lean.Vir.JsValue.ofString name) (← Lean.Vir.JsValue.ofString value)

def getChecked (selector : String) : DomM Bool := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure false
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure false
      | some input => Lean.Vir.JsValue.toBool (← Lean.Vir.Browser.HTMLInputElement.getChecked input)

def setChecked (selector : String) (checked : Bool) : DomM Unit := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure ()
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ()
      | some input => do
          Lean.Vir.Browser.HTMLInputElement.setChecked input
            (← Lean.Vir.JsValue.ofBool checked)

def getValue (selector : String) : DomM String := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure ""
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ""
      | some input => Lean.Vir.JsValue.toString (← Lean.Vir.Browser.HTMLInputElement.getValue input)

def setValue (selector value : String) : DomM Unit := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure ()
  | some element =>
      match ← Lean.Vir.Browser.HTMLInputElement.fromElement element with
      | none => pure ()
      | some input => do
          Lean.Vir.Browser.HTMLInputElement.setValue input
            (← Lean.Vir.JsValue.ofString value)

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
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure 0
  | some element =>
      Lean.Vir.Browser.Element.addEventListener element
        (← Lean.Vir.JsValue.ofString event) (← Lean.Vir.Browser.EventListener.ofLean callback)
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

end Tamagotchi

namespace ReactTamagotchi

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React
open scoped Lean.Vir.Js

def actions : Array Tamagotchi.Action :=
  #[.feed, .play, .nap, .wake, .ignore]

def displayName (state : Tamagotchi.PetState) : String :=
  Tamagotchi.normalizeNameForArtwork state.artwork state.name

def liveTickSeconds : Nat :=
  50

def liveTickMs : UInt32 :=
  1000

def widgetStyle : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gap" := (← js#"8px"), "minWidth" := (← js#"0"),
  "maxWidth" := (← js#"360px"), "padding" := (← js#"10px"),
  "border" := (← js#"1px solid var(--vscode-editorWidget-border, #d0d7de)"),
  "borderRadius" := (← js#"8px"), "background" := (← js#"var(--vscode-editorWidget-background, #ffffff)"),
  "color" := (← js#"var(--vscode-editor-foreground, #24292f)"), "colorScheme" := (← js#"light dark"),
  "fontFamily" := (← js#"Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
}

def bodyStyle : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gap" := (← js#"8px"), "minWidth" := (← js#"0")
}

def petStageStyle : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "placeItems" := (← js#"center"), "gap" := (← js#"6px"),
  "padding" := (← js#"2px 0 0")
}

def petShell : Tamagotchi.Mood → String
  | .hungry => "#d68f3b"
  | .sleepy => "#6083b8"
  | .asleep => "#6083b8"
  | .angry => "#bd3c38"
  | .dead => "#70736f"
  | _ => "#d8505d"

def petShellDark : Tamagotchi.Mood → String
  | .hungry => "#946026"
  | .sleepy => "#354f79"
  | .asleep => "#354f79"
  | .angry => "#782523"
  | .dead => "#444946"
  | _ => "#9f303b"

def petScreen : Tamagotchi.Mood → String
  | .hungry => "#f1e2b6"
  | .sleepy => "#d8e4f4"
  | .asleep => "#d8e4f4"
  | .angry => "#f1d3bf"
  | .dead => "#d8ded2"
  | _ => "#d9edc7"

def petInk (artwork : String) : String :=
  if Tamagotchi.normalizeArtwork artwork == "octopus" then "#314f78" else "#1e3328"

def deviceStyle (state : Tamagotchi.PetState) : RuntimeM Js.Object := do
  let shell := petShell state.mood
  let shellDark := petShellDark state.mood
  js%{
    "position" := (← js#"relative"), "width" := (← js#"126px"), "height" := (← js#"154px"),
    "margin" := (← js#"0 auto"), "border" := (← js#"3px solid #6d2b34"),
    "borderRadius" := (← js#"52% 52% 44% 44% / 58% 58% 42% 42%"),
    "background" := (← JsValue.ofString ("radial-gradient(circle at 32% 18%, rgba(255, 255, 255, 0.46) 0 12%, transparent 13%), " ++
      "linear-gradient(145deg, #f06b73 0%, " ++ shell ++ " 58%, " ++ shellDark ++ " 100%)")),
    "boxShadow" := (← js#"inset 0 -10px 0 rgba(0, 0, 0, 0.08), 0 12px 18px rgba(52, 64, 54, 0.14)"),
    "filter" := (← JsValue.ofString (if state.mood == .dead then "saturate(0.35)" else "none")),
    "transition" := (← js#"filter 180ms ease, background 180ms ease"), "padding" := (← js#"0")
  }

def screenStyle (state : Tamagotchi.PetState) : RuntimeM Js.Object := do
  let screen := petScreen state.mood
  js%{
    "position" := (← js#"absolute"),
    "top" := (← js#"32px"), "left" := (← js#"21px"), "right" := (← js#"21px"),
    "height" := (← js#"72px"), "display" := (← js#"grid"), "placeItems" := (← js#"center"),
    "gap" := (← js#"2px"), "overflow" := (← js#"hidden"), "border" := (← js#"3px solid #263d2c"),
    "borderRadius" := (← js#"10px"), "background" := (← JsValue.ofString
      ("linear-gradient(rgba(38, 61, 44, 0.07) 1px, transparent 1px), " ++
       "linear-gradient(90deg, rgba(38, 61, 44, 0.07) 1px, transparent 1px), " ++ screen)),
    "backgroundSize" := (← js#"10px 10px"), "boxShadow" := (← js#"inset 0 0 0 2px rgba(255, 255, 255, 0.34)"),
    "color" := (← js#"#17201a"), "fontWeight" := (← js#"800"), "fontSize" := (← js#"0.68rem"),
    "textAlign" := (← js#"center")
  }

def actionGridStyle : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gridTemplateColumns" := (← js#"repeat(5, minmax(0, 1fr))"), "gap" := (← js#"5px")
}

def buttonStyle : RuntimeM Js.Object := js%{
  "minHeight" := (← js#"31px"), "padding" := (← js#"0 8px"), "border" := (← js#"1px solid rgba(49, 79, 120, 0.28)"),
  "borderRadius" := (← js#"8px"), "background" := (← js#"linear-gradient(180deg, var(--vscode-button-background, #f7fbf6), var(--vscode-editorWidget-background, #edf5ea))"),
  "color" := (← js#"var(--vscode-button-foreground, #17201a)"), "boxShadow" := (← js#"inset 0 -2px 0 rgba(49, 79, 120, 0.14), 0 1px 2px rgba(31, 45, 36, 0.12)"),
  "fontSize" := (← js#"0.72rem"), "fontWeight" := (← js#"800"), "textTransform" := (← js#"capitalize"),
  "transition" := (← js#"transform 120ms ease, filter 120ms ease, box-shadow 120ms ease"), "cursor" := (← js#"pointer")
}

def resetButtonStyle : RuntimeM Js.Object := js%{
  "minHeight" := (← js#"26px"), "padding" := (← js#"0 9px"),
  "border" := (← js#"1px solid var(--vscode-editorWidget-border, #d0d7de)"), "borderRadius" := (← js#"8px"),
  "background" := (← js#"var(--vscode-editor-background, #ffffff)"), "color" := (← js#"var(--vscode-descriptionForeground, #53645a)"),
  "fontSize" := (← js#"0.7rem"), "fontWeight" := (← js#"800"), "transition" := (← js#"transform 120ms ease, filter 120ms ease"),
  "cursor" := (← js#"pointer")
}

def progressWrapStyle : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gridTemplateColumns" := (← js#"minmax(0, 1fr) auto"),
  "alignItems" := (← js#"center"), "gap" := (← js#"6px"), "width" := (← js#"100%"), "maxWidth" := (← js#"138px")
}

def progressStyle : RuntimeM Js.Object := js%{
  "height" := (← js#"8px"), "minWidth" := (← js#"0"), "overflow" := (← js#"hidden"),
  "borderRadius" := (← js#"999px"), "border" := (← js#"1px solid rgba(38, 61, 44, 0.18)"),
  "background" := (← js#"var(--vscode-editorWidget-border, #d0d7de)")
}

def progressPercent (secondsLeft : Nat) : Nat :=
  let secondsLeft := if secondsLeft > liveTickSeconds then liveTickSeconds else secondsLeft
  (secondsLeft * 100) / liveTickSeconds

def progressLabel (secondsLeft : Nat) : String :=
  s!"{secondsLeft}s"

def progressFillStyle (secondsLeft : Nat) : RuntimeM Js.Object := js%{
  "width" := (← JsValue.ofString (toString (progressPercent secondsLeft) ++ "%")), "height" := (← js#"100%"),
  "borderRadius" := (← js#"inherit"), "background" := (← js#"linear-gradient(90deg, #5f9e6f, #d68f3b, #bd3c38)"),
  "transformOrigin" := (← js#"left center"), "transition" := (← js#"width 260ms linear")
}

def progressCounterStyle : RuntimeM Js.Object := js%{
  "minWidth" := (← js#"28px"), "textAlign" := (← js#"right"), "fontSize" := (← js#"0.7rem"),
  "fontWeight" := (← js#"900"), "lineHeight" := (← js#"1"), "fontVariantNumeric" := (← js#"tabular-nums"),
  "color" := (← js#"var(--vscode-descriptionForeground, #53645a)")
}

def widgetCss : String :=
  "@keyframes virPetDance {" ++
  "0%,100%{transform:translateY(0) rotate(0deg);}" ++
  "25%{transform:translateY(-3px) rotate(-2deg);}" ++
  "50%{transform:translateY(1px) rotate(0deg);}" ++
  "75%{transform:translateY(-2px) rotate(2deg);}" ++
  "}" ++
  ".react-pet-widget .vir-pet-dance{animation:virPetDance 2.8s ease-in-out infinite;}" ++
  ".react-pet-widget .react-pet-action-button:not(:disabled):hover,.react-pet-widget .react-pet-reset-button:hover{filter:brightness(1.05);transform:translateY(-1px);}" ++
  ".react-pet-widget .react-pet-action-button:not(:disabled):active,.react-pet-widget .react-pet-reset-button:active{filter:brightness(0.98);transform:translateY(0);}" ++
  ".react-pet-widget .react-pet-action-button:disabled{cursor:not-allowed;opacity:.48;filter:saturate(.45);}" ++
  "@media (prefers-reduced-motion: reduce){" ++
  ".react-pet-widget .vir-pet-dance{animation:none!important;}" ++
  ".react-pet-widget .react-pet-action-button,.react-pet-widget .react-pet-reset-button{transition:none!important;}" ++
  ".react-pet-widget .react-pet-progress-fill{transition:none!important;}" ++
  "}"

def emptySpanWith (classes : Array String) (style : Js.Object) : ReactM (Lean.Vir.Js Node) := do
  let props ← js%{
    "className" := (← JsValue.ofString (String.intercalate " " classes.toList)),
    "aria-hidden" := (← JsValue.ofBool true),
    "style" := style
  }
  jsx%{<span @props={props}/>}

def emptySpan (classes : Array String) : ReactM (Lean.Vir.Js Node) := do
  emptySpanWith classes (← Js.Object.empty)

def pixelPart (classes : Array String) (style : RuntimeM Js.Object) : ReactM (Lean.Vir.Js Node) := do
  emptySpanWith classes (← style)

def petPixelStyle : RuntimeM Js.Object := js%{
  "position" := (← js#"relative"), "width" := (← js#"60px"), "height" := (← js#"54px"), "margin" := (← js#"0 auto")
}

def bodyStyleFor (state : Tamagotchi.PetState) (ink : String) : RuntimeM Js.Object :=
  if Tamagotchi.normalizeArtwork state.artwork == "octopus" then
    js%{ "position" := (← js#"absolute"), "left" := (← js#"14px"), "top" := (← js#"9px"),
      "width" := (← js#"32px"), "height" := (← js#"30px"), "borderRadius" := (← js#"48% 48% 42% 42%"),
      "background" := (← JsValue.ofString ink) }
  else
    js%{ "position" := (← js#"absolute"), "left" := (← js#"11px"), "top" := (← js#"15px"),
      "width" := (← js#"38px"), "height" := (← js#"31px"), "borderRadius" := (← js#"9px 9px 12px 12px"),
      "background" := (← JsValue.ofString ink) }

def eyeStyleFor (state : Tamagotchi.PetState) (screen : String) (left : Bool) : RuntimeM Js.Object := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let baseLeft := if artwork == "octopus" then "23px" else "22px"
  let baseRight := if artwork == "octopus" then "23px" else "22px"
  let baseTop := if artwork == "octopus" then "20px" else "25px"
  let (width, height, transform) :=
    match state.mood with
    | .angry => ("8px", "3px", if left then "rotate(18deg)" else "rotate(-18deg)")
    | .dead => ("9px", "2px", "rotate(45deg)")
    | _ => ("5px", "5px", "")
  let horizontal := if left then "left" else "right"
  let horizontalValue := if left then baseLeft else baseRight
  let style ← js%{
    "position" := (← js#"absolute"), "top" := (← JsValue.ofString baseTop)
  }
  Js.Object.set style (← JsValue.ofString horizontal) (← JsValue.ofString horizontalValue)
  Js.Object.set style (← js#"background") (← JsValue.ofString screen)
  Js.Object.set style (← js#"borderRadius") (← js#"1px")
  Js.Object.set style (← js#"width") (← JsValue.ofString width)
  Js.Object.set style (← js#"height") (← JsValue.ofString height)
  if !transform.isEmpty then Js.Object.set style (← js#"transform") (← JsValue.ofString transform)
  pure style

def mouthStyleFor (state : Tamagotchi.PetState) (screen : String) : RuntimeM Js.Object := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let baseLeft := if artwork == "octopus" then "26px" else "25px"
  let baseTop := if artwork == "octopus" then "29px" else "34px"
  let sleepyLeft := "27px"
  let (left, top, width, height, border, borderBottom, borderRadius) := match state.mood with
  | .sleepy | .asleep =>
      (sleepyLeft, baseTop, "7px", "7px", some ("2px solid " ++ screen), none, "50%")
  | .angry =>
      (baseLeft, if artwork == "octopus" then "31px" else "36px", "11px", "0", none, some ("2px solid " ++ screen), "0")
  | .dead =>
      (baseLeft, if artwork == "octopus" then "32px" else "38px", "11px", "0", none, some ("2px solid " ++ screen), "0")
  | _ =>
      (baseLeft, baseTop, "11px", "6px", none, some ("2px solid " ++ screen), "0 0 8px 8px")
  let style ← js%{ "position" := (← js#"absolute"), "left" := (← JsValue.ofString left), "top" := (← JsValue.ofString top),
    "width" := (← JsValue.ofString width), "height" := (← JsValue.ofString height) }
  if let some border := border then Js.Object.set style (← js#"border") (← JsValue.ofString border)
  if let some borderBottom := borderBottom then Js.Object.set style (← js#"borderBottom") (← JsValue.ofString borderBottom)
  Js.Object.set style (← js#"borderRadius") (← JsValue.ofString borderRadius)
  pure style

def signalText : Tamagotchi.Mood → String
  | .hungry => "!"
  | .sleepy => "zz"
  | .asleep => "zz"
  | .angry => "!!"
  | _ => ""

def tentacle (index left transform : String) (ink : String) : ReactM (Lean.Vir.Js Node) :=
  pixelPart #["pet-tentacle", "pet-tentacle-" ++ index] (js%{
    "position" := (← js#"absolute"), "top" := (← js#"34px"), "left" := (← JsValue.ofString left),
    "width" := (← js#"7px"), "height" := (← js#"14px"), "background" := (← JsValue.ofString ink),
    "borderRadius" := (← js#"0 0 7px 7px"), "transform" := (← JsValue.ofString transform) })

def foot (left : String) (ink : String) : ReactM (Lean.Vir.Js Node) :=
  pixelPart #["pet-foot"] (js%{ "position" := (← js#"absolute"), "left" := (← JsValue.ofString left),
    "top" := (← js#"43px"), "width" := (← js#"10px"), "height" := (← js#"7px"),
    "background" := (← JsValue.ofString ink), "borderRadius" := (← js#"0 0 5px 5px") })

def pixelPet (state : Tamagotchi.PetState) : ReactM (Lean.Vir.Js Node) := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let ink := petInk artwork
  let screen := petScreen state.mood
  let body ← pixelPart #["pet-body"] (bodyStyleFor state ink)
  let eyeLeft ← pixelPart #["pet-eye", "pet-eye-left"] (eyeStyleFor state screen true)
  let eyeRight ← pixelPart #["pet-eye", "pet-eye-right"] (eyeStyleFor state screen false)
  let mouth ← pixelPart #["pet-mouth"] (mouthStyleFor state screen)
  let signalText ← Node.text (← Lean.Vir.JsValue.ofString (signalText state.mood))
  let signalStyle ← js%{ "position" := (← js#"absolute"), "top" := (← js#"0"), "right" := (← js#"2px"),
    "color" := (← JsValue.ofString ink), "fontFamily" := (← js#"SFMono-Regular, Consolas, Liberation Mono, monospace"),
    "fontSize" := (← js#"0.82rem"), "fontWeight" := (← js#"900"), "lineHeight" := (← js#"1") }
  let signalProps ← js%{
    "className" := (← js#"pet-signal"),
    "aria-hidden" := (← JsValue.ofBool true),
    "style" := signalStyle
  }
  let signal ← jsx%{<span @props={signalProps}>{pure signalText}</span>}
  let children ←
    if artwork == "octopus" then do
      let tentacle1 ← tentacle "1" "13px" "rotate(12deg)" ink
      let tentacle2 ← tentacle "2" "21px" "none" ink
      let tentacle3 ← tentacle "3" "29px" "none" ink
      let tentacle4 ← tentacle "4" "37px" "none" ink
      let tentacle5 ← tentacle "5" "45px" "rotate(-12deg)" ink
      pure #[body, tentacle1, tentacle2, tentacle3, tentacle4, tentacle5, eyeLeft, eyeRight, mouth, signal]
    else do
      let earLeft ← pixelPart #["pet-ear", "pet-ear-left"] (js%{ "position" := (← js#"absolute"), "top" := (← js#"7px"),
        "left" := (← js#"14px"), "width" := (← js#"12px"), "height" := (← js#"12px"),
        "background" := (← JsValue.ofString ink), "transform" := (← js#"rotate(45deg)") })
      let earRight ← pixelPart #["pet-ear", "pet-ear-right"] (js%{ "position" := (← js#"absolute"), "top" := (← js#"7px"),
        "right" := (← js#"14px"), "width" := (← js#"12px"), "height" := (← js#"12px"),
        "background" := (← JsValue.ofString ink), "transform" := (← js#"rotate(45deg)") })
      let footLeft ← foot "17px" ink
      let footRight ← foot "33px" ink
      pure #[earLeft, earRight, body, footLeft, footRight, eyeLeft, eyeRight, mouth, signal]
  let props ← js%{
    "className" := (← js#"pet-pixel-pet vir-pet-dance"),
    "aria-hidden" := (← JsValue.ofBool true),
    "style" := (← petPixelStyle)
  }
  Node.createElement
    (← ElementType.tag (← js#"div")) props (← Js.Array.ofArray children)

def deviceButtonStyle (left right : Option String) : RuntimeM Js.Object := do
  let style ← js%{ "position" := (← js#"absolute"), "bottom" := (← js#"18px"), "width" := (← js#"16px"),
    "height" := (← js#"16px"), "border" := (← js#"2px solid #6d2b34"), "borderRadius" := (← js#"50%"),
    "background" := (← js#"#ffe6c9"), "boxShadow" := (← js#"inset 0 -3px 0 rgba(109, 43, 52, 0.16)") }
  match left, right with
  | some value, _ => Js.Object.set style (← js#"left") (← JsValue.ofString value)
  | none, some value => Js.Object.set style (← js#"right") (← JsValue.ofString value)
  | none, none => pure ()
  pure style

def device (state : Tamagotchi.PetState) : ReactM (Lean.Vir.Js Node) := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let moodLabel := state.mood.label
  let pet ← pixelPet state
  let screenLabelText ← Node.text (← Lean.Vir.JsValue.ofString (displayName state ++ " / " ++ moodLabel))
  let screenLabel ← jsx%{<span>{pure screenLabelText}</span>}
  let screenProps ← js%{
    "className" := (← js#"pet-screen"),
    "style" := (← screenStyle state)
  }
  let screen ← jsx%{<div @props={screenProps}>{pure pet}{pure screenLabel}</div>}
  let leftButton ← emptySpanWith #["pet-device-button", "pet-device-button-left"]
    (← deviceButtonStyle (some "30px") none)
  let centerButton ← emptySpanWith #["pet-device-button", "pet-device-button-center"]
    (← deviceButtonStyle (some "55px") none)
  let rightButton ← emptySpanWith #["pet-device-button", "pet-device-button-right"]
    (← deviceButtonStyle none (some "30px"))
  let props ← js%{
    "id" := (← js#"react-pet-device"),
    "className" := (← js#"pet-device"),
    "role" := (← js#"img"),
    "aria-label" := (← JsValue.ofString s!"{Tamagotchi.artLabel artwork} {displayName state} mood {moodLabel}"),
    "data-art" := (← JsValue.ofString artwork),
    "data-mood" := (← JsValue.ofString moodLabel),
    "style" := (← deviceStyle state)
  }
  jsx%{<div @props={props}>{pure screen}{pure leftButton}{pure centerButton}{pure rightButton}</div>}

def normalizeViewState (state : Tamagotchi.PetState) : Tamagotchi.PetState :=
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  { state with artwork := artwork, care := Tamagotchi.clampCare state.care }

structure ViewState where
  state : Tamagotchi.PetState
  secondsLeft : Nat

inductive ViewAction where
  | care (action : Tamagotchi.Action)
  | artwork (checked : Bool)
  | reset
  | tick

def initialViewState : ViewState :=
  {
    state := Tamagotchi.initialState Tamagotchi.defaultOctopusName "octopus"
    secondsLeft := liveTickSeconds
  }

def normalizeView (view : ViewState) : ViewState :=
  {
    view with
    state := normalizeViewState view.state
    secondsLeft := if view.secondsLeft > liveTickSeconds then liveTickSeconds else view.secondsLeft
  }

def reduceViewState (view : ViewState) : ViewAction → Lean.Vir.RuntimeM ViewState
  | .care action =>
      let state := normalizeViewState view.state
      pure {
        state := Tamagotchi.nextState state action
        secondsLeft := liveTickSeconds
      }
  | .artwork checked =>
      let state := normalizeViewState view.state
      let artwork := Tamagotchi.artworkFromChecked checked
      let name := Tamagotchi.nameForArtworkChange state.artwork artwork state.name
      pure {
        view with
        state := { state with artwork := artwork, name := name }
      }
  | .reset =>
      let state := normalizeViewState view.state
      pure {
        state := Tamagotchi.initialState state.name state.artwork
        secondsLeft := liveTickSeconds
      }
  | .tick =>
      let view := normalizeView view
      let state := view.state
      if state.mood == .dead then
        pure { view with secondsLeft := 0 }
      else if view.secondsLeft <= 1 then
        pure {
          state := Tamagotchi.nextState state .ignore
          secondsLeft := liveTickSeconds
        }
      else
        pure {
          view with
          secondsLeft := view.secondsLeft - 1
        }

abbrev ViewReducerState : Type :=
  Js (ReducerTuple (Lean.Vir.LeanRef.Handle ViewState) (Lean.Vir.LeanRef.Handle ViewAction))

def reduceViewStateJs
    (viewJs : Lean.Vir.JSL ViewState)
    (actionJs : Lean.Vir.JSL ViewAction) :
    Lean.Vir.RuntimeM (Lean.Vir.JSL ViewState) := do
  let view ← Lean.Vir.LeanRef.fromJSL viewJs
  let action ← Lean.Vir.LeanRef.fromJSL actionJs
  let next ← reduceViewState view action
  Lean.Vir.LeanRef.toJSL next

def useViewState (initial : ViewState := initialViewState) : ReactM ViewReducerState := do
  let initialJs ← Lean.Vir.LeanRef.toJSL (normalizeView initial)
  let reducer ← Js.Function.ofLean2 reduceViewStateJs
  Hooks.useReducer reducer initialJs

def dispatchViewAction (hook : ViewReducerState) (action : ViewAction) : DomM Unit := do
  let actionJs ← Lean.Vir.LeanRef.toJSL action
  let dispatch ← Js.Tuple2.second hook
  Js.Function.callVoid dispatch actionJs

def tick (hook : ViewReducerState) : DomM Unit :=
  dispatchViewAction hook .tick

def useLiveTick (hook : ViewReducerState) : ReactM Unit := do
  let effect ← Js.Function.ofLean0 <| DomM.toRuntime do
    let interval ← Lean.Vir.Browser.Timer.setInterval (tick hook)
      (← Lean.Vir.JsValue.ofFloat (UInt64.ofNat liveTickMs.toNat).toFloat)
    let cleanup ← Js.Function.ofLean0Void <| DomM.toRuntime do
      Lean.Vir.Browser.Timer.clearInterval interval
    pure (Js.UndefinedOr.ofJs cleanup)
  Hooks.useEffect effect (Js.UndefinedOr.ofJs (← js#[]))

def widgetStyleNode : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString widgetCss)
  jsx%{<style>{pure text}</style>}

def progressBar (secondsLeft : Nat) : ReactM (Lean.Vir.Js Node) := do
  let fillProps ← js%{
    "id" := (← js#"react-pet-progress-fill"),
    "className" := (← js#"react-pet-progress-fill"),
    "style" := (← progressFillStyle secondsLeft)
  }
  let fill ← jsx%{<div @props={fillProps}/>}
  let barProps ← js%{
    "id" := (← js#"react-pet-progress"),
    "className" := (← js#"react-pet-progress"),
    "role" := (← js#"progressbar"),
    "aria-label" := (← js#"Time until next mood change"),
    "title" := (← JsValue.ofString s!"Next mood change in {progressLabel secondsLeft}"),
    "aria-valuemin" := (← JsValue.ofFloat 0),
    "aria-valuemax" := (← JsValue.ofFloat liveTickSeconds.toFloat),
    "aria-valuenow" := (← JsValue.ofFloat secondsLeft.toFloat),
    "style" := (← progressStyle)
  }
  let bar ← jsx%{<div @props={barProps}>{pure fill}</div>}
  let counterText ← Node.text (← Lean.Vir.JsValue.ofString (progressLabel secondsLeft))
  let counterProps ← js%{
    "id" := (← js#"react-pet-progress-counter"),
    "className" := (← js#"react-pet-progress-counter"),
    "aria-hidden" := (← JsValue.ofBool true),
    "style" := (← progressCounterStyle)
  }
  let counter ← jsx%{<span @props={counterProps}>{pure counterText}</span>}
  let wrapProps ← js%{
    "className" := (← js#"react-pet-progress-wrap"),
    "style" := (← progressWrapStyle)
  }
  jsx%{<div @props={wrapProps}>{pure bar}{pure counter}</div>}

def View : RuntimeM (FunctionComponent Props) := FunctionComponent.ofLean fun _ => do
  let hook ← useViewState
  let view ← Lean.Vir.LeanRef.fromJSL (← Js.Tuple2.first hook)
  let state := normalizeViewState view.state
  useLiveTick hook
  let actionButton : Tamagotchi.Action → ReactM (Js Node) := fun action => do
    let text ← Node.text (← Lean.Vir.JsValue.ofString action.label)
    let onClick ← Js.Function.ofLeanVoid fun (_ : Lean.Vir.Js Lean.Vir.React.SyntheticEvent) =>
      DomM.toRuntime (dispatchViewAction hook (.care action))
    let props ← js%{
      "key" := (← JsValue.ofString action.label),
      "id" := (← JsValue.ofString ("react-pet-action-" ++ action.label)),
      "className" := (← js#"react-pet-action-button"),
      "type" := (← js#"button"),
      "disabled" := (← JsValue.ofBool (state.mood == .dead)),
      "aria-label" := (← JsValue.ofString ("Tamagotchi action " ++ action.label)),
      "style" := (← buttonStyle),
      "onClick" := onClick
    }
    jsx%{<button @props={props}>{pure text}</button>}
  let artInput ← show ReactM (Js Node) from do
    let onChange ← Js.Function.ofLeanVoid fun (event : Lean.Vir.Js Lean.Vir.React.SyntheticEvent) => DomM.toRuntime do
      let target ← ReactM.run (Lean.Vir.React.SyntheticEvent.currentTarget event)
      let input ← match ← Lean.Vir.Browser.EventTarget.asElement target with
        | none => pure none
        | some element => Lean.Vir.Browser.HTMLInputElement.fromElement element
      match input with
      | none => pure ()
      | some input => do
          let checked ← Lean.Vir.JsValue.toBool
            (← Lean.Vir.Browser.HTMLInputElement.getChecked input)
          dispatchViewAction hook (.artwork checked)
    let props ← js%{
      "id" := (← js#"react-pet-art-toggle"),
      "type" := (← js#"checkbox"),
      "checked" := (← JsValue.ofBool (state.artwork == "octopus")),
      "onChange" := onChange
    }
    jsx%{<input @props={props}/>}
  let artText ← Node.text (← Lean.Vir.JsValue.ofString "Octopus")
  let artSpan ← jsx%{<span>{pure artText}</span>}
  let artLabelStyle ← js%{ "display" := (← js#"inline-flex"), "alignItems" := (← js#"center"),
    "gap" := (← js#"5px"), "fontSize" := (← js#"0.72rem"), "fontWeight" := (← js#"800"),
    "color" := (← js#"var(--vscode-descriptionForeground, #53645a)") }
  let artLabelProps ← js%{
    "htmlFor" := (← js#"react-pet-art-toggle"),
    "className" := (← js#"react-pet-toggle"),
    "style" := artLabelStyle
  }
  let artLabel ← jsx%{<label @props={artLabelProps}>{pure artInput}{pure artSpan}</label>}
  let deviceNode ← device state
  let moodText ← Node.text (← Lean.Vir.JsValue.ofString state.mood.label)
  let moodStyle ← js%{ "fontSize" := (← js#"1.32rem"), "fontWeight" := (← js#"900"),
    "lineHeight" := (← js#"1"), "color" := (← js#"var(--vscode-editor-foreground, #20384a)") }
  let moodProps ← js%{
    "id" := (← js#"react-pet-mood"),
    "style" := moodStyle
  }
  let moodValueNode ← jsx%{<span @props={moodProps}>{pure moodText}</span>}
  let progress ← progressBar view.secondsLeft
  let petStateProps ← js%{
    "className" := (← js#"pet-state"),
    "style" := (← petStageStyle)
  }
  let petState ← jsx%{<div @props={petStateProps}>{pure deviceNode}{pure moodValueNode}{pure progress}</div>}
  let actionButtons ← actions.mapM actionButton
  let actionsProps ← js%{
    "className" := (← js#"action-grid react-pet-actions"),
    "style" := (← actionGridStyle)
  }
  let actionsNode ← Node.createElement
    (← ElementType.tag (← js#"div")) actionsProps (← Js.Array.ofArray actionButtons)
  let resetText ← Node.text (← Lean.Vir.JsValue.ofString "Reset")
  let resetClick ← Js.Function.ofLeanVoid fun (_ : Lean.Vir.Js Lean.Vir.React.SyntheticEvent) =>
    DomM.toRuntime (dispatchViewAction hook .reset)
  let resetProps ← js%{
    "id" := (← js#"react-pet-reset"),
    "className" := (← js#"react-pet-reset-button"),
    "type" := (← js#"button"),
    "style" := (← resetButtonStyle),
    "onClick" := resetClick
  }
  let reset ← jsx%{<button @props={resetProps}>{pure resetText}</button>}
  let controlsStyle ← js%{ "display" := (← js#"flex"), "alignItems" := (← js#"center"),
    "justifyContent" := (← js#"space-between"), "gap" := (← js#"8px") }
  let controlsProps ← js%{
    "className" := (← js#"react-pet-controls"),
    "style" := controlsStyle
  }
  let controls ← jsx%{<div @props={controlsProps}>{pure artLabel}{pure reset}</div>}
  let bodyProps ← js%{
    "className" := (← js#"react-pet-body"),
    "style" := (← bodyStyle)
  }
  let body ← jsx%{<div @props={bodyProps}>{pure petState}{pure actionsNode}{pure controls}</div>}
  let css ← widgetStyleNode
  let widgetProps ← js%{
    "id" := (← js#"react-pet-widget"),
    "className" := (← js#"react-pet-widget"),
    "data-mood" := (← JsValue.ofString state.mood.label),
    "style" := (← widgetStyle)
  }
  jsx%{<div @props={widgetProps}>{pure css}{pure body}</div>}

def mount (selector : String) : DomM Bool := do
  let component ← View
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#react-pet-root"

end ReactTamagotchi
