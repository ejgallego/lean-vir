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

def stateKey (state : Tamagotchi.PetState) (actionLabel : String) : String :=
  "|".intercalate #[
    state.name,
    state.mood.label,
    Tamagotchi.traceAttr state.trace,
    state.artwork,
    toString state.turns,
    toString state.care,
    actionLabel
  ].toList

def liveTickLabel : String :=
  "tick"

def liveTickMs : UInt32 :=
  50000

def style (entries : Array (String × String)) : Property :=
  Property.stylePairs entries

def widgetStyle : Property := style #[
  ("display", "grid"),
  ("gap", "8px"),
  ("minWidth", "0"),
  ("maxWidth", "360px"),
  ("padding", "10px"),
  ("border", "1px solid var(--vscode-editorWidget-border, #d0d7de)"),
  ("borderRadius", "8px"),
  ("background", "var(--vscode-editorWidget-background, #ffffff)"),
  ("color", "var(--vscode-editor-foreground, #24292f)"),
  ("colorScheme", "light dark"),
  ("fontFamily", "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
]

def headingStyle : Property := style #[
  ("display", "flex"),
  ("flexWrap", "wrap"),
  ("gap", "6px"),
  ("alignItems", "center"),
  ("justifyContent", "space-between"),
  ("minWidth", "0")
]

def bodyStyle : Property := style #[
  ("display", "grid"),
  ("gap", "8px"),
  ("minWidth", "0")
]

def petStageStyle : Property := style #[
  ("display", "grid"),
  ("placeItems", "center"),
  ("gap", "6px"),
  ("padding", "2px 0 0")
]

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

def deviceStyle (state : Tamagotchi.PetState) : Property :=
  let shell := petShell state.mood
  let shellDark := petShellDark state.mood
  style #[
    ("position", "relative"),
    ("width", "126px"),
    ("height", "154px"),
    ("margin", "0 auto"),
    ("border", "3px solid #6d2b34"),
    ("borderRadius", "52% 52% 44% 44% / 58% 58% 42% 42%"),
    ("background",
      "radial-gradient(circle at 32% 18%, rgba(255, 255, 255, 0.46) 0 12%, transparent 13%), " ++
      "linear-gradient(145deg, #f06b73 0%, " ++ shell ++ " 58%, " ++ shellDark ++ " 100%)"),
    ("boxShadow", "inset 0 -10px 0 rgba(0, 0, 0, 0.08), 0 12px 18px rgba(52, 64, 54, 0.14)"),
    ("filter", if state.mood == .dead then "saturate(0.35)" else "none"),
    ("transition", "filter 180ms ease, background 180ms ease"),
    ("padding", "0")
  ]

def screenStyle (state : Tamagotchi.PetState) : Property :=
  let screen := petScreen state.mood
  style #[
    ("position", "absolute"),
    ("top", "32px"),
    ("left", "21px"),
    ("right", "21px"),
    ("height", "72px"),
    ("display", "grid"),
    ("placeItems", "center"),
    ("gap", "2px"),
    ("overflow", "hidden"),
    ("border", "3px solid #263d2c"),
    ("borderRadius", "10px"),
    ("background",
      "linear-gradient(rgba(38, 61, 44, 0.07) 1px, transparent 1px), " ++
      "linear-gradient(90deg, rgba(38, 61, 44, 0.07) 1px, transparent 1px), " ++ screen),
    ("backgroundSize", "10px 10px"),
    ("boxShadow", "inset 0 0 0 2px rgba(255, 255, 255, 0.34)"),
    ("color", "#17201a"),
    ("fontWeight", "800"),
    ("fontSize", "0.68rem"),
    ("textAlign", "center")
  ]

def statGridStyle : Property := style #[
  ("display", "flex"),
  ("flexWrap", "wrap"),
  ("gap", "4px"),
  ("minWidth", "0")
]

def statStyle : Property := style #[
  ("display", "inline-grid"),
  ("gap", "1px"),
  ("minWidth", "58px"),
  ("padding", "4px 6px"),
  ("border", "1px solid var(--vscode-editorWidget-border, #d0d7de)"),
  ("borderRadius", "5px"),
  ("background", "var(--vscode-editor-background, #ffffff)"),
  ("fontSize", "0.72rem"),
  ("lineHeight", "1.15")
]

def actionGridStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(5, minmax(0, 1fr))"),
  ("gap", "4px")
]

def buttonStyle : Property := style #[
  ("minHeight", "28px"),
  ("padding", "0 5px"),
  ("border", "1px solid var(--vscode-button-border, #8ba58c)"),
  ("borderRadius", "5px"),
  ("background", "var(--vscode-button-background, #ffffff)"),
  ("color", "var(--vscode-button-foreground, #17201a)"),
  ("fontSize", "0.72rem"),
  ("fontWeight", "800"),
  ("cursor", "pointer")
]

def summaryStyle : Property := style #[
  ("margin", "0"),
  ("padding", "6px 7px"),
  ("border", "1px solid var(--vscode-editorWidget-border, #d0d7de)"),
  ("borderRadius", "6px"),
  ("background", "var(--vscode-textCodeBlock-background, #f6f8fa)"),
  ("fontSize", "0.76rem"),
  ("lineHeight", "1.25"),
  ("overflowWrap", "anywhere")
]

def progressStyle : Property := style #[
  ("height", "6px"),
  ("overflow", "hidden"),
  ("borderRadius", "999px"),
  ("background", "var(--vscode-editorWidget-border, #d0d7de)")
]

def progressFillStyle : Property := style #[
  ("width", "100%"),
  ("height", "100%"),
  ("borderRadius", "inherit"),
  ("background", "linear-gradient(90deg, #5f9e6f, #d68f3b, #bd3c38)"),
  ("transformOrigin", "left center"),
  ("animation", "virPetCountdown 50s linear forwards")
]

def widgetCss : String :=
  "@keyframes virPetDance {" ++
  "0%,100%{transform:translateY(0) rotate(0deg);}" ++
  "25%{transform:translateY(-3px) rotate(-2deg);}" ++
  "50%{transform:translateY(1px) rotate(0deg);}" ++
  "75%{transform:translateY(-2px) rotate(2deg);}" ++
  "}" ++
  "@keyframes virPetCountdown {" ++
  "from{transform:scaleX(1);}" ++
  "to{transform:scaleX(0);}" ++
  "}" ++
  ".react-pet-widget .vir-pet-dance{animation:virPetDance 2.8s ease-in-out infinite;}" ++
  ".react-pet-widget .react-pet-stat span:first-child{text-transform:uppercase;color:var(--vscode-descriptionForeground,#5f6f64);font-weight:800;}" ++
  ".react-pet-widget .react-pet-stat span:last-child{font-weight:800;color:var(--vscode-editor-foreground,#17201a);}" ++
  "@media (prefers-reduced-motion: reduce){" ++
  ".react-pet-widget .vir-pet-dance,.react-pet-widget .react-pet-progress-fill{animation:none!important;}" ++
  "}"

def emptySpanWith (classes : Array String) (props : Array Property) : ReactM (Lean.Vir.Js Node) :=
  Node.spanWith
    (#[Property.classList classes, Property.ariaHidden true] ++ props)
    #[]
    #[]

def emptySpan (classes : Array String) : ReactM (Lean.Vir.Js Node) :=
  emptySpanWith classes #[]

def pixelPart (classes : Array String) (entries : Array (String × String)) : ReactM (Lean.Vir.Js Node) :=
  emptySpanWith classes #[style entries]

def petPixelStyle : Property := style #[
  ("position", "relative"),
  ("width", "60px"),
  ("height", "54px"),
  ("margin", "0 auto")
]

def bodyStyleFor (state : Tamagotchi.PetState) (ink : String) : Array (String × String) :=
  if Tamagotchi.normalizeArtwork state.artwork == "octopus" then
    #[
      ("position", "absolute"),
      ("left", "14px"),
      ("top", "9px"),
      ("width", "32px"),
      ("height", "30px"),
      ("borderRadius", "48% 48% 42% 42%"),
      ("background", ink)
    ]
  else
    #[
      ("position", "absolute"),
      ("left", "11px"),
      ("top", "15px"),
      ("width", "38px"),
      ("height", "31px"),
      ("borderRadius", "9px 9px 12px 12px"),
      ("background", ink)
    ]

