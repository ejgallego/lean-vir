/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview
import Vir.Examples.Style
import Vir.ProofWidgets.Rpc
import Vir.React

namespace ReactProofWidget

open Lean.Vir
open Lean.Vir.React
open Lean.Vir.Browser (DomM)
open Lean.Vir.Infoview (Hypothesis Goal SelectedLocation Surface)

-- Keep this example independent from any future ProofWidgets compatibility DSL.
namespace UiStyle

abbrev style := Lean.Vir.Examples.Style.style
abbrev vscodeColor := Lean.Vir.Examples.Style.vscodeColor
abbrev border := Lean.Vir.Examples.Style.border

def fg : String := vscodeColor "editor-foreground" "#24292f"
def mutedFg : String := vscodeColor "descriptionForeground" "#57606a"
def subtleFg : String := vscodeColor "editorLineNumber-foreground" "#6e7781"
def panelBg : String := vscodeColor "editorWidget-background" "#ffffff"
def editorBg : String := vscodeColor "editor-background" "#ffffff"
def codeBg : String := vscodeColor "textCodeBlock-background" "#f6f8fa"
def borderColor : String := vscodeColor "editorWidget-border" "#d0d7de"
def focusColor : String := vscodeColor "focusBorder" "#0969da"
def activeBg : String := vscodeColor "list-activeSelectionBackground" "#ddf4ff"
def activeFg : String := vscodeColor "list-activeSelectionForeground" "#0a3069"
def badgeBg : String := vscodeColor "badge-background" "#eaeef2"
def badgeFg : String := vscodeColor "badge-foreground" "#24292f"
def hoverBg : String := vscodeColor "list-hoverBackground" "#f6f8fa"
def linkFg : String := vscodeColor "textLink-foreground" "#0969da"
def blueFg : String := vscodeColor "charts-blue" "#0969da"
def greenFg : String := vscodeColor "charts-green" "#1a7f37"
def purpleFg : String := vscodeColor "charts-purple" "#8250df"
def orangeFg : String := vscodeColor "charts-orange" "#bc4c00"

def widgetStyle : Property := style #[
  ("display", "grid"),
  ("gap", "12px"),
  ("minWidth", "0"),
  ("padding", "14px"),
  ("border", border borderColor),
  ("borderRadius", "8px"),
  ("background", panelBg),
  ("color", fg),
  ("colorScheme", "light dark"),
  ("fontFamily", "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
]

def headerStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(auto-fit, minmax(min(100%, 210px), 1fr))"),
  ("alignItems", "start"),
  ("gap", "14px"),
  ("minWidth", "0")
]

def headingStyle : Property := style #[
  ("margin", "0"),
  ("color", fg),
  ("fontSize", "1.05rem"),
  ("fontWeight", "780"),
  ("lineHeight", "1.25")
]

def eyebrowStyle : Property := style #[
  ("margin", "0 0 3px"),
  ("color", subtleFg),
  ("fontSize", "0.68rem"),
  ("fontWeight", "800"),
  ("letterSpacing", "0"),
  ("textTransform", "uppercase")
]

def sourceStyle : Property := style #[
  ("display", "flex"),
  ("flexWrap", "wrap"),
  ("gap", "6px"),
  ("margin", "6px 0 0"),
  ("color", mutedFg),
  ("fontSize", "0.78rem"),
  ("fontWeight", "700")
]

def summaryStyle : Property := style #[
  ("margin", "0"),
  ("color", mutedFg),
  ("fontSize", "0.82rem"),
  ("fontWeight", "650"),
  ("lineHeight", "1.35"),
  ("overflowWrap", "anywhere")
]

def badgeStyle : Property := style #[
  ("display", "inline-flex"),
  ("alignItems", "center"),
  ("minHeight", "20px"),
  ("padding", "1px 7px"),
  ("border", border borderColor),
  ("borderRadius", "4px"),
  ("background", badgeBg),
  ("color", badgeFg),
  ("fontSize", "0.72rem"),
  ("fontWeight", "720"),
  ("whiteSpace", "nowrap")
]

def apiStripStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(auto-fit, minmax(126px, 1fr))"),
  ("gap", "6px"),
  ("minWidth", "0")
]

def apiChipStyle (accent : String) : Property := style #[
  ("display", "grid"),
  ("gap", "2px"),
  ("minWidth", "0"),
  ("minHeight", "48px"),
  ("padding", "7px 9px"),
  ("border", border borderColor),
  ("borderLeft", "3px solid " ++ accent),
  ("borderRadius", "6px"),
  ("background", editorBg),
  ("color", fg)
]

def apiNameStyle : Property := style #[
  ("color", subtleFg),
  ("fontSize", "0.66rem"),
  ("fontWeight", "800"),
  ("lineHeight", "1.1"),
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap")
]

def apiValueStyle : Property := style #[
  ("color", fg),
  ("fontSize", "0.8rem"),
  ("fontWeight", "740"),
  ("lineHeight", "1.15"),
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap")
]

def metricGridStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(auto-fit, minmax(92px, 1fr))"),
  ("gap", "1px"),
  ("overflow", "hidden"),
  ("border", border borderColor),
  ("borderRadius", "8px"),
  ("background", borderColor)
]

def metricStyle : Property := style #[
  ("minWidth", "0"),
  ("padding", "8px 10px"),
  ("background", editorBg)
]

def metricLabelStyle : Property := style #[
  ("display", "block"),
  ("color", subtleFg),
  ("fontSize", "0.66rem"),
  ("fontWeight", "800"),
  ("lineHeight", "1.1"),
  ("textTransform", "uppercase")
]

