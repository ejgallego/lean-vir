/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.Examples.Style
public import Vir.ProofWidgets

public section

namespace VirNativeInfoview

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.Infoview
open Lean.Vir.ProofWidgets

namespace Style

abbrev style := Lean.Vir.Examples.Style.style
abbrev vscodeColor := Lean.Vir.Examples.Style.vscodeColor
abbrev border := Lean.Vir.Examples.Style.border

def foreground : String := vscodeColor "editor-foreground" "#24292f"
def muted : String := vscodeColor "descriptionForeground" "#57606a"
def background : String := vscodeColor "editor-background" "#ffffff"
def codeBackground : String := vscodeColor "textCodeBlock-background" "#f6f8fa"
def borderColor : String := vscodeColor "panel-border" "#d0d7de"
def accent : String := vscodeColor "textLink-foreground" "#0969da"
def goalAccent : String := vscodeColor "symbolIcon-keywordForeground" "#8250df"

def shell : PropEntry := style #[
  ("display", "grid"),
  ("gap", "10px"),
  ("minWidth", "0"),
  ("padding", "8px 10px 12px"),
  ("background", background),
  ("color", foreground),
  ("colorScheme", "light dark"),
  ("fontFamily", "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
]

def toolbar : PropEntry := style #[
  ("display", "flex"),
  ("alignItems", "baseline"),
  ("justifyContent", "space-between"),
  ("gap", "8px"),
  ("flexWrap", "wrap"),
  ("paddingBottom", "7px"),
  ("borderBottom", border borderColor)
]

def title : PropEntry := style #[
  ("margin", "0"),
  ("fontSize", "0.82rem"),
  ("fontWeight", "760")
]

def summary : PropEntry := style #[
  ("margin", "0"),
  ("color", muted),
  ("fontSize", "0.68rem"),
  ("fontWeight", "620")
]

def goalList : PropEntry := style #[
  ("display", "grid"),
  ("gap", "10px")
]

def goalCard : PropEntry := style #[
  ("display", "grid"),
  ("gap", "8px"),
  ("minWidth", "0"),
  ("padding", "9px"),
  ("border", border borderColor),
  ("borderLeft", "3px solid " ++ goalAccent),
  ("borderRadius", "5px"),
  ("background", background)
]

def goalHeader : PropEntry := style #[
  ("display", "flex"),
  ("alignItems", "center"),
  ("justifyContent", "space-between"),
  ("gap", "8px")
]

def goalHeading : PropEntry := style #[
  ("margin", "0"),
  ("minWidth", "0"),
  ("fontSize", "0.76rem"),
  ("fontWeight", "760"),
  ("overflowWrap", "anywhere")
]

def collapseButton : PropEntry := style #[
  ("flex", "0 0 auto"),
  ("minWidth", "25px"),
  ("height", "24px"),
  ("padding", "0 6px"),
  ("border", border borderColor),
  ("borderRadius", "4px"),
  ("background", codeBackground),
  ("color", foreground),
  ("font", "inherit"),
  ("fontSize", "0.7rem"),
  ("cursor", "pointer")
]

def context : PropEntry := style #[
  ("display", "grid"),
  ("gap", "4px"),
  ("margin", "0"),
  ("padding", "0"),
  ("listStyle", "none")
]

def hypothesis : PropEntry := style #[
  ("display", "flex"),
  ("alignItems", "baseline"),
  ("gap", "5px"),
  ("minWidth", "0"),
  ("padding", "2px 4px"),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.73rem"),
  ("lineHeight", "1.4")
]

def binder : PropEntry := style #[
  ("flex", "0 0 auto"),
  ("color", accent),
  ("fontWeight", "700")
]

def hypothesisType : PropEntry := style #[
  ("minWidth", "0"),
  ("overflowWrap", "anywhere")
]

def value : PropEntry := style #[
  ("minWidth", "0"),
  ("color", muted),
  ("overflowWrap", "anywhere")
]

def target : PropEntry := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "auto minmax(0, 1fr)"),
  ("alignItems", "baseline"),
  ("gap", "7px"),
  ("padding", "7px 8px"),
  ("borderRadius", "4px"),
  ("background", codeBackground),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.75rem"),
  ("lineHeight", "1.42")
]

def turnstile : PropEntry := style #[
  ("color", goalAccent),
  ("fontWeight", "800")
]

