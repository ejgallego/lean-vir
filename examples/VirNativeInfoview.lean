/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview
import Vir.Examples.Style
import Vir.ProofWidgets

namespace VirNativeInfoview

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.Infoview (Goal Hypothesis Surface)
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

def goalName (goal : Goal) : String :=
  match goal.userName with
  | some userName => "case " ++ userName
  | none => if goal.title.isEmpty then s!"goal {goal.index + 1}" else goal.title

def hypothesisNames (hypothesis : Hypothesis) : String :=
  if hypothesis.names.isEmpty then
    hypothesis.id
  else
    " ".intercalate hypothesis.names.toList

def HypothesisRow : RuntimeM (Lean.Vir.ProofWidgets.Component Hypothesis) :=
  Lean.Vir.React.Component.ofLean fun (ctx : ComponentProps Hypothesis) =>
  let hypothesis := ctx.props
  let value : Array Html :=
    match hypothesis.value with
    | none => #[]
    | some value => #[
        Html.elementWithProps "span" #[
          Lean.Vir.React.Props.className "vir-native-infoview-hyp-value",
          Style.value
        ] #[Html.text (" := " ++ value)]
      ]
  Html.elementWithProps "li" #[
    Lean.Vir.React.Props.id ("vir-native-infoview-hyp-" ++ hypothesis.id),
    Lean.Vir.React.Props.className "vir-native-infoview-hypothesis",
    Lean.Vir.React.Props.role "listitem",
    Style.hypothesis
  ] (#[
    Html.elementWithProps "span" #[
      Lean.Vir.React.Props.className "vir-native-infoview-hyp-name",
      Style.binder
    ] #[Html.text (hypothesisNames hypothesis)],
    Html.elementWithProps "span" #[Lean.Vir.React.Props.ariaHidden true] #[Html.text ":"],
    Html.elementWithProps "code" #[
      Lean.Vir.React.Props.className "vir-native-infoview-hyp-type",
      Style.hypothesisType
    ] #[Html.text hypothesis.type]
  ] ++ value)

