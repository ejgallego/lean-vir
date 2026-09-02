/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview
import Vir.Examples.Style
import Vir.React

namespace ReactProofWidget

open Lean.Vir
open Lean.Vir.React
open Lean.Vir.Browser (DomM)
open Lean.Vir.Infoview (Goal Hypothesis Surface)

namespace Style

abbrev style := Lean.Vir.Examples.Style.style
abbrev vscodeColor := Lean.Vir.Examples.Style.vscodeColor
abbrev border := Lean.Vir.Examples.Style.border

def fg : String := vscodeColor "editor-foreground" "#24292f"
def muted : String := vscodeColor "descriptionForeground" "#57606a"
def background : String := vscodeColor "editorWidget-background" "#ffffff"
def codeBackground : String := vscodeColor "textCodeBlock-background" "#f6f8fa"
def borderColor : String := vscodeColor "editorWidget-border" "#d0d7de"
def accent : String := vscodeColor "textLink-foreground" "#0969da"

def shell : Props.Entry := style #[
  ("display", "grid"),
  ("gap", "12px"),
  ("minWidth", "0"),
  ("padding", "12px"),
  ("border", border borderColor),
  ("borderRadius", "8px"),
  ("background", background),
  ("color", fg),
  ("colorScheme", "light dark"),
  ("fontFamily", "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
]

def header : Props.Entry := style #[
  ("display", "flex"),
  ("alignItems", "baseline"),
  ("justifyContent", "space-between"),
  ("gap", "10px"),
  ("flexWrap", "wrap")
]

def heading : Props.Entry := style #[
  ("margin", "0"),
  ("fontSize", "1rem"),
  ("fontWeight", "780")
]

def summary : Props.Entry := style #[
  ("margin", "0"),
  ("color", muted),
  ("fontSize", "0.76rem"),
  ("fontWeight", "650")
]

def target : Props.Entry := style #[
  ("margin", "0"),
  ("padding", "10px"),
  ("overflow", "auto"),
  ("border", border borderColor),
  ("borderRadius", "6px"),
  ("background", codeBackground),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.78rem"),
  ("lineHeight", "1.35"),
  ("whiteSpace", "pre-wrap")
]

def sectionLabel : Props.Entry := style #[
  ("margin", "0"),
  ("color", muted),
  ("fontSize", "0.66rem"),
  ("fontWeight", "800"),
  ("textTransform", "uppercase")
]

def actions : Props.Entry := style #[
  ("display", "flex"),
  ("flexWrap", "wrap"),
  ("gap", "6px")
]

def action : Props.Entry := style #[
  ("minHeight", "29px"),
  ("padding", "0 9px"),
  ("border", border borderColor),
  ("borderRadius", "5px"),
  ("background", background),
  ("color", fg),
  ("font", "inherit"),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.72rem"),
  ("fontWeight", "720"),
  ("cursor", "pointer")
]

def utilityAction : Props.Entry := style #[
  ("minHeight", "28px"),
  ("padding", "0 8px"),
  ("border", border borderColor),
  ("borderRadius", "5px"),
  ("background", codeBackground),
  ("color", accent),
  ("font", "inherit"),
  ("fontSize", "0.7rem"),
  ("fontWeight", "750"),
  ("cursor", "pointer")
]

def contextList : Props.Entry := style #[
  ("display", "grid"),
  ("gap", "6px"),
  ("margin", "0"),
  ("padding", "0"),
  ("listStyle", "none")
]

def hypothesis : Props.Entry := style #[
  ("display", "grid"),
  ("gap", "7px"),
  ("padding", "8px 10px"),
  ("border", border borderColor),
  ("borderLeft", "3px solid " ++ accent),
  ("borderRadius", "6px")
]

def hypothesisType : Props.Entry := style #[
  ("minWidth", "0"),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.76rem"),
  ("lineHeight", "1.35"),
  ("overflowWrap", "anywhere")
]

def status : Props.Entry := style #[
  ("margin", "0"),
  ("color", muted),
  ("fontSize", "0.72rem"),
  ("fontWeight", "650"),
  ("overflowWrap", "anywhere")
]

def empty : Props.Entry := style #[
  ("margin", "0"),
  ("padding", "12px"),
  ("border", "1px dashed " ++ borderColor),
  ("color", muted),
  ("fontSize", "0.8rem")
]

end Style

structure StateHook where
  status : State (Lean.Vir.Js String)
  value : String

def useStatus : ReactM StateHook := do
  let initial ← JsValue.ofString "Choose an action to insert it at the editor cursor."
  let status ← StateTuple.toState (← Hooks.useState initial)
  let value ← JsValue.toString status.value
  pure { status, value }