def targetCode : PropEntry := style #[
  ("minWidth", "0"),
  ("overflowWrap", "anywhere"),
  ("whiteSpace", "pre-wrap")
]

def empty : PropEntry := style #[
  ("margin", "0"),
  ("padding", "12px"),
  ("border", "1px dashed " ++ borderColor),
  ("borderRadius", "5px"),
  ("color", muted),
  ("fontSize", "0.76rem")
]

end Style

def plural (count : Nat) (one many : String) : String :=
  if count == 1 then one else many

/-- Plain text is intentional in this compact demonstration; tags stay native until this call. -/
def plainCode (code : Js CodeWithInfos) : ReactM String := do
  JsValue.toString (← CodeWithInfos.stripTags code)

structure HypothesisProps where
  hypothesis : Js InteractiveHypothesisBundle
  goalIndex : Nat
  index : Nat

def hypothesisNames (hypothesis : Js InteractiveHypothesisBundle) (fallback : String) : ReactM String := do
  let names ← Js.Array.toLeanArray (← InteractiveHypothesisBundle.names hypothesis)
  let names ← names.mapM fun name => do JsValue.toString name
  pure <| if names.isEmpty then fallback else " ".intercalate names.toList

def HypothesisRow : RuntimeM (Lean.Vir.ProofWidgets.Component HypothesisProps) :=
  Lean.Vir.ProofWidgets.Component.ofLean fun ctx => do
    let props := ctx.props
    let hypothesis := props.hypothesis
    let id := s!"{props.goalIndex}-{props.index}"
    let names ← hypothesisNames hypothesis s!"hypothesis {props.index + 1}"
    let hypothesisType ← plainCode (← InteractiveHypothesisBundle.type hypothesis)
    let value? ← Js.UndefinedOr.toOption (← InteractiveHypothesisBundle.val hypothesis)
    let value ← value?.mapM plainCode
    let valueNodes : Array Html := (value.map fun text => #[
      Html.elementWithProps "span" #[
        Lean.Vir.React.Props.className "vir-native-infoview-hyp-value", Style.value
      ] #[Html.text (" := " ++ text)]
    ]).getD #[]
    Html.elementWithProps "li" #[
      Lean.Vir.React.Props.id ("vir-native-infoview-hyp-" ++ id),
      Lean.Vir.React.Props.className "vir-native-infoview-hypothesis",
      Lean.Vir.React.Props.role "listitem", Style.hypothesis
    ] (#[
      Html.elementWithProps "span" #[
        Lean.Vir.React.Props.className "vir-native-infoview-hyp-name", Style.binder
      ] #[Html.text names],
      Html.elementWithProps "span" #[Lean.Vir.React.Props.ariaHidden true] #[Html.text ":"],
      Html.elementWithProps "code" #[
        Lean.Vir.React.Props.className "vir-native-infoview-hyp-type", Style.hypothesisType
      ] #[Html.text hypothesisType]
    ] ++ valueNodes)

structure TacticGoalCardProps where
  goal : Js InteractiveGoal
  index : Nat
  key : String

structure TermGoalCardProps where
  goal : Js InteractiveTermGoal
  index : Nat

def tacticGoalName (goal : Js InteractiveGoal) (index : Nat) : ReactM String := do
  let userName? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
  match userName? with
  | none => pure s!"goal {index + 1}"
  | some userName => pure ("case " ++ (← JsValue.toString userName))

def tacticGoalKey (goal : Js InteractiveGoal) (index : Nat) : ReactM String := do
  let mvarId? ← Js.UndefinedOr.toOption (← InteractiveGoal.mvarId goal)
  match mvarId? with
  | some mvarId => JsValue.toString mvarId
  | none =>
    let userName? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
    match userName? with
    | some userName => JsValue.toString userName
    | none => pure s!"goal-{index}"

def optionalFlag (flag : Js.UndefinedOr Bool) : ReactM Bool := do
  match ← Js.UndefinedOr.toOption flag with
  | none => pure false
  | some flag => JsValue.toBool flag

def tacticGoalStatus (goal : Js InteractiveGoal) : ReactM String := do
  if ← optionalFlag (← InteractiveGoal.isRemoved goal) then
    pure "removed"
  else if ← optionalFlag (← InteractiveGoal.isInserted goal) then
    pure "inserted"
  else
    pure "active"