def metricValueStyle : Property := style #[
  ("display", "block"),
  ("marginTop", "3px"),
  ("color", fg),
  ("fontSize", "0.82rem"),
  ("fontWeight", "720"),
  ("lineHeight", "1.2"),
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap")
]

def layoutStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(auto-fit, minmax(min(100%, 220px), 1fr))"),
  ("gap", "12px"),
  ("minWidth", "0")
]

def sidebarStyle : Property := style #[
  ("display", "grid"),
  ("alignContent", "start"),
  ("gap", "8px"),
  ("minWidth", "0")
]

def mainStyle : Property := style #[
  ("display", "grid"),
  ("gap", "12px"),
  ("minWidth", "0")
]

def panelLabelStyle : Property := style #[
  ("margin", "0"),
  ("color", subtleFg),
  ("fontSize", "0.68rem"),
  ("fontWeight", "800"),
  ("textTransform", "uppercase")
]

def listStyle : Property := style #[
  ("display", "grid"),
  ("gap", "8px"),
  ("margin", "0"),
  ("padding", "0"),
  ("listStyle", "none")
]

def goalListStyle : Property := style #[
  ("display", "grid"),
  ("gap", "8px"),
  ("maxHeight", "280px"),
  ("overflow", "auto"),
  ("margin", "0"),
  ("padding", "0 2px 0 0"),
  ("listStyle", "none")
]

def hypothesesListStyle : Property := style #[
  ("display", "grid"),
  ("gap", "8px"),
  ("maxHeight", "320px"),
  ("overflow", "auto"),
  ("margin", "0"),
  ("padding", "0 2px 0 0"),
  ("listStyle", "none")
]

def surfacePanelStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(auto-fit, minmax(150px, 1fr))"),
  ("gap", "1px"),
  ("overflow", "hidden"),
  ("border", border borderColor),
  ("borderRadius", "8px"),
  ("background", borderColor)
]

def surfaceCellStyle : Property := style #[
  ("display", "grid"),
  ("gap", "3px"),
  ("minWidth", "0"),
  ("padding", "8px 10px"),
  ("background", hoverBg)
]

def surfaceCellLabelStyle : Property := style #[
  ("color", subtleFg),
  ("fontSize", "0.64rem"),
  ("fontWeight", "820"),
  ("lineHeight", "1.1"),
  ("textTransform", "uppercase")
]

def surfaceCellValueStyle : Property := style #[
  ("color", fg),
  ("fontSize", "0.78rem"),
  ("fontWeight", "700"),
  ("lineHeight", "1.25"),
  ("overflowWrap", "anywhere")
]

def goalButtonStyle (selected : Bool) : Property :=
  style <| #[
    ("display", "grid"),
    ("gridTemplateColumns", "minmax(0, 1fr)"),
    ("gap", "6px"),
    ("width", "100%"),
    ("minHeight", "74px"),
    ("border", border (if selected then focusColor else borderColor)),
    ("borderRadius", "8px"),
    ("background", if selected then activeBg else editorBg),
    ("color", if selected then activeFg else fg),
    ("padding", "10px 11px"),
    ("textAlign", "left"),
    ("font", "inherit"),
    ("cursor", "pointer")
  ]

def goalButtonTopStyle : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "minmax(0, 1fr) auto"),
  ("alignItems", "center"),
  ("gap", "10px"),
  ("minWidth", "0")
]

def goalMetaStyle : Property := style #[
  ("color", mutedFg),
  ("fontSize", "0.75rem"),
  ("fontWeight", "650"),
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap")
]

def goalTargetPreviewStyle : Property := style #[
  ("display", "block"),
  ("minWidth", "0"),
  ("color", mutedFg),
  ("fontSize", "0.72rem"),
  ("fontWeight", "650"),
  ("lineHeight", "1.2"),
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap")
]

def detailStyle : Property := style #[
  ("display", "grid"),
  ("gap", "12px"),
  ("minWidth", "0"),
  ("padding", "12px"),
  ("border", border borderColor),
  ("borderRadius", "8px"),
  ("background", editorBg)
]

def actionBarStyle : Property := style #[
  ("display", "flex"),
  ("flexWrap", "wrap"),
  ("alignItems", "center"),
  ("gap", "8px"),
  ("minWidth", "0")
]

def actionButtonStyle : Property := style #[
  ("minHeight", "30px"),
  ("padding", "0 10px"),
  ("border", border borderColor),
  ("borderRadius", "6px"),
  ("background", panelBg),
  ("color", fg),
  ("font", "inherit"),
  ("fontSize", "0.76rem"),
  ("fontWeight", "760"),
  ("cursor", "pointer")
]

def actionStatusStyle : Property := style #[
  ("minWidth", "0"),
  ("color", mutedFg),
  ("fontSize", "0.74rem"),
  ("fontWeight", "680"),
  ("overflowWrap", "anywhere")
]

def targetStyle : Property := style #[
  ("minHeight", "78px"),
  ("margin", "0"),
  ("padding", "12px"),
  ("overflow", "auto"),
  ("border", border borderColor),
  ("borderRadius", "8px"),
  ("background", codeBg),
  ("color", fg)
]

def codeStyle : Property := style #[
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("whiteSpace", "pre-wrap")
]