def eyeStyleFor (state : Tamagotchi.PetState) (screen : String) (left : Bool) : Array (String × String) :=
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let baseLeft := if artwork == "octopus" then "23px" else "22px"
  let baseRight := if artwork == "octopus" then "23px" else "22px"
  let baseTop := if artwork == "octopus" then "20px" else "25px"
  let moodShape :=
    match state.mood with
    | .angry => #[("width", "8px"), ("height", "3px"), ("transform", if left then "rotate(18deg)" else "rotate(-18deg)")]
    | .dead => #[("width", "9px"), ("height", "2px"), ("transform", "rotate(45deg)")]
    | _ => #[("width", "5px"), ("height", "5px")]
  #[
    ("position", "absolute"),
    ("top", baseTop),
    (if left then ("left", baseLeft) else ("right", baseRight)),
    ("background", screen),
    ("borderRadius", "1px")
  ] ++ moodShape

def mouthStyleFor (state : Tamagotchi.PetState) (screen : String) : Array (String × String) :=
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let baseLeft := if artwork == "octopus" then "26px" else "25px"
  let baseTop := if artwork == "octopus" then "29px" else "34px"
  let sleepyLeft := "27px"
  match state.mood with
  | .sleepy | .asleep =>
      #[
        ("position", "absolute"),
        ("left", sleepyLeft),
        ("top", baseTop),
        ("width", "7px"),
        ("height", "7px"),
        ("border", "2px solid " ++ screen),
        ("borderRadius", "50%")
      ]
  | .angry =>
      #[
        ("position", "absolute"),
        ("left", baseLeft),
        ("top", if artwork == "octopus" then "31px" else "36px"),
        ("width", "11px"),
        ("height", "0"),
        ("borderBottom", "2px solid " ++ screen),
        ("borderRadius", "0")
      ]
  | .dead =>
      #[
        ("position", "absolute"),
        ("left", baseLeft),
        ("top", if artwork == "octopus" then "32px" else "38px"),
        ("width", "11px"),
        ("height", "0"),
        ("borderBottom", "2px solid " ++ screen),
        ("borderRadius", "0")
      ]
  | _ =>
      #[
        ("position", "absolute"),
        ("left", baseLeft),
        ("top", baseTop),
        ("width", "11px"),
        ("height", "6px"),
        ("borderBottom", "2px solid " ++ screen),
        ("borderRadius", "0 0 8px 8px")
      ]

def signalText : Tamagotchi.Mood → String
  | .hungry => "!"
  | .sleepy => "zz"
  | .asleep => "zz"
  | .angry => "!!"
  | _ => ""

def tentacle (index left transform : String) (ink : String) : ReactM (Lean.Vir.Js Node) :=
  pixelPart #["pet-tentacle", "pet-tentacle-" ++ index] #[
    ("position", "absolute"),
    ("top", "34px"),
    ("left", left),
    ("width", "7px"),
    ("height", "14px"),
    ("background", ink),
    ("borderRadius", "0 0 7px 7px"),
    ("transform", transform)
  ]

def foot (left : String) (ink : String) : ReactM (Lean.Vir.Js Node) :=
  pixelPart #["pet-foot"] #[
    ("position", "absolute"),
    ("left", left),
    ("top", "43px"),
    ("width", "10px"),
    ("height", "7px"),
    ("background", ink),
    ("borderRadius", "0 0 5px 5px")
  ]