def setStatus (state : StateHook) (value : String) : DomM Unit := do
  let next ← JsValue.ofString value
  State.set state.status next

def plural (count : Nat) (one many : String) : String :=
  if count == 1 then one else many

def goalName (goal : Goal) : String :=
  match goal.userName with
  | some userName => "case " ++ userName
  | none => goal.title

def hypothesisName? (hypothesis : Hypothesis) : Option String :=
  hypothesis.names[0]?

def hypothesisText (hypothesis : Hypothesis) : String :=
  let name := (hypothesisName? hypothesis).getD hypothesis.id
  let value := hypothesis.value.map (" := " ++ ·) |>.getD ""
  name ++ " : " ++ hypothesis.type ++ value

def contextText (surface : Surface) (goal : Goal) : String :=
  let hypotheses := goal.hypotheses.map hypothesisText |>.toList
  "\n".intercalate <| [
    "Cursor: " ++ surface.cursor.label,
    "Goal: " ++ goalName goal,
    "Target: " ++ goal.target,
    ""
  ] ++ hypotheses

def tacticButton
    (id label tactic : String)
    (runTactic : String → DomM Unit) : ReactM (Lean.Vir.Js Node) :=
  Node.buttonTextWith #[
    Props.id id,
    Props.type "button",
    Props.title ("Insert `" ++ tactic ++ "`"),
    Props.classList #["react-proof-tactic"],
    Style.action,
    Props.onClick (runTactic tactic)
  ] label

def utilityButton
    (id label : String)
    (onClick : DomM Unit) : ReactM (Lean.Vir.Js Node) :=
  Node.buttonTextWith #[
    Props.id id,
    Props.type "button",
    Props.classList #["react-proof-utility"],
    Style.utilityAction,
    Props.onClick onClick
  ] label

def commonActions (runTactic : String → DomM Unit) : ReactM (Lean.Vir.Js Node) := do
  let assumption ← tacticButton "react-proof-tactic-assumption" "assumption" "assumption" runTactic
  let rfl ← tacticButton "react-proof-tactic-rfl" "rfl" "rfl" runTactic
  let simp ← tacticButton "react-proof-tactic-simp" "simp" "simp" runTactic
  let constructor ← tacticButton "react-proof-tactic-constructor" "constructor" "constructor" runTactic
  Node.divWith #[Props.id "react-proof-common-actions", Style.actions] #[
    assumption,
    rfl,
    simp,
    constructor
  ]

def hypothesisActions
    (hypothesis : Hypothesis)
    (runTactic : String → DomM Unit) : ReactM (Lean.Vir.Js Node) := do
  match hypothesisName? hypothesis with
  | none => Node.spanText ""
  | some name =>
      let exact ← tacticButton ("react-proof-exact-" ++ hypothesis.id) ("exact " ++ name) ("exact " ++ name) runTactic
      let apply ← tacticButton ("react-proof-apply-" ++ hypothesis.id) ("apply " ++ name) ("apply " ++ name) runTactic
      let rewrite ← tacticButton ("react-proof-rw-" ++ hypothesis.id) ("rw [" ++ name ++ "]") ("rw [" ++ name ++ "]") runTactic
      let simp ← tacticButton ("react-proof-simp-" ++ hypothesis.id) ("simp [" ++ name ++ "]") ("simp [" ++ name ++ "]") runTactic
      Node.divWith #[Props.classList #["react-proof-hypothesis-actions"], Style.actions] #[
        exact,
        apply,
        rewrite,
        simp
      ]

def hypothesisView
    (hypothesis : Hypothesis)
    (runTactic : String → DomM Unit) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.codeText #[Props.classList #["react-proof-hypothesis-type"], Style.hypothesisType]
    (hypothesisText hypothesis)
  let actions ← hypothesisActions hypothesis runTactic
  Node.keyedLiWith hypothesis.id
    #[Props.classList #["react-proof-hypothesis"], Props.role "listitem", Style.hypothesis]
    #[text, actions]

def hypothesesView
    (goal : Goal)
    (runTactic : String → DomM Unit) : ReactM (Lean.Vir.Js Node) := do
  if goal.hypotheses.isEmpty then
    Node.pTextWith #[Props.id "react-proof-hypotheses", Style.empty] "No local hypotheses."
  else
    let hypotheses ← goal.hypotheses.mapM (hypothesisView · runTactic)
    Node.ulWith #[
      Props.id "react-proof-hypotheses",
      Props.role "list",
      Props.ariaLabel "Local hypotheses and proof actions",
      Style.contextList
    ] hypotheses