def hypothesisStyle : Property := style #[
  ("display", "grid"),
  ("gap", "5px"),
  ("minWidth", "0"),
  ("padding", "8px 10px"),
  ("border", border borderColor),
  ("borderLeft", "3px solid " ++ focusColor),
  ("borderRadius", "8px"),
  ("background", panelBg),
  ("color", fg),
  ("fontSize", "0.86rem"),
  ("overflowWrap", "anywhere")
]

def hypothesisLineStyle : Property := style #[
  ("minWidth", "0"),
  ("overflowWrap", "anywhere")
]

def hypothesisMetaStyle : Property := style #[
  ("display", "flex"),
  ("flexWrap", "wrap"),
  ("gap", "5px"),
  ("alignItems", "center"),
  ("minWidth", "0"),
  ("color", subtleFg),
  ("fontSize", "0.68rem"),
  ("fontWeight", "720")
]

def inlineTokenStyle : Property := style #[
  ("display", "inline-flex"),
  ("alignItems", "center"),
  ("minHeight", "18px"),
  ("maxWidth", "100%"),
  ("padding", "0 5px"),
  ("border", border borderColor),
  ("borderRadius", "4px"),
  ("background", codeBg),
  ("color", linkFg),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.68rem"),
  ("fontWeight", "760"),
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap")
]

def emptyStateStyle : Property := style #[
  ("padding", "16px"),
  ("border", "1px dashed " ++ borderColor),
  ("borderRadius", "8px"),
  ("background", editorBg),
  ("color", mutedFg),
  ("fontSize", "0.9rem")
]

def exprResultStyle : Property := style #[
  ("display", "grid"),
  ("gap", "6px"),
  ("minWidth", "0"),
  ("padding", "10px"),
  ("border", border borderColor),
  ("borderRadius", "6px"),
  ("background", codeBg),
  ("color", fg)
]

end UiStyle

open UiStyle

structure WidgetState where
  selectedGoalId : String
  actionStatus : String
  exprResult : String

structure WidgetStateHook where
  selectedGoalId : State (Lean.Vir.Js String)
  actionStatus : State (Lean.Vir.Js String)
  exprResult : State (Lean.Vir.Js String)
  value : WidgetState

def selectedLocationGoalId? (surface : Surface) : Option String :=
  surface.selectedLocations.find? fun selectedId =>
    surface.goals.any (fun goal => goal.id == selectedId)

def initialSelectedGoalId (surface : Surface) : String :=
  match selectedLocationGoalId? surface with
  | some selectedId => selectedId
  | none =>
      match surface.goals[0]? with
      | some goal => goal.id
      | none => ""

def initialState (surface : Surface) : WidgetState :=
  {
    selectedGoalId := initialSelectedGoalId surface
    actionStatus := "Ready"
    exprResult := "Resolve ExprWithCtx to inspect the current goal target."
  }

def selectedGoal? (surface : Surface) (selectedId : String) : Option Goal :=
  match surface.goals.find? (fun goal => goal.id == selectedId) with
  | some goal => some goal
  | none => surface.goals[0]?

def hasGoalId (surface : Surface) (selectedId : String) : Bool :=
  surface.goals.any (fun goal => goal.id == selectedId)

def reconcileState (surface : Surface) (state : WidgetState) : WidgetState :=
  if hasGoalId surface state.selectedGoalId then
    state
  else
    { state with selectedGoalId := initialSelectedGoalId surface, actionStatus := "Ready" }

def useWidgetState (surface : Surface) : ReactM WidgetStateHook := do
  let initial := initialState surface
  let initialGoalId ← JsValue.ofString initial.selectedGoalId
  let selectedGoalId ← Hooks.useState initialGoalId
  let initialStatus ← JsValue.ofString initial.actionStatus
  let actionStatus ← Hooks.useState initialStatus
  let initialExprResult ← JsValue.ofString initial.exprResult
  let exprResult ← Hooks.useState initialExprResult
  let selectedGoalValue ← JsValue.toString selectedGoalId.value
  let actionStatusValue ← JsValue.toString actionStatus.value
  let exprResultValue ← JsValue.toString exprResult.value
  let value := reconcileState surface {
    selectedGoalId := selectedGoalValue,
    actionStatus := actionStatusValue,
    exprResult := exprResultValue
  }
  pure { selectedGoalId, actionStatus, exprResult, value }

def setStringState (state : State (Lean.Vir.Js String)) (value : String) : DomM Unit := do
  let next ← JsValue.ofString value
  State.set state next

def commit
    (surface : Surface) (state : WidgetStateHook)
    (update : WidgetState → WidgetState) : DomM Unit := do
  let next := reconcileState surface (update state.value)
  if next.selectedGoalId != state.value.selectedGoalId then
    setStringState state.selectedGoalId next.selectedGoalId
  else
    pure ()
  if next.actionStatus != state.value.actionStatus then
    setStringState state.actionStatus next.actionStatus
  else
    pure ()
  if next.exprResult != state.value.exprResult then
    setStringState state.exprResult next.exprResult
  else
    pure ()

def plural (count : Nat) (one many : String) : String :=
  if count == 1 then one else many

def commaList (values : Array String) (fallback : String) : String :=
  match values.toList with
  | [] => fallback
  | labels => ", ".intercalate labels

def hypothesisCount (surface : Surface) : Nat :=
  surface.goals.foldl (init := 0) fun count goal => count + goal.hypotheses.size

def goalKindLabel (goal : Goal) : String :=
  if goal.kind == "term" then
    "term goal"
  else
    s!"goal {goal.index + 1}"

def goalIdentity (goal : Goal) : String :=
  match goal.userName with
  | some userName => "case " ++ userName
  | none =>
      match goal.mvarId with
      | some mvarId => mvarId
      | none => goalKindLabel goal