def GoalCard : RuntimeM (Lean.Vir.ProofWidgets.Component Goal) := do
  let hypothesisRow ← HypothesisRow
  Lean.Vir.React.Component.ofLean fun (ctx : ComponentProps Goal) => do
    let goal := ctx.props
    let initialCollapsed ← JsValue.ofBool false
    let collapsedState ← Lean.Vir.React.StateTuple.toState
      (← Lean.Vir.React.Hooks.useState initialCollapsed)
    let collapsed ← JsValue.toBool collapsedState.value
    let detailsId := s!"vir-native-infoview-goal-{goal.index}-details"
    let toggle : DomM Unit := do
      let next ← JsValue.ofBool (!collapsed)
      Lean.Vir.React.State.set collapsedState next
    let hypotheses : Array Html := goal.hypotheses.map fun hypothesis =>
      Html.keyedOfComponent hypothesis.id hypothesisRow hypothesis
    let context : Html :=
      if hypotheses.isEmpty then
        Html.elementWithProps "p" #[
          Lean.Vir.React.Props.className "vir-native-infoview-no-hypotheses",
          Style.empty
        ] #[Html.text "No local hypotheses."]
      else
        Html.elementWithProps "ul" #[
          Lean.Vir.React.Props.id detailsId,
          Lean.Vir.React.Props.className "vir-native-infoview-context",
          Lean.Vir.React.Props.role "list",
          Lean.Vir.React.Props.ariaLabel "Local hypotheses",
          Style.context
        ] hypotheses
    let target : Html := Html.elementWithProps "div" #[
        Lean.Vir.React.Props.className "vir-native-infoview-target",
        Style.target
      ] #[
        Html.elementWithProps "span" #[
          Lean.Vir.React.Props.className "vir-native-infoview-turnstile",
          Lean.Vir.React.Props.ariaHidden true,
          Style.turnstile
        ] #[Html.text "⊢"],
        Html.elementWithProps "code" #[
          Lean.Vir.React.Props.id s!"vir-native-infoview-goal-{goal.index}-target",
          Lean.Vir.React.Props.className "vir-native-infoview-target-code",
          Style.targetCode
        ] #[Html.text goal.target]
      ]
    let details : Array Html := if collapsed then #[] else #[
      context,
      target
    ]
    let heading : Html := Html.elementWithProps "h3" #[
        Lean.Vir.React.Props.className "vir-native-infoview-goal-heading",
        Style.goalHeading
      ] #[Html.text (goalName goal ++ " · " ++ goal.status)]
    let collapseButton : Html := Html.elementWithProps "button" #[
        Lean.Vir.React.Props.id s!"vir-native-infoview-goal-{goal.index}-collapse",
        Lean.Vir.React.Props.className "vir-native-infoview-collapse",
        Lean.Vir.React.Props.type "button",
        Lean.Vir.React.Props.title (if collapsed then "Expand goal" else "Collapse goal"),
        Lean.Vir.React.Props.ariaLabel (if collapsed then "Expand goal" else "Collapse goal"),
        Lean.Vir.React.Props.ariaExpanded (!collapsed),
        Lean.Vir.React.Props.ariaControls detailsId,
        Lean.Vir.React.Props.onClick toggle,
        Style.collapseButton
      ] #[Html.text (if collapsed then "+" else "−")]
    let header : Html := Html.elementWithProps "header" #[
        Lean.Vir.React.Props.className "vir-native-infoview-goal-header",
        Style.goalHeader
      ] #[heading, collapseButton]
    Html.elementWithProps "article" #[
      Lean.Vir.React.Props.id s!"vir-native-infoview-goal-{goal.index}",
      Lean.Vir.React.Props.className "vir-native-infoview-goal",
      Lean.Vir.React.Props.data "goal-id" goal.id,
      Lean.Vir.React.Props.data "goal-status" goal.status,
      Style.goalCard
    ] (#[header] ++ details)

def View : RuntimeM (Lean.Vir.ProofWidgets.Component Surface) := do
  let goalCard ← GoalCard
  Lean.Vir.React.Component.ofLean fun (ctx : ComponentProps Surface) =>
    let surface := ctx.props
    let goalCount := surface.goals.size
    let goals : Array Html := surface.goals.map fun goal =>
      Html.keyedOfComponent goal.id goalCard goal
    let body : Html := if goals.isEmpty then
      Html.elementWithProps "p" #[
        Lean.Vir.React.Props.id "vir-native-infoview-empty",
        Lean.Vir.React.Props.className "vir-native-infoview-empty",
        Style.empty
      ] #[Html.text ("No goals at " ++ surface.cursor.label ++ ".")]
    else
      Html.elementWithProps "div" #[
        Lean.Vir.React.Props.id "vir-native-infoview-goals",
        Lean.Vir.React.Props.className "vir-native-infoview-goals",
        Style.goalList
      ] goals
    let heading : Html := Html.elementWithProps "h2" #[
        Lean.Vir.React.Props.className "vir-native-infoview-title",
        Style.title
      ] #[Html.text "Goals"]
    let summary : Html := Html.elementWithProps "p" #[
        Lean.Vir.React.Props.id "vir-native-infoview-summary",
        Lean.Vir.React.Props.className "vir-native-infoview-summary",
        Style.summary
      ] #[Html.text <| s!"{goalCount} " ++ plural goalCount "goal" "goals" ++
        " · " ++ surface.cursor.label]
    let toolbar : Html := Html.elementWithProps "header" #[
        Lean.Vir.React.Props.className "vir-native-infoview-toolbar",
        Style.toolbar
      ] #[heading, summary]
    Html.elementWithProps "section" #[
      Lean.Vir.React.Props.id "vir-native-infoview",
      Lean.Vir.React.Props.className "vir-native-infoview",
      Lean.Vir.React.Props.role "region",
      Lean.Vir.React.Props.ariaLabel "VIR native Lean goals",
      Style.shell
    ] #[toolbar, body]

/-- Root component factory consumed by the live VIR infoview shell. -/
def App : RuntimeM (Js (Lean.Vir.React.Component Surface)) := do
  let view ← View
  Lean.Vir.React.Component.ofLean fun surface =>
    Lean.Vir.React.Node.component view (componentProps surface)

vir_proof_widget App with mountId := "vir-native-infoview-widget"

end VirNativeInfoview

/-!
This is a VIR-native React implementation of the goal and local-context part
of Lean's infoview. It intentionally consumes only the stable `Surface` value
delivered by the VIR widget shell; every goal and hypothesis is rendered by
Lean-authored components running from the live `.irpkg` package.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with VirNativeInfoview.widgetProps]

section Playground

theorem virNativeInfoview_and_comm (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq

end Playground