structure ViewProps where
  surface : Surface
  goal : Goal
  state : String
  runTactic : String → DomM Unit
  copyContext : DomM Unit
  revealCursor : DomM Unit

def View : RuntimeM (Js (Component ViewProps)) := Component.ofLean fun props => do
  let title ← Node.h3TextWith #[Props.id "react-proof-selected-title", Style.heading] "Proof actions"
  let summary ← Node.pTextWith #[Props.id "react-proof-summary", Style.summary]
    (goalName props.goal ++ " · " ++ s!"{props.goal.hypotheses.size} " ++
      plural props.goal.hypotheses.size "hypothesis" "hypotheses" ++ " · " ++ props.surface.cursor.label)
  let header ← Node.headerWith #[Style.header] #[title, summary]
  let targetLabel ← Node.pTextWith #[Style.sectionLabel] "Current target"
  let targetText ← Node.text props.goal.target
  let target ← Node.preWith #[Props.id "react-proof-target-code", Style.target] #[targetText]
  let actionsLabel ← Node.pTextWith #[Style.sectionLabel] "Insert tactic"
  let common ← commonActions props.runTactic
  let contextLabel ← Node.pTextWith #[Style.sectionLabel] "Use a hypothesis"
  let hypotheses ← hypothesesView props.goal props.runTactic
  let copy ← utilityButton "react-proof-copy-context" "Copy context" props.copyContext
  let reveal ← utilityButton "react-proof-reveal-cursor" "Reveal cursor" props.revealCursor
  let utilities ← Node.divWith #[Style.actions] #[copy, reveal]
  let status ← Node.pTextWith #[
    Props.id "react-proof-action-status",
    Props.ariaLive "polite",
    Style.status
  ] props.state
  Node.sectionWith #[
    Props.id "react-proof-widget",
    Props.role "region",
    Props.ariaLabel "Lean proof actions",
    Style.shell
  ] #[
    header,
    targetLabel,
    target,
    actionsLabel,
    common,
    contextLabel,
    hypotheses,
    utilities,
    status
  ]

def EmptyView : RuntimeM (Js (Component Surface)) := Component.ofLean fun surface => do
  let title ← Node.h3TextWith #[Style.heading] "Proof actions"
  let empty ← Node.pTextWith #[Style.empty]
    ("Move the cursor into a tactic proof to get actions at " ++ surface.cursor.label ++ ".")
  Node.sectionWith #[
    Props.id "react-proof-widget",
    Props.role "region",
    Props.ariaLabel "Lean proof actions",
    Style.shell
  ] #[title, empty]

def App : RuntimeM (Js (Component Surface)) := do
  let view ← View
  let emptyView ← EmptyView
  Component.ofLean fun surface => do
    let state ← useStatus
    match surface.goals[0]? with
    | none => Node.component emptyView surface
    | some goal =>
      let runTactic (tactic : String) : DomM Unit := do
        let inserted ← Lean.Vir.Infoview.Command.insertAtCursor surface (tactic ++ "\n")
        if inserted then
          setStatus state ("Inserted `" ++ tactic ++ "` at " ++ surface.cursor.label)
        else
          let copied ← Lean.Vir.Infoview.Clipboard.writeText tactic
          setStatus state <| if copied then
            "Editor unavailable; copied `" ++ tactic ++ "`"
          else
            "Editor and clipboard unavailable"
      let copyContext : DomM Unit := do
        let copied ← Lean.Vir.Infoview.Clipboard.writeText (contextText surface goal)
        setStatus state <| if copied then "Context copied" else "Clipboard unavailable"
      let revealCursor : DomM Unit := do
        let revealed ← Lean.Vir.Infoview.Command.revealCursor surface
        setStatus state <| if revealed then "Cursor revealed" else "Editor unavailable"
      Node.component view {
        surface,
        goal,
        state := state.value,
        runTactic,
        copyContext,
        revealCursor
      }

vir_proof_widget App with mountId := "vir-react-proof-widget"

/--
Standalone dev-runner entry for exercising surface snapshots without passing a
JavaScript component handle through the runner's text fields. Each call creates
a fresh component type; the live infoview instead uses `createComponent` once
and passes that exact value to `mount` on every update.
-/
def renderSnapshotIntoSelector (selector : String) (surface : Surface) : DomM Bool := do
  Root.renderComponentIntoSelector selector (← App) surface

end ReactProofWidget

/-!
`ReactProofWidget` is a small proof-action tool, not a second goal viewer. It
uses the current infoview goal to build tactic buttons and inserts the selected
text at the editor cursor through `workspace/applyEdit`. When mounted outside
an editor it falls back to the clipboard.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidget.widgetProps]

section Playground

theorem proofWidget_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left

end Playground