def cursorLabel (surface : Surface) : String :=
  surface.cursor.label

def selectionSummary (surface : Surface) : String :=
  commaList (surface.selections.map (fun selection => selection.label)) "no source selection"

def namesLabel (names : Array String) (fallback : String) : String :=
  match names.toList with
  | [] => fallback
  | values => " ".intercalate values

def optionLabel (value? : Option String) : String :=
  match value? with
  | none => "none"
  | some value => value

def fvarCount (goal : Goal) : Nat :=
  goal.hypotheses.foldl (init := 0) fun count hypothesis => count + hypothesis.fvarIds.size

def selectedLocationCountLabel (surface : Surface) : String :=
  let count := surface.selections.size
  s!"{count} {plural count "selection" "selections"}"

def selectedLocationIdsLabel (surface : Surface) : String :=
  commaList surface.selectedLocations "none"

def apiChip (accent label value : String) : ReactM (Lean.Vir.Js Node) := do
  let name ← Node.codeText #[Property.classList #["react-proof-api-name"], apiNameStyle] label
  let valueNode ← Node.spanTextWith #[Property.classList #["react-proof-api-value"], apiValueStyle] value
  Node.spanWith
    #[Property.classList #["react-proof-api-chip"], apiChipStyle accent]
    #[]
    #[
      name,
      valueNode
    ]

def apiStrip (surface : Surface) (goal? : Option Goal) : ReactM (Lean.Vir.Js Node) := do
  let selectedGoalLabel :=
    match goal? with
    | none => "none"
    | some goal => goal.title
  let selectedFvars :=
    match goal? with
    | none => "0 fvars"
    | some goal => s!"{fvarCount goal} fvars"
  let goals ← apiChip blueFg "Surface.goals" s!"{surface.goals.size}"
  let selections ← apiChip greenFg "Surface.selections" (selectedLocationCountLabel surface)
  let target ← apiChip purpleFg "Goal.target" selectedGoalLabel
  let fvars ← apiChip orangeFg "Hypothesis.fvarIds" selectedFvars
  let clicks ← apiChip linkFg "React.onClick" "goal tabs"
  let clipboard ← apiChip blueFg "Clipboard.writeText" "copy actions"
  let reveal ← apiChip greenFg "Command.revealPosition" "cursor"
  let exprRef ← apiChip purpleFg "WithRpcRef ExprWithCtx" <|
    match surface.proofWidgetsExpr with
    | none => "pending"
    | some expr => expr.ref.label
  Node.navWith
    #[
      Property.id "react-proof-api-strip",
      Property.classList #["react-proof-api-strip"],
      Property.ariaLabel "Proof widget API surface",
      apiStripStyle
    ]
    #[]
    #[
      goals,
      selections,
      target,
      fvars,
      clicks,
      clipboard,
      reveal,
      exprRef
    ]

def hypothesisLabel (hypothesis : Hypothesis) : String :=
  namesLabel hypothesis.names hypothesis.id

def hypothesisText (hypothesis : Hypothesis) : String :=
  let valueSuffix :=
    match hypothesis.value with
    | none => ""
    | some value => " := " ++ value
  hypothesisLabel hypothesis ++ " : " ++ hypothesis.type ++ valueSuffix

def goalContextText (goal : Goal) : String :=
  if goal.hypotheses.isEmpty then
    "No local hypotheses."
  else
    "\n".intercalate (goal.hypotheses.map hypothesisText).toList

def goalClipboardText (surface : Surface) (goal : Goal) : String :=
  "\n".intercalate [
    "Goal: " ++ goal.title,
    "Status: " ++ goal.status,
    "Cursor: " ++ cursorLabel surface,
    "Selection: " ++ selectionSummary surface,
    "",
    "Target:",
    goal.target,
    "",
    "Local context:",
    goalContextText goal
  ]

def cursorClipboardText (surface : Surface) : String :=
  "\n".intercalate [
    "Cursor: " ++ surface.cursor.label,
    "File: " ++ surface.cursor.fileName,
    "URI: " ++ surface.cursor.uri,
    s!"Line: {surface.cursor.line + 1}",
    s!"Character: {surface.cursor.character + 1}"
  ]

def selectionClipboardEntry (selection : SelectedLocation) : String :=
  "\n".intercalate [
    "Selection: " ++ selection.label,
    "Kind: " ++ selection.kind,
    "Id: " ++ selection.id
  ]

def selectionClipboardText (surface : Surface) : String :=
  if surface.selections.isEmpty then
    "No source selection at " ++ cursorLabel surface
  else
    let entries := surface.selections.map selectionClipboardEntry
    "\n".intercalate <|
      [
        "Cursor: " ++ cursorLabel surface,
        "Selected locations: " ++ selectedLocationIdsLabel surface,
        "",
        "Selections:"
      ] ++ entries.toList

def copyStatus (label : String) (ok : Bool) : String :=
  if ok then
    label ++ " copied"
  else
    label ++ " copy unavailable"

def commandStatus (label : String) (ok : Bool) : String :=
  if ok then
    label ++ " requested"
  else
    label ++ " unavailable"

def tokenView (value : String) : ReactM (Lean.Vir.Js Node) :=
  Node.codeText #[Property.classList #["react-proof-token"], inlineTokenStyle] value

def tokenListView (values : Array String) (fallback : String) : ReactM (Array (Lean.Vir.Js Node)) :=
  match values.toList with
  | [] => do
      let token ← tokenView fallback
      pure #[token]
  | _ => values.mapM tokenView