def positionLabel (position : Js PanelPosition) : ReactM String := do
  let uri ← JsValue.toString (← PanelPosition.uri position)
  let line ← JsValue.toFloat (← PanelPosition.line position)
  let character ← JsValue.toFloat (← PanelPosition.character position)
  pure s!"{uri}:{line.toUInt64.toNat + 1}:{character.toUInt64.toNat + 1}"

def GoalCardBody
    (goalId goalKey title status : String)
    (index : Nat)
    (hypotheses : Array (Js InteractiveHypothesisBundle))
    (target : Js CodeWithInfos)
    (hypothesisRow : Lean.Vir.ProofWidgets.Component HypothesisProps) : ReactM (Js Lean.Vir.React.Node) := do
  let initialCollapsed ← JsValue.ofBool false
  let collapsedState ← Lean.Vir.React.StateTuple.toState
    (← Lean.Vir.React.Hooks.useState initialCollapsed)
  let collapsed ← JsValue.toBool collapsedState.value
  let detailsId := s!"vir-native-infoview-goal-{goalId}-details"
  let toggle : DomM Unit := do
    let next ← JsValue.ofBool (!collapsed)
    Lean.Vir.React.State.set collapsedState next
  let hypotheses : Array Html := hypotheses.mapIdx fun hypothesisIndex hypothesis =>
    Html.keyedOfComponent s!"{goalId}-{hypothesisIndex}" hypothesisRow {
      hypothesis, goalIndex := index, index := hypothesisIndex }
  let context : Html := if hypotheses.isEmpty then
    Html.elementWithProps "p" #[
      Lean.Vir.React.Props.className "vir-native-infoview-no-hypotheses", Style.empty
    ] #[Html.text "No local hypotheses."]
  else
    Html.elementWithProps "ul" #[
      Lean.Vir.React.Props.id detailsId,
      Lean.Vir.React.Props.className "vir-native-infoview-context",
      Lean.Vir.React.Props.role "list", Lean.Vir.React.Props.ariaLabel "Local hypotheses", Style.context
    ] hypotheses
  let targetText ← plainCode target
  let target : Html := Html.elementWithProps "div" #[
      Lean.Vir.React.Props.className "vir-native-infoview-target", Style.target
    ] #[
      Html.elementWithProps "span" #[
        Lean.Vir.React.Props.className "vir-native-infoview-turnstile",
        Lean.Vir.React.Props.ariaHidden true, Style.turnstile
      ] #[Html.text "⊢"],
      Html.elementWithProps "code" #[
        Lean.Vir.React.Props.id s!"vir-native-infoview-goal-{goalId}-target",
        Lean.Vir.React.Props.className "vir-native-infoview-target-code", Style.targetCode
      ] #[Html.text targetText]
    ]
  let details : Array Html := if collapsed then #[] else #[context, target]
  let heading : Html := Html.elementWithProps "h3" #[
      Lean.Vir.React.Props.className "vir-native-infoview-goal-heading", Style.goalHeading
    ] #[Html.text title]
  let collapseButton : Html := Html.elementWithProps "button" #[
      Lean.Vir.React.Props.id s!"vir-native-infoview-goal-{goalId}-collapse",
      Lean.Vir.React.Props.className "vir-native-infoview-collapse",
      Lean.Vir.React.Props.type "button",
      Lean.Vir.React.Props.title (if collapsed then "Expand goal" else "Collapse goal"),
      Lean.Vir.React.Props.ariaLabel (if collapsed then "Expand goal" else "Collapse goal"),
      Lean.Vir.React.Props.ariaExpanded (!collapsed), Lean.Vir.React.Props.ariaControls detailsId,
      Lean.Vir.React.Props.onClick toggle, Style.collapseButton
    ] #[Html.text (if collapsed then "+" else "−")]
  let header : Html := Html.elementWithProps "header" #[
      Lean.Vir.React.Props.className "vir-native-infoview-goal-header", Style.goalHeader
    ] #[heading, collapseButton]
  Html.elementWithProps "article" #[
    Lean.Vir.React.Props.id s!"vir-native-infoview-goal-{goalId}",
    Lean.Vir.React.Props.className "vir-native-infoview-goal",
    Lean.Vir.React.Props.data "goal-id" goalId,
    Lean.Vir.React.Props.data "goal-key" goalKey,
    Lean.Vir.React.Props.data "goal-status" status,
    Style.goalCard
  ] (#[header] ++ details)

def TacticGoalCard : RuntimeM (Lean.Vir.ProofWidgets.Component TacticGoalCardProps) := do
  let hypothesisRow ← HypothesisRow
  Lean.Vir.ProofWidgets.Component.ofLean fun ctx => do
    let props := ctx.props
    let title ← tacticGoalName props.goal props.index
    let status ← tacticGoalStatus props.goal
    let hypotheses ← Js.Array.toLeanArray (← InteractiveGoal.hyps props.goal)
    let target ← InteractiveGoal.type props.goal
    GoalCardBody s!"goal-{props.index}" props.key title status props.index hypotheses target hypothesisRow

def TermGoalCard : RuntimeM (Lean.Vir.ProofWidgets.Component TermGoalCardProps) := do
  let hypothesisRow ← HypothesisRow
  Lean.Vir.ProofWidgets.Component.ofLean fun ctx => do
    let props := ctx.props
    let hypotheses ← Js.Array.toLeanArray (← InteractiveTermGoal.hyps props.goal)
    let target ← InteractiveTermGoal.type props.goal
    GoalCardBody s!"term-{props.index}" "term" "Term goal" "term" props.index hypotheses target hypothesisRow

def View : RuntimeM (Lean.Vir.React.FunctionComponent PanelWidgetProps) := do
  let tacticGoalCard ← TacticGoalCard
  let termGoalCard ← TermGoalCard
  Lean.Vir.React.FunctionComponent.ofLean fun props => do
    let position ← PanelWidgetProps.pos props
    let captionPosition ← positionLabel position
    let tacticGoals ← Js.Array.toLeanArray (← PanelWidgetProps.goals props)
    let termGoal? ← Js.UndefinedOr.toOption (← PanelWidgetProps.termGoal props)
    let tacticNodes ← tacticGoals.mapIdxM fun index goal => do
      let key ← tacticGoalKey goal index
      pure <| Html.keyedOfComponent key tacticGoalCard { goal, index, key }
    let termNodes : Array Html := (termGoal?.map fun goal => #[
      Html.keyedOfComponent s!"term-{tacticGoals.size}" termGoalCard { goal, index := tacticGoals.size }
    ]).getD #[]
    let goals := tacticNodes ++ termNodes
    let goalCount := goals.size
    let body : Html := if goals.isEmpty then
      Html.elementWithProps "p" #[
        Lean.Vir.React.Props.id "vir-native-infoview-empty",
        Lean.Vir.React.Props.className "vir-native-infoview-empty", Style.empty
      ] #[Html.text ("No goals at " ++ captionPosition ++ ".")]
    else
      Html.elementWithProps "div" #[
        Lean.Vir.React.Props.id "vir-native-infoview-goals",
        Lean.Vir.React.Props.className "vir-native-infoview-goals", Style.goalList
      ] goals
    let heading : Html := Html.elementWithProps "h2" #[
        Lean.Vir.React.Props.className "vir-native-infoview-title", Style.title
      ] #[Html.text "Goals"]
    let summary : Html := Html.elementWithProps "p" #[
        Lean.Vir.React.Props.id "vir-native-infoview-summary",
        Lean.Vir.React.Props.className "vir-native-infoview-summary", Style.summary
      ] #[Html.text <| s!"{goalCount} " ++ plural goalCount "goal" "goals" ++ " · " ++ captionPosition]
    let toolbar : Html := Html.elementWithProps "header" #[
        Lean.Vir.React.Props.className "vir-native-infoview-toolbar", Style.toolbar
      ] #[heading, summary]
    Html.elementWithProps "section" #[
      Lean.Vir.React.Props.id "vir-native-infoview",
      Lean.Vir.React.Props.className "vir-native-infoview",
      Lean.Vir.React.Props.role "region", Lean.Vir.React.Props.ariaLabel "VIR native Lean goals", Style.shell
    ] #[toolbar, body]

vir_proof_widget View

end VirNativeInfoview

/-!
This is a VIR-native React implementation of the goal and local-context part
of Lean's infoview. It receives the real panel props, keeps the upstream goal,
hypothesis, and tagged-code objects as JavaScript values, and converts tagged
code to text only at the explicit display boundary.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with VirNativeInfoview.widgetProps]

section Playground

theorem virNativeInfoview_and_comm (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq

end Playground