def pixelPet (state : Tamagotchi.PetState) : ReactM (Lean.Vir.Js Node) := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let ink := petInk artwork
  let screen := petScreen state.mood
  let body ← pixelPart #["pet-body"] (bodyStyleFor state ink)
  let eyeLeft ← pixelPart #["pet-eye", "pet-eye-left"] (eyeStyleFor state screen true)
  let eyeRight ← pixelPart #["pet-eye", "pet-eye-right"] (eyeStyleFor state screen false)
  let mouth ← pixelPart #["pet-mouth"] (mouthStyleFor state screen)
  let signalText ← Node.text (signalText state.mood)
  let signal ←
    Node.spanWith
      #[
        Property.classList #["pet-signal"],
        Property.ariaHidden true,
        style #[
          ("position", "absolute"),
          ("top", "0"),
          ("right", "2px"),
          ("color", ink),
          ("fontFamily", "SFMono-Regular, Consolas, Liberation Mono, monospace"),
          ("fontSize", "0.82rem"),
          ("fontWeight", "900"),
          ("lineHeight", "1")
        ]
      ]
      #[]
      #[signalText]
  let children ←
    if artwork == "octopus" then do
      let tentacle1 ← tentacle "1" "13px" "rotate(12deg)" ink
      let tentacle2 ← tentacle "2" "21px" "none" ink
      let tentacle3 ← tentacle "3" "29px" "none" ink
      let tentacle4 ← tentacle "4" "37px" "none" ink
      let tentacle5 ← tentacle "5" "45px" "rotate(-12deg)" ink
      pure #[body, tentacle1, tentacle2, tentacle3, tentacle4, tentacle5, eyeLeft, eyeRight, mouth, signal]
    else do
      let earLeft ← pixelPart #["pet-ear", "pet-ear-left"] #[
        ("position", "absolute"),
        ("top", "7px"),
        ("left", "14px"),
        ("width", "12px"),
        ("height", "12px"),
        ("background", ink),
        ("transform", "rotate(45deg)")
      ]
      let earRight ← pixelPart #["pet-ear", "pet-ear-right"] #[
        ("position", "absolute"),
        ("top", "7px"),
        ("right", "14px"),
        ("width", "12px"),
        ("height", "12px"),
        ("background", ink),
        ("transform", "rotate(45deg)")
      ]
      let footLeft ← foot "17px" ink
      let footRight ← foot "33px" ink
      pure #[earLeft, earRight, body, footLeft, footRight, eyeLeft, eyeRight, mouth, signal]
  Node.divWith
    #[Property.classList #["pet-pixel-pet", "vir-pet-dance"], Property.ariaHidden true, petPixelStyle]
    #[]
    children

def deviceButtonStyle (left right : Option String) : Property :=
  let horizontal :=
    match left, right with
    | some value, _ => #[("left", value)]
    | none, some value => #[("right", value)]
    | none, none => #[]
  style <| #[
    ("position", "absolute"),
    ("bottom", "18px"),
    ("width", "16px"),
    ("height", "16px"),
    ("border", "2px solid #6d2b34"),
    ("borderRadius", "50%"),
    ("background", "#ffe6c9"),
    ("boxShadow", "inset 0 -3px 0 rgba(109, 43, 52, 0.16)")
  ] ++ horizontal

def device (state : Tamagotchi.PetState) : ReactM (Lean.Vir.Js Node) := do
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  let moodLabel := state.mood.label
  let pet ← pixelPet state
  let screenLabelText ← Node.text (displayName state ++ " / " ++ moodLabel)
  let screenLabel ← Node.spanWith #[] #[] #[screenLabelText]
  let screen ← Node.divWith #[Property.classList #["pet-screen"], screenStyle state] #[] #[pet, screenLabel]
  let leftButton ← emptySpanWith #["pet-device-button", "pet-device-button-left"] #[deviceButtonStyle (some "30px") none]
  let centerButton ← emptySpanWith #["pet-device-button", "pet-device-button-center"] #[deviceButtonStyle (some "55px") none]
  let rightButton ← emptySpanWith #["pet-device-button", "pet-device-button-right"] #[deviceButtonStyle none (some "30px")]
  Node.divWith
    #[
      Property.id "react-pet-device",
      Property.classList #["pet-device"],
      Property.role "img",
      Property.ariaLabel s!"{Tamagotchi.artLabel artwork} {displayName state} mood {moodLabel}",
      Property.data "art" artwork,
      Property.data "mood" moodLabel,
      deviceStyle state
    ]
    #[]
    #[screen, leftButton, centerButton, rightButton]