def hypothesisChildren (hypothesis : Hypothesis) : ReactM (Array (Lean.Vir.Js Node)) := do
  let valueSuffix ←
    match hypothesis.value with
    | none => pure #[]
    | some value => do
        let sep ← Node.spanText " := "
        let valueNode ← Node.codeText #[Property.classList #["react-proof-hypothesis-value"], codeStyle] value
        pure #[sep, valueNode]
  let name ← Node.codeText #[Property.classList #["react-proof-hypothesis-name"], codeStyle] (hypothesisLabel hypothesis)
  let colon ← Node.spanText " : "
  let typeNode ← Node.codeText #[Property.classList #["react-proof-hypothesis-type"], codeStyle] hypothesis.type
  let line ← Node.spanWith #[Property.classList #["react-proof-hypothesis-line"], hypothesisLineStyle] #[] <|
      #[
        name,
        colon,
        typeNode
      ] ++ valueSuffix
  let fvarLabel ← Node.spanText "fvarIds"
  let fvars ← tokenListView hypothesis.fvarIds "none"
  let metaNode ← Node.spanWith #[Property.classList #["react-proof-hypothesis-meta"], hypothesisMetaStyle] #[] <|
    #[fvarLabel] ++ fvars
  pure #[line, metaNode]

def hypothesisView (hypothesis : Hypothesis) : ReactM (Lean.Vir.Js Node) := do
  let children ← hypothesisChildren hypothesis
  Node.keyedLiWith hypothesis.id
    #[Property.classList #["react-proof-hypothesis"], Property.role "listitem", hypothesisStyle]
    #[]
    children

def hypothesesView (goal : Goal) : ReactM (Lean.Vir.Js Node) := do
  if goal.hypotheses.isEmpty then
    Node.pTextWith
      #[
        Property.id "react-proof-hypotheses",
        Property.classList #["react-proof-hypotheses", "is-empty"],
        emptyStateStyle
      ]
      "No local hypotheses."
  else
    let hypotheses ← goal.hypotheses.mapM hypothesisView
    Node.ulWith
      #[
        Property.id "react-proof-hypotheses",
        Property.classList #["react-proof-hypotheses"],
        Property.role "list",
        Property.ariaLabel ("Hypotheses for " ++ goal.title),
        hypothesesListStyle
      ]
      #[]
      hypotheses

def selectedClasses (selected : Bool) : Array String :=
  if selected then
    #["react-proof-goal", "is-selected"]
  else
    #["react-proof-goal"]

def goalButton
    (selectGoal : String → DomM Unit)
    (selectedId : String)
    (goal : Goal) : ReactM (Lean.Vir.Js Node) := do
  let selected := goal.id == selectedId
  let title ← Node.spanTextWith
    #[Property.classList #["react-proof-goal-title"]]
    goal.title
  let status ← Node.spanTextWith
    #[Property.classList #["react-proof-goal-status"], badgeStyle]
    goal.status
  let top ← Node.spanWith #[Property.classList #["react-proof-goal-top"], goalButtonTopStyle] #[] #[
    title,
    status
  ]
  let metaNode ← Node.spanTextWith
    #[Property.classList #["react-proof-goal-meta"], goalMetaStyle]
    (goalKindLabel goal ++ " · " ++ goalIdentity goal ++ " · " ++ s!"{goal.hypotheses.size} local")
  let target ← Node.spanTextWith
    #[Property.classList #["react-proof-goal-target"], goalTargetPreviewStyle]
    goal.target
  let button ← Node.buttonWith
    #[
      Property.id ("react-proof-goal-" ++ goal.id),
      Property.classList (selectedClasses selected),
      Property.ariaPressed selected,
      Property.ariaSelected selected,
      Property.title goal.status,
      Property.data "goal" goal.id,
      goalButtonStyle selected
    ]
    #[EventHandler.onClick (selectGoal goal.id)]
    #[top, metaNode, target]
  Node.keyedLiWith goal.id
    #[Property.classList #["react-proof-goal-item"], Property.role "listitem"]
    #[]
    #[button]

def goalList (surface : Surface) (selectGoal : String → DomM Unit) (selectedId : String) : ReactM (Lean.Vir.Js Node) := do
  let goals ← surface.goals.mapM (goalButton selectGoal selectedId)
  Node.ulWith
    #[
      Property.id "react-proof-goal-list",
      Property.classList #["react-proof-goal-list"],
      Property.role "list",
      Property.ariaLabel "Proof goals",
      goalListStyle
    ]
    #[]
    goals

def summaryText (surface : Surface) (goal : Goal) : String :=
  let goalCount := surface.goals.size
  let hypCount := goal.hypotheses.size
  let totalHypCount := hypothesisCount surface
  s!"{goal.title}; {hypCount} local {plural hypCount "hypothesis" "hypotheses"}; {goalCount} {plural goalCount "goal" "goals"} / {totalHypCount} {plural totalHypCount "hypothesis" "hypotheses"} at {cursorLabel surface}"

def metricView (label value : String) : ReactM (Lean.Vir.Js Node) := do
  let labelNode ← Node.spanTextWith #[Property.classList #["react-proof-metric-label"], metricLabelStyle] label
  let valueNode ← Node.strongTextWith #[Property.classList #["react-proof-metric-value"], metricValueStyle] value
  Node.divWith #[Property.classList #["react-proof-metric"], metricStyle] #[] #[
    labelNode,
    valueNode
  ]

def selectedHypothesisCountLabel (goal? : Option Goal) : String :=
  match goal? with
  | none => "0 local"
  | some goal => s!"{goal.hypotheses.size} local"

def metricGrid (surface : Surface) (goal? : Option Goal) : ReactM (Lean.Vir.Js Node) := do
  let goalCount := surface.goals.size
  let goals ← metricView "Goals" s!"{goalCount} {plural goalCount "goal" "goals"}"
  let context ← metricView "Context" (selectedHypothesisCountLabel goal?)
  let selection ← metricView "Selection" (selectedLocationCountLabel surface)
  let cursor ← metricView "Cursor" (cursorLabel surface)
  Node.divWith #[Property.id "react-proof-metrics", Property.classList #["react-proof-metrics"], metricGridStyle] #[] #[
    goals,
    context,
    selection,
    cursor
  ]

def surfaceCell (label value : String) : ReactM (Lean.Vir.Js Node) := do
  let labelNode ← Node.spanTextWith #[Property.classList #["react-proof-surface-label"], surfaceCellLabelStyle] label
  let valueNode ← Node.spanTextWith #[Property.classList #["react-proof-surface-value"], surfaceCellValueStyle] value
  Node.divWith #[Property.classList #["react-proof-surface-cell"], surfaceCellStyle] #[] #[
    labelNode,
    valueNode
  ]

def surfacePanel (surface : Surface) (goal : Goal) : ReactM (Lean.Vir.Js Node) := do
  let selected ← surfaceCell "Selected" (selectionSummary surface)
  let selectedLocations ← surfaceCell "selectedLocations" (selectedLocationIdsLabel surface)
  let mvarId ← surfaceCell "mvarId" (optionLabel goal.mvarId)
  let userName ← surfaceCell "userName" (optionLabel goal.userName)
  let kind ← surfaceCell "kind" goal.kind
  let fvarIds ← surfaceCell "fvarIds" s!"{fvarCount goal}"
  Node.divWith
    #[
      Property.id "react-proof-surface-panel",
      Property.classList #["react-proof-surface-panel"],
      Property.ariaLabel "Selected infoview surface",
      surfacePanelStyle
    ]
    #[]
    #[
      selected,
      selectedLocations,
      mvarId,
      userName,
      kind,
      fvarIds
    ]

def headerSummary (surface : Surface) (goal? : Option Goal) : String :=
  match goal? with
  | none => "No proof goals at " ++ cursorLabel surface
  | some goal => summaryText surface goal

def surfaceHeader (surface : Surface) (goal? : Option Goal) : ReactM (Lean.Vir.Js Node) := do
  let eyebrow ← Node.pTextWith #[Property.classList #["react-proof-eyebrow"], eyebrowStyle] "Live Lean infoview"
  let title ← Node.h3TextWith #[headingStyle] "Live ProofWidget"
  let moduleBadge ← Node.spanTextWith #[Property.classList #["react-proof-module"], badgeStyle] "VIR"
  let runtimeBadge ← Node.spanTextWith #[Property.classList #["react-proof-runtime"], badgeStyle] "React"
  let liveBadge ← Node.spanTextWith #[Property.classList #["react-proof-live"], badgeStyle] "live"
  let rangeBadge ← Node.spanTextWith #[Property.classList #["react-proof-range"], badgeStyle] (cursorLabel surface)
  let source ← Node.pWith #[Property.classList #["react-proof-source"], sourceStyle] #[] #[
    moduleBadge,
    runtimeBadge,
    liveBadge,
    rangeBadge
  ]
  let summaryNode ← Node.pTextWith
    #[
      Property.id "react-proof-summary",
      Property.classList #["react-proof-summary"],
      Property.ariaLive "polite",
      summaryStyle
    ]
    (headerSummary surface goal?)
  let heading ← Node.divWith #[Property.classList #["react-proof-heading"]] #[] #[
    eyebrow,
    title,
    source,
    summaryNode
  ]
  let metrics ← metricGrid surface goal?
  let side ← Node.divWith #[Property.classList #["react-proof-header-side"]] #[] #[metrics]
  Node.headerWith #[Property.classList #["react-proof-header"], headerStyle] #[] #[
    heading,
    side
  ]

def actionButton (id label : String) (onClick : DomM Unit) : ReactM (Lean.Vir.Js Node) := do
  Node.buttonTextWith
    #[
      Property.id id,
      Property.classList #["react-proof-action"],
      Property.type "button",
      actionButtonStyle
    ]
    #[EventHandler.onClick onClick]
    label

def actionBar
    (goal : Goal)
    (revealCursor : DomM Unit)
    (copyCursor : DomM Unit)
    (copySelection : DomM Unit)
    (copyTarget : Goal → DomM Unit)
    (copyContext : Goal → DomM Unit)
    (resolveExpr : DomM Unit)
    (actionStatus : String) : ReactM (Lean.Vir.Js Node) := do
  let reveal ← actionButton "react-proof-reveal-cursor" "Reveal cursor" revealCursor
  let cursor ← actionButton "react-proof-copy-cursor" "Copy cursor" copyCursor
  let selection ← actionButton "react-proof-copy-selection" "Copy selection" copySelection
  let target ← actionButton "react-proof-copy-target" "Copy target" (copyTarget goal)
  let context ← actionButton "react-proof-copy-context" "Copy context" (copyContext goal)
  let expr ← actionButton "react-proof-resolve-expr" "Resolve ExprWithCtx" resolveExpr
  let status ← Node.spanTextWith
    #[
      Property.id "react-proof-action-status",
      Property.classList #["react-proof-action-status"],
      Property.ariaLive "polite",
      actionStatusStyle
    ]
    actionStatus
  Node.divWith
    #[
      Property.classList #["react-proof-actions"],
      actionBarStyle
    ]
    #[]
    #[
      reveal,
      cursor,
      selection,
      target,
      context,
      expr,
      status
    ]