def stat (key label value : String) : ReactM (Lean.Vir.Js Node) := do
  let labelText ← Node.text label
  let labelNode ← Node.spanWith #[] #[] #[labelText]
  let valueText ← Node.text value
  let valueNode ← Node.spanWith #[] #[] #[valueText]
  Node.keyedDivWith key
    #[Property.classList #["react-pet-stat"], statStyle]
    #[]
    #[labelNode, valueNode]

partial def traceNodesAux (index : Nat) : List Tamagotchi.Mood → ReactM (Array (Lean.Vir.Js Node))
  | [] => pure #[]
  | mood :: rest => do
      let text ← Node.text mood.label
      let node ←
        Node.keyedSpanWith
          (toString index)
          #[
            Property.classList #["react-pet-trace-token", "react-pet-trace-" ++ mood.label],
            Property.role "listitem"
          ]
          #[]
          #[text]
      let restNodes ← traceNodesAux (index + 1) rest
      pure (#[node] ++ restNodes)

def traceNodes (trace : List Tamagotchi.Mood) : ReactM (Array (Lean.Vir.Js Node)) :=
  traceNodesAux 0 trace

def traceAriaLabel (trace : List Tamagotchi.Mood) : String :=
  "Mood trace: " ++ Tamagotchi.traceLabel trace

def normalizeViewState (state : Tamagotchi.PetState) : Tamagotchi.PetState :=
  let artwork := Tamagotchi.normalizeArtwork state.artwork
  { state with artwork := artwork, care := Tamagotchi.clampCare state.care }

structure ViewState where
  state : Tamagotchi.PetState
  actionLabel : String

structure ViewStateHook where
  name : State (Lean.Vir.Js String)
  mood : State (Lean.Vir.Js String)
  trace : State (Lean.Vir.Js String)
  artwork : State (Lean.Vir.Js String)
  turns : State (Lean.Vir.Js Nat)
  care : State (Lean.Vir.Js Nat)
  actionLabel : State (Lean.Vir.Js String)
  value : ViewState

def initialViewState : ViewState :=
  {
    state := Tamagotchi.initialState Tamagotchi.defaultOctopusName "octopus"
    actionLabel := "..."
  }

def viewStateFromValues
    (name moodLabel traceValue artwork : String)
    (turns care : Nat)
    (actionLabel : String) : ViewState :=
  let mood := Tamagotchi.Mood.fromString? moodLabel |>.getD .happy
  let trace := Tamagotchi.traceFromAttr traceValue
  let trace := if trace.isEmpty then [mood] else trace
  {
    state := {
      name := Tamagotchi.normalizeNameForArtwork artwork name
      mood := mood
      trace := trace
      artwork := Tamagotchi.normalizeArtwork artwork
      turns := turns
      care := Tamagotchi.clampCare care
    }
    actionLabel
  }

def useViewState (initial : ViewState := initialViewState) : ReactM ViewStateHook := do
  let state := normalizeViewState initial.state
  let initialName ← Lean.Vir.JsValue.ofString state.name
  let name ← Hooks.useState initialName
  let initialMood ← Lean.Vir.JsValue.ofString state.mood.label
  let mood ← Hooks.useState initialMood
  let initialTrace ← Lean.Vir.JsValue.ofString (Tamagotchi.traceAttr state.trace)
  let trace ← Hooks.useState initialTrace
  let initialArtwork ← Lean.Vir.JsValue.ofString state.artwork
  let artwork ← Hooks.useState initialArtwork
  let initialTurns ← Lean.Vir.JsValue.ofNat state.turns
  let turns ← Hooks.useState initialTurns
  let initialCare ← Lean.Vir.JsValue.ofNat state.care
  let care ← Hooks.useState initialCare
  let initialAction ← Lean.Vir.JsValue.ofString initial.actionLabel
  let actionLabel ← Hooks.useState initialAction
  let nameValue ← Lean.Vir.JsValue.toString name.value
  let moodValue ← Lean.Vir.JsValue.toString mood.value
  let traceValue ← Lean.Vir.JsValue.toString trace.value
  let artworkValue ← Lean.Vir.JsValue.toString artwork.value
  let turnsValue ← Lean.Vir.JsValue.toNat turns.value
  let careValue ← Lean.Vir.JsValue.toNat care.value
  let actionValue ← Lean.Vir.JsValue.toString actionLabel.value
  let value := viewStateFromValues
    nameValue
    moodValue
    traceValue
    artworkValue
    turnsValue
    careValue
    actionValue
  pure { name, mood, trace, artwork, turns, care, actionLabel, value }

def setStringState (state : State (Lean.Vir.Js String)) (value : String) : DomM Unit := do
  let next ← Lean.Vir.JsValue.ofString value
  State.set state next

def setNatState (state : State (Lean.Vir.Js Nat)) (value : Nat) : DomM Unit := do
  let next ← Lean.Vir.JsValue.ofNat value
  State.set state next

def commit (hook : ViewStateHook) (next : ViewState) : DomM Unit := do
  let state := normalizeViewState next.state
  setStringState hook.name state.name
  setStringState hook.mood state.mood.label
  setStringState hook.trace (Tamagotchi.traceAttr state.trace)
  setStringState hook.artwork state.artwork
  setNatState hook.turns state.turns
  setNatState hook.care state.care
  setStringState hook.actionLabel next.actionLabel

def tick (hook : ViewStateHook) (state : Tamagotchi.PetState) : DomM Unit := do
  if state.mood == .dead then
    pure ()
  else
    commit hook {
      state := Tamagotchi.nextState state .ignore
      actionLabel := liveTickLabel
    }

def useLiveTick (hook : ViewStateHook) (state : Tamagotchi.PetState) : ReactM Unit := do
  Hooks.useEffectKey (stateKey state hook.value.actionLabel)
    (Lean.Vir.Browser.Timer.setInterval liveTickMs (tick hook state))
    (fun interval => Lean.Vir.Browser.Timer.clearInterval interval)

def widgetStyleNode : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text widgetCss
  Node.elementWith "style" #[] #[] #[text]

def progressBar (key : String) : ReactM (Lean.Vir.Js Node) := do
  let fill ←
    Node.keyedDivWith key
      #[
        Property.id "react-pet-progress-fill",
        Property.classList #["react-pet-progress-fill"],
        progressFillStyle
      ]
      #[]
      #[]
  Node.divWith
    #[
      Property.id "react-pet-progress",
      Property.classList #["react-pet-progress"],
      Property.role "progressbar",
      Property.ariaLabel "Time until next mood change",
      progressStyle
    ]
    #[]
    #[fill]