def resolvedExprText (info : Lean.Vir.ProofWidgets.ResolvedRef) : String :=
  let expression := if info.expression == "" then info.label else info.expression
  let typeText := if info.typeText == "" then "(unavailable)" else info.typeText
  let context := if info.context == "" then "(empty context)" else info.context
  "source: " ++ info.source ++ "\n" ++
  "position: " ++ info.position ++ "\n" ++
  "expression: " ++ expression ++ "\n" ++
  "type: " ++ typeText ++ "\n" ++
  "context:\n" ++ context

def exprResultView (result : String) : ReactM (Lean.Vir.Js Node) := do
  let label ← Node.pTextWith
    #[Property.classList #["react-proof-panel-label"], panelLabelStyle]
    "Resolved ExprWithCtx"
  let code ← Node.codeText #[Property.id "react-proof-expr-result-code", codeStyle] result
  let panel ←
    Node.preWith
      #[
        Property.id "react-proof-expr-result",
        Property.classList #["react-proof-expr-result"],
        exprResultStyle
      ]
      #[]
      #[code]
  Node.divWith #[Property.classList #["react-proof-expr-result-panel"]] #[] #[
    label,
    panel
  ]

def emptyView (surface : Surface) : ReactM (Lean.Vir.Js Node) := do
  let header ← surfaceHeader surface none
  let apis ← apiStrip surface none
  let empty ← Node.pTextWith #[Property.classList #["react-proof-empty"], emptyStateStyle]
    "The current infoview snapshot has no goals."
  Node.sectionWith
    #[
      Property.id "react-proof-widget",
      Property.classList #["react-proof-widget"],
      Property.role "region",
      Property.ariaLabel "Lean proof widget",
      widgetStyle
    ]
    #[]
    #[
      header,
      apis,
      empty
    ]

def detailView
    (surface : Surface)
    (goal : Goal)
    (revealCursor : DomM Unit)
    (copyCursor : DomM Unit)
    (copySelection : DomM Unit)
    (copyTarget : Goal → DomM Unit)
    (copyContext : Goal → DomM Unit)
    (resolveExpr : DomM Unit)
    (actionStatus : String)
    (exprResult : String) : ReactM (Lean.Vir.Js Node) := do
  let title ← Node.h3TextWith #[Property.id "react-proof-selected-title", headingStyle] goal.title
  let status ← Node.spanTextWith #[Property.id "react-proof-selected-status", badgeStyle] goal.status
  let kind ← Node.spanTextWith #[Property.classList #["react-proof-selected-kind"], goalMetaStyle]
    (" " ++ goalKindLabel goal ++ " · " ++ selectionSummary surface)
  let statusLine ← Node.pWith #[Property.classList #["react-proof-status-line"]] #[] #[status, kind]
  let surfacePanelNode ← surfacePanel surface goal
  let actions ← actionBar goal revealCursor copyCursor copySelection copyTarget copyContext resolveExpr actionStatus
  let exprResultNode ← exprResultView exprResult
  let targetLabel ← Node.pTextWith #[Property.classList #["react-proof-panel-label"], panelLabelStyle] "Target"
  let targetCode ← Node.codeText #[Property.id "react-proof-target-code", codeStyle] goal.target
  let target ← Node.preWith #[Property.id "react-proof-target", Property.classList #["react-proof-target"], targetStyle] #[] #[
    targetCode
  ]
  let contextLabel ← Node.pTextWith #[Property.classList #["react-proof-panel-label"], panelLabelStyle] "Local context"
  let hypotheses ← hypothesesView goal
  Node.articleWith
    #[
      Property.id "react-proof-detail",
      Property.classList #["react-proof-detail"],
      Property.ariaLive "polite",
      detailStyle
    ]
    #[]
    #[
      title,
      statusLine,
      surfacePanelNode,
      actions,
      exprResultNode,
      targetLabel,
      target,
      contextLabel,
      hypotheses
    ]

structure ViewProps where
  surface : Surface
  selectGoal : String → DomM Unit
  revealCursor : DomM Unit
  copyCursor : DomM Unit
  copySelection : DomM Unit
  copyTarget : Goal → DomM Unit
  copyContext : Goal → DomM Unit
  resolveExpr : DomM Unit
  state : WidgetState

def View : Component ViewProps := fun props => do
  match selectedGoal? props.surface props.state.selectedGoalId with
  | none => emptyView props.surface
  | some goal =>
      let header ← surfaceHeader props.surface (some goal)
      let apis ← apiStrip props.surface (some goal)
      let goalsLabel ← Node.pTextWith #[Property.classList #["react-proof-panel-label"], panelLabelStyle] "Goals"
      let goals ← goalList props.surface props.selectGoal props.state.selectedGoalId
      let sidebar ← Node.divWith #[Property.classList #["react-proof-sidebar"], sidebarStyle] #[] #[
        goalsLabel,
        goals
      ]
      let detail ← detailView
        props.surface
        goal
        props.revealCursor
        props.copyCursor
        props.copySelection
        props.copyTarget
        props.copyContext
        props.resolveExpr
        props.state.actionStatus
        props.state.exprResult
      let main ← Node.divWith #[Property.classList #["react-proof-main"], mainStyle] #[] #[detail]
      let layout ← Node.divWith #[Property.classList #["react-proof-layout"], layoutStyle] #[] #[
        sidebar,
        main
      ]
      Node.sectionWith
        #[
          Property.id "react-proof-widget",
          Property.classList #["react-proof-widget"],
          Property.role "region",
          Property.ariaLabel "Lean proof widget",
          widgetStyle
        ]
        #[]
        #[
          header,
          apis,
          layout
        ]

def view
    (surface : Surface)
    (selectGoal : String → DomM Unit)
    (revealCursor : DomM Unit)
    (copyCursor : DomM Unit)
    (copySelection : DomM Unit)
    (copyTarget : Goal → DomM Unit)
    (copyContext : Goal → DomM Unit)
    (resolveExpr : DomM Unit)
    (state : WidgetState) : ReactM (Lean.Vir.Js Node) :=
  Node.component View {
    surface,
    selectGoal,
    revealCursor,
    copyCursor,
    copySelection,
    copyTarget,
    copyContext,
    resolveExpr,
    state
  }

def renderView (surface : Surface) (stateHook : WidgetStateHook) : ReactM (Lean.Vir.Js Node) := do
  let state := stateHook.value
  let selectGoal (nextId : String) : DomM Unit :=
    commit surface stateHook fun state => { state with selectedGoalId := nextId, actionStatus := "Ready" }
  let revealCursor : DomM Unit := do
    let ok ← Lean.Vir.Infoview.Command.revealCursor surface
    commit surface stateHook fun state => { state with actionStatus := commandStatus "Reveal cursor" ok }
  let copyCursor : DomM Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText (cursorClipboardText surface)
    commit surface stateHook fun state => { state with actionStatus := copyStatus "Cursor" ok }
  let copySelection : DomM Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText (selectionClipboardText surface)
    commit surface stateHook fun state => { state with actionStatus := copyStatus "Selection" ok }
  let copyTarget (goal : Goal) : DomM Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText goal.target
    commit surface stateHook fun state => { state with actionStatus := copyStatus "Target" ok }
  let copyContext (goal : Goal) : DomM Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText (goalClipboardText surface goal)
    commit surface stateHook fun state => { state with actionStatus := copyStatus "Context" ok }
  let resolveExpr : DomM Unit := do
    match surface.proofWidgetsExpr with
    | none =>
        commit surface stateHook fun state =>
          {
            state with
            actionStatus := "ExprWithCtx ref pending",
            exprResult := "No ExprWithCtx ref is available at this cursor. Move into a tactic proof and wait for the API chip to leave pending."
          }
    | some expr =>
        commit surface stateHook fun state =>
          {
            state with
            actionStatus := "Resolving ExprWithCtx",
            exprResult := "Resolving server-owned ExprWithCtx..."
          }
        let ok ← Lean.Vir.ProofWidgets.Rpc.resolve expr fun info => do
          commit surface stateHook fun state =>
            {
              state with
              actionStatus := Lean.Vir.ProofWidgets.ResolvedRef.statusText info,
              exprResult := resolvedExprText info
            }
        if ok then
          pure ()
        else
          commit surface stateHook fun state =>
            {
              state with
              actionStatus := "ExprWithCtx resolve unavailable",
              exprResult := "The host did not accept the ExprWithCtx resolve request."
            }
  view
    surface
    selectGoal
    revealCursor
    copyCursor
    copySelection
    copyTarget
    copyContext
    resolveExpr
    state

def App : Component Surface := fun surface => do
  let state ← useWidgetState surface
  renderView surface state

def app (surface : Surface) : ReactM (Lean.Vir.Js Node) :=
  Node.component App surface

vir_proof_widget App with mountId := "vir-react-proof-widget"

end ReactProofWidget

/-!
Open the infoview on the command below after running:

```
npm run build:demo
npm run test:infoview
```

The demo path above is the repo-local `web/public/vir-upstream.wasm` binary.
`npm run build:demo` refreshes the embedded infoview shell, rebuilds `Vir`, and
creates that WASM. `Vir.Infoview` transports it through the infoview RPC
session, so no local dev server is required. `vir_proof_widget App` declares the
standard mount/unmount entries, `ReactProofWidget.irPackage`, and
`ReactProofWidget.widgetProps`. The `.irpkg` payload is built from the
active Lean server snapshot and sent over the RPC channel when the runtime
service is first needed. `autoReloadMs` only performs a cheap package stat after
that; the stat token is derived from source ranges in the local package closure,
so ordinary proof edits outside the widget code do not rebuild the package.
Cursor navigation updates the proof surface without rebuilding the package. The
JavaScript shell passes the real infoview panel goals to `ReactProofWidget.mount`.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidget.widgetProps]

/-!
The widget above stays enabled for the rest of this file. Move the cursor
through the proofs below to watch the real goal and local context change.
-/

section Playground

theorem proofWidget_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left

theorem proofWidget_exists_nat : ∃ n : Nat, n + 2 = 5 := by
  refine ⟨3, ?_⟩
  decide

theorem proofWidget_list_map_id (xs : List Nat) : xs.map (fun x => x) = xs := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
      simp [ih]

theorem proofWidget_or_comm (p q : Prop) : p ∨ q → q ∨ p := by
  intro h
  cases h with
  | inl hp => exact Or.inr hp
  | inr hq => exact Or.inl hq

theorem proofWidget_add_assoc_play (a b c : Nat) : (a + b) + c = a + (b + c) := by
  simpa using Nat.add_assoc a b c

end Playground