def View : Component Unit := fun _ => do
  let hook ← useViewState
  let state := normalizeViewState hook.value.state
  let key := stateKey state hook.value.actionLabel
  useLiveTick hook state
  let shownName := displayName state
  let actionButton := fun action => do
    let text ← Node.text action.label
    Node.keyedButtonWith
      action.label
      #[
        Property.id ("react-pet-action-" ++ action.label),
        Property.disabled (state.mood == .dead),
        Property.ariaLabel ("Tamagotchi action " ++ action.label),
        buttonStyle
      ]
      #[EventHandler.onClick (commit hook {
        state := Tamagotchi.nextState state action
        actionLabel := action.label
      })]
      #[text]
  let nameText ← Node.text "Name"
  let nameLabel ← Node.labelWith #[Property.htmlFor "react-pet-name-input"] #[] #[nameText]
  let nameInput ←
    Node.input
      #[
        Property.id "react-pet-name-input",
        Property.inputName "react-pet-name",
        Property.type "text",
        Property.inputValue state.name,
        Property.placeholder shownName,
        Property.maxLength 18,
        Property.autoComplete "off",
        style #[
          ("width", "112px"),
          ("minHeight", "26px"),
          ("padding", "2px 6px"),
          ("fontSize", "0.76rem"),
          ("fontWeight", "700")
        ]
      ]
      #[EventHandler.onChange fun event => do
        match ← Lean.Vir.Browser.Event.inputValue? event with
        | none => pure ()
        | some name => commit hook { state := { state with name := name }, actionLabel := "rename" }]
  let nameForm ←
    Node.formWith
      #[
        Property.id "react-pet-name-form",
        style #[
          ("display", "flex"),
          ("alignItems", "center"),
          ("gap", "5px"),
          ("minWidth", "0")
        ]
      ]
      #[EventHandler.onSubmitWith fun event => do
        Lean.Vir.Browser.Event.preventDefault event
        Lean.Vir.Browser.Event.stopPropagation event
        commit hook { state := { state with name := shownName }, actionLabel := "rename" }]
      #[nameLabel, nameInput]
  let artInput ←
    Node.input
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
            commit hook { state := { state with artwork := artwork, name := name }, actionLabel := "artwork" }]
  let artText ← Node.text "Octopus"
  let artSpan ← Node.spanWith #[] #[] #[artText]
  let artLabel ←
    Node.labelWith
      #[
        Property.htmlFor "react-pet-art-toggle",
        Property.classList #["react-pet-toggle"],
        style #[
          ("display", "inline-flex"),
          ("alignItems", "center"),
          ("gap", "5px"),
          ("fontSize", "0.72rem"),
          ("fontWeight", "800")
        ]
      ]
      #[]
      #[artInput, artSpan]
  let heading ←
    Node.divWith
      #[Property.classList #["react-pet-heading"], headingStyle]
      #[]
      #[nameForm, artLabel]
  let deviceNode ← device state
  let moodText ← Node.text state.mood.label
  let moodValueNode ←
    Node.spanWith
      #[
        Property.id "react-pet-mood",
        style #[
          ("fontSize", "1.32rem"),
          ("fontWeight", "900"),
          ("lineHeight", "1"),
          ("color", "var(--vscode-editor-foreground, #20384a)")
        ]
      ]
      #[]
      #[moodText]
  let progress ← progressBar key
  let petState ←
    Node.divWith
      #[Property.classList #["pet-state"], petStageStyle]
      #[]
      #[deviceNode, moodValueNode, progress]
  let careStat ← stat "care" "care" s!"{state.care}/{Tamagotchi.maxCare}"
  let turnStat ← stat "turn" "turn" (toString state.turns)
  let lastStat ← stat "last" "last" hook.value.actionLabel
  let stats ←
    Node.divWith
      #[Property.classList #["react-pet-stats"], statGridStyle]
      #[]
      #[careStat, turnStat, lastStat]
  let actionButtons ← actions.mapM actionButton
  let actionsNode ←
    Node.divWith
      #[Property.classList #["action-grid", "react-pet-actions"], actionGridStyle]
      #[]
      actionButtons
  let traceNodeList ← traceNodes state.trace
  let trace ←
    Node.divWith
      #[
        Property.classList #["react-pet-trace"],
        Property.id "react-pet-trace",
        Property.role "list",
        Property.ariaLabel (traceAriaLabel state.trace),
        summaryStyle
      ]
      #[]
      traceNodeList
  let summaryText ← Node.text (summaryLabel state hook.value.actionLabel)
  let summary ←
    Node.divWith
      #[Property.classList #["react-pet-summary"], Property.id "react-pet-summary", summaryStyle]
      #[]
      #[summaryText]
  let resetText ← Node.text "Reset"
  let reset ←
    Node.buttonWith
      #[Property.id "react-pet-reset", buttonStyle]
      #[EventHandler.onClick (commit hook {
        state := Tamagotchi.initialState state.name state.artwork
        actionLabel := "..."
      })]
      #[resetText]
  let body ←
    Node.divWith
      #[Property.classList #["react-pet-body"], bodyStyle]
      #[]
      #[petState, stats, actionsNode, summary, trace, reset]
  let css ← widgetStyleNode
  Node.divWith
    #[
      Property.id "react-pet-widget",
      Property.classList #["react-pet-widget"],
      Property.data "mood" state.mood.label,
      widgetStyle
    ]
    #[]
    #[css, heading, body]

def mount (selector : String) : DomM Bool :=
  Root.renderComponentIntoSelector selector View ()

def mountDefault : DomM Bool :=
  mount "#react-pet-root"

end ReactTamagotchi
