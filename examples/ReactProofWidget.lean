/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview
import Vir.React

namespace ReactProofWidget

open Lean.Vir.React
open Lean.Vir.Infoview (Hypothesis Goal SelectedLocation Surface)

-- Keep this example independent from any future ProofWidgets compatibility DSL.
def codeText (props : Array Property) (value : String) : Html :=
  Html.codeWith props #[] #[.text value]

namespace UiStyle

def style (entries : Array (String × String)) : Property :=
  Property.style <| entries.map fun (name, value) => { name, value }

def vscodeColor (name fallback : String) : String :=
  "var(--vscode-" ++ name ++ ", " ++ fallback ++ ")"

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

def border (color : String) : String :=
  "1px solid " ++ color

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

end UiStyle

open UiStyle

structure WidgetState where
  selectedGoalId : String
  actionStatus : String

structure WidgetStateEntry where
  selector : String
  state : WidgetState

initialize widgetStates : IO.Ref (Array WidgetStateEntry) ← IO.mkRef #[]

def initialSelectedGoalId (surface : Surface) : String :=
  match surface.goals[0]? with
  | some goal => goal.id
  | none => ""

def initialState (surface : Surface) : WidgetState :=
  { selectedGoalId := initialSelectedGoalId surface, actionStatus := "Ready" }

def selectedGoal? (surface : Surface) (selectedId : String) : Option Goal :=
  match surface.goals.find? (fun goal => goal.id == selectedId) with
  | some goal => some goal
  | none => surface.goals[0]?

def hasGoalId (surface : Surface) (selectedId : String) : Bool :=
  surface.goals.any (fun goal => goal.id == selectedId)

def reconcileState (surface : Surface) (state : WidgetState) : WidgetState :=
  if hasGoalId surface state.selectedGoalId then
    { state with actionStatus := "Ready" }
  else
    { selectedGoalId := initialSelectedGoalId surface, actionStatus := "Ready" }

def rememberState (selector : String) (state : WidgetState) : IO Unit := do
  let next : WidgetStateEntry := { selector, state }
  let mounted ← widgetStates.get
  let mut found := false
  let mut updated := #[]
  for item in mounted do
    if item.selector == selector then
      if found then
        pure ()
      else
        found := true
        updated := updated.push next
    else
      updated := updated.push item
  widgetStates.set <| if found then updated else updated.push next

def findState? (selector : String) : IO (Option WidgetState) := do
  return (← widgetStates.get).find? (fun mounted => mounted.selector == selector) |>.map (·.state)

def takeState? (selector : String) : IO (Option WidgetState) := do
  let mounted ← widgetStates.get
  let mut found := none
  let mut rest := #[]
  for item in mounted do
    if item.selector == selector then
      match found with
      | none => found := some item.state
      | some _ => pure ()
    else
      rest := rest.push item
  widgetStates.set rest
  return found

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

def apiChip (accent label value : String) : Html :=
  Html.spanWith
    #[Property.classList #["react-proof-api-chip"], apiChipStyle accent]
    #[]
    #[
      codeText #[Property.classList #["react-proof-api-name"], apiNameStyle] label,
      Html.spanWith #[Property.classList #["react-proof-api-value"], apiValueStyle] #[] #[.text value]
    ]

def apiStrip (surface : Surface) (goal? : Option Goal) : Html :=
  let selectedGoalLabel :=
    match goal? with
    | none => "none"
    | some goal => goal.title
  let selectedFvars :=
    match goal? with
    | none => "0 fvars"
    | some goal => s!"{fvarCount goal} fvars"
  Html.navWith
    #[
      Property.id "react-proof-api-strip",
      Property.classList #["react-proof-api-strip"],
      Property.ariaLabel "Proof widget API surface",
      apiStripStyle
    ]
    #[]
    #[
      apiChip blueFg "Surface.goals" s!"{surface.goals.size}",
      apiChip greenFg "Surface.selections" (selectedLocationCountLabel surface),
      apiChip purpleFg "Goal.target" selectedGoalLabel,
      apiChip orangeFg "Hypothesis.fvarIds" selectedFvars,
      apiChip linkFg "React.onClick" "goal tabs",
      apiChip blueFg "Clipboard.writeText" "copy actions",
      apiChip greenFg "Command.revealPosition" "cursor"
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

def tokenView (value : String) : Html :=
  codeText #[Property.classList #["react-proof-token"], inlineTokenStyle] value

def tokenListView (values : Array String) (fallback : String) : Array Html :=
  match values.toList with
  | [] => #[tokenView fallback]
  | _ => values.map tokenView

def hypothesisChildren (hypothesis : Hypothesis) : Array Html :=
  let valueSuffix :=
    match hypothesis.value with
    | none => #[]
    | some value =>
        #[
          Html.span #[.text " := "],
          codeText #[Property.classList #["react-proof-hypothesis-value"], codeStyle] value
        ]
  #[
    Html.spanWith #[Property.classList #["react-proof-hypothesis-line"], hypothesisLineStyle] #[] <|
      #[
        codeText #[Property.classList #["react-proof-hypothesis-name"], codeStyle] (hypothesisLabel hypothesis),
        Html.span #[.text " : "],
        codeText #[Property.classList #["react-proof-hypothesis-type"], codeStyle] hypothesis.type
      ] ++ valueSuffix,
    Html.spanWith #[Property.classList #["react-proof-hypothesis-meta"], hypothesisMetaStyle] #[] <|
      #[Html.span #[.text "fvarIds"]] ++ tokenListView hypothesis.fvarIds "none"
  ]

def hypothesisView (hypothesis : Hypothesis) : Html :=
  Html.keyedLiWith hypothesis.id
    #[Property.classList #["react-proof-hypothesis"], Property.role "listitem", hypothesisStyle]
    #[]
    (hypothesisChildren hypothesis)

def hypothesesView (goal : Goal) : Html :=
  if goal.hypotheses.isEmpty then
    Html.pWith
      #[
        Property.id "react-proof-hypotheses",
        Property.classList #["react-proof-hypotheses", "is-empty"],
        emptyStateStyle
      ]
      #[]
      #[.text "No local hypotheses."]
  else
    Html.ulWith
      #[
        Property.id "react-proof-hypotheses",
        Property.classList #["react-proof-hypotheses"],
        Property.role "list",
        Property.ariaLabel ("Hypotheses for " ++ goal.title),
        hypothesesListStyle
      ]
      #[]
      (goal.hypotheses.map hypothesisView)

def selectedClasses (selected : Bool) : Array String :=
  if selected then
    #["react-proof-goal", "is-selected"]
  else
    #["react-proof-goal"]

def goalButton
    (selectGoal : String → IO Unit)
    (selectedId : String)
    (goal : Goal) : Html :=
  let selected := goal.id == selectedId
  Html.keyedLiWith goal.id
    #[Property.classList #["react-proof-goal-item"], Property.role "listitem"]
    #[]
    #[
      Html.buttonWith
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
        #[
          Html.spanWith #[Property.classList #["react-proof-goal-top"], goalButtonTopStyle] #[] #[
            Html.spanWith
              #[Property.classList #["react-proof-goal-title"]]
              #[]
              #[.text goal.title],
            Html.spanWith
              #[Property.classList #["react-proof-goal-status"], badgeStyle]
              #[]
              #[.text goal.status]
          ],
          Html.spanWith
            #[Property.classList #["react-proof-goal-meta"], goalMetaStyle]
            #[]
            #[.text (goalKindLabel goal ++ " · " ++ goalIdentity goal ++ " · " ++ s!"{goal.hypotheses.size} local")],
          Html.spanWith
            #[Property.classList #["react-proof-goal-target"], goalTargetPreviewStyle]
            #[]
            #[.text goal.target]
        ]
    ]

def goalList (surface : Surface) (selectGoal : String → IO Unit) (selectedId : String) : Html :=
  Html.ulWith
    #[
      Property.id "react-proof-goal-list",
      Property.classList #["react-proof-goal-list"],
      Property.role "list",
      Property.ariaLabel "Proof goals",
      goalListStyle
    ]
    #[]
    (surface.goals.map (goalButton selectGoal selectedId))

def summaryText (surface : Surface) (goal : Goal) : String :=
  let goalCount := surface.goals.size
  let hypCount := goal.hypotheses.size
  let totalHypCount := hypothesisCount surface
  s!"{goal.title}; {hypCount} local {plural hypCount "hypothesis" "hypotheses"}; {goalCount} {plural goalCount "goal" "goals"} / {totalHypCount} {plural totalHypCount "hypothesis" "hypotheses"} at {cursorLabel surface}"

def metricView (label value : String) : Html :=
  Html.divWith #[Property.classList #["react-proof-metric"], metricStyle] #[] #[
    Html.spanWith #[Property.classList #["react-proof-metric-label"], metricLabelStyle] #[] #[.text label],
    Html.strongWith #[Property.classList #["react-proof-metric-value"], metricValueStyle] #[] #[.text value]
  ]

def selectedHypothesisCountLabel (goal? : Option Goal) : String :=
  match goal? with
  | none => "0 local"
  | some goal => s!"{goal.hypotheses.size} local"

def metricGrid (surface : Surface) (goal? : Option Goal) : Html :=
  let goalCount := surface.goals.size
  Html.divWith #[Property.id "react-proof-metrics", Property.classList #["react-proof-metrics"], metricGridStyle] #[] #[
    metricView "Goals" s!"{goalCount} {plural goalCount "goal" "goals"}",
    metricView "Context" (selectedHypothesisCountLabel goal?),
    metricView "Selection" (selectedLocationCountLabel surface),
    metricView "Cursor" (cursorLabel surface)
  ]

def surfaceCell (label value : String) : Html :=
  Html.divWith #[Property.classList #["react-proof-surface-cell"], surfaceCellStyle] #[] #[
    Html.spanWith #[Property.classList #["react-proof-surface-label"], surfaceCellLabelStyle] #[] #[.text label],
    Html.spanWith #[Property.classList #["react-proof-surface-value"], surfaceCellValueStyle] #[] #[.text value]
  ]

def surfacePanel (surface : Surface) (goal : Goal) : Html :=
  Html.divWith
    #[
      Property.id "react-proof-surface-panel",
      Property.classList #["react-proof-surface-panel"],
      Property.ariaLabel "Selected infoview surface",
      surfacePanelStyle
    ]
    #[]
    #[
      surfaceCell "Selected" (selectionSummary surface),
      surfaceCell "selectedLocations" (selectedLocationIdsLabel surface),
      surfaceCell "mvarId" (optionLabel goal.mvarId),
      surfaceCell "userName" (optionLabel goal.userName),
      surfaceCell "kind" goal.kind,
      surfaceCell "fvarIds" s!"{fvarCount goal}"
    ]

def headerSummary (surface : Surface) (goal? : Option Goal) : String :=
  match goal? with
  | none => "No proof goals at " ++ cursorLabel surface
  | some goal => summaryText surface goal

def surfaceHeader (surface : Surface) (goal? : Option Goal) : Html :=
  Html.headerWith #[Property.classList #["react-proof-header"], headerStyle] #[] #[
    Html.divWith #[Property.classList #["react-proof-heading"]] #[] #[
      Html.pWith #[Property.classList #["react-proof-eyebrow"], eyebrowStyle] #[] #[.text "Live Lean infoview"],
      Html.h3With #[headingStyle] #[] #[.text "Live ProofWidget"],
      Html.pWith #[Property.classList #["react-proof-source"], sourceStyle] #[] #[
        Html.spanWith #[Property.classList #["react-proof-module"], badgeStyle] #[] #[.text "VIR"],
        Html.spanWith #[Property.classList #["react-proof-runtime"], badgeStyle] #[] #[.text "React"],
        Html.spanWith #[Property.classList #["react-proof-live"], badgeStyle] #[] #[.text "live"],
        Html.spanWith #[Property.classList #["react-proof-range"], badgeStyle] #[] #[.text (cursorLabel surface)]
      ],
      Html.pWith
        #[
          Property.id "react-proof-summary",
          Property.classList #["react-proof-summary"],
          Property.ariaLive "polite",
        summaryStyle
      ]
      #[]
      #[.text (headerSummary surface goal?)]
    ],
    Html.divWith #[Property.classList #["react-proof-header-side"]] #[] #[
      metricGrid surface goal?
    ]
  ]

def actionButton (id label : String) (onClick : IO Unit) : Html :=
  Html.buttonWith
    #[
      Property.id id,
      Property.classList #["react-proof-action"],
      Property.type "button",
      actionButtonStyle
    ]
    #[EventHandler.onClick onClick]
    #[.text label]

def actionBar
    (goal : Goal)
    (revealCursor : IO Unit)
    (copyCursor : IO Unit)
    (copySelection : IO Unit)
    (copyTarget : Goal → IO Unit)
    (copyContext : Goal → IO Unit)
    (actionStatus : String) : Html :=
  Html.divWith
    #[
      Property.classList #["react-proof-actions"],
      actionBarStyle
    ]
    #[]
    #[
      actionButton "react-proof-reveal-cursor" "Reveal cursor" revealCursor,
      actionButton "react-proof-copy-cursor" "Copy cursor" copyCursor,
      actionButton "react-proof-copy-selection" "Copy selection" copySelection,
      actionButton "react-proof-copy-target" "Copy target" (copyTarget goal),
      actionButton "react-proof-copy-context" "Copy context" (copyContext goal),
      Html.spanWith
        #[
          Property.id "react-proof-action-status",
          Property.classList #["react-proof-action-status"],
          Property.ariaLive "polite",
          actionStatusStyle
        ]
        #[]
        #[.text actionStatus]
    ]

def emptyView (surface : Surface) : Html :=
  Html.sectionWith
    #[
      Property.id "react-proof-widget",
      Property.classList #["react-proof-widget"],
      Property.role "region",
      Property.ariaLabel "Lean proof widget",
      widgetStyle
    ]
    #[]
    #[
      surfaceHeader surface none,
      apiStrip surface none,
      Html.pWith #[Property.classList #["react-proof-empty"], emptyStateStyle] #[] #[
        .text "The current infoview snapshot has no goals."
      ]
    ]

def detailView
    (surface : Surface)
    (goal : Goal)
    (revealCursor : IO Unit)
    (copyCursor : IO Unit)
    (copySelection : IO Unit)
    (copyTarget : Goal → IO Unit)
    (copyContext : Goal → IO Unit)
    (actionStatus : String) : Html :=
  Html.articleWith
    #[
      Property.id "react-proof-detail",
      Property.classList #["react-proof-detail"],
      Property.ariaLive "polite",
      detailStyle
    ]
    #[]
    #[
      Html.h3With #[Property.id "react-proof-selected-title", headingStyle] #[] #[.text goal.title],
      Html.pWith #[Property.classList #["react-proof-status-line"]] #[] #[
        Html.spanWith #[Property.id "react-proof-selected-status", badgeStyle] #[] #[.text goal.status],
        Html.spanWith #[Property.classList #["react-proof-selected-kind"], goalMetaStyle] #[] #[
          .text (" " ++ goalKindLabel goal ++ " · " ++ selectionSummary surface)
        ]
      ],
      surfacePanel surface goal,
      actionBar goal revealCursor copyCursor copySelection copyTarget copyContext actionStatus,
      Html.pWith #[Property.classList #["react-proof-panel-label"], panelLabelStyle] #[] #[.text "Target"],
      Html.preWith #[Property.id "react-proof-target", Property.classList #["react-proof-target"], targetStyle] #[] #[
        codeText #[Property.id "react-proof-target-code", codeStyle] goal.target
      ],
      Html.pWith #[Property.classList #["react-proof-panel-label"], panelLabelStyle] #[] #[.text "Local context"],
      hypothesesView goal
    ]

def view
    (surface : Surface)
    (selectGoal : String → IO Unit)
    (revealCursor : IO Unit)
    (copyCursor : IO Unit)
    (copySelection : IO Unit)
    (copyTarget : Goal → IO Unit)
    (copyContext : Goal → IO Unit)
    (state : WidgetState) : Html :=
  match selectedGoal? surface state.selectedGoalId with
  | none => emptyView surface
  | some goal =>
      Html.sectionWith
        #[
          Property.id "react-proof-widget",
          Property.classList #["react-proof-widget"],
          Property.role "region",
          Property.ariaLabel "Lean proof widget",
          widgetStyle
        ]
        #[]
        #[
          surfaceHeader surface (some goal),
          apiStrip surface (some goal),
          Html.divWith #[Property.classList #["react-proof-layout"], layoutStyle] #[] #[
            Html.divWith #[Property.classList #["react-proof-sidebar"], sidebarStyle] #[] #[
              Html.pWith #[Property.classList #["react-proof-panel-label"], panelLabelStyle] #[] #[.text "Goals"],
              goalList surface selectGoal state.selectedGoalId
            ],
            Html.divWith #[Property.classList #["react-proof-main"], mainStyle] #[] #[
              detailView surface goal revealCursor copyCursor copySelection copyTarget copyContext state.actionStatus
            ]
          ]
        ]

partial def renderInto
    (selector : String)
    (surface : Surface)
    (state : WidgetState) : IO Bool :=
  let commit (nextState : WidgetState) : IO Unit := do
    rememberState selector nextState
    let _ ← renderInto selector surface nextState
    pure ()
  let selectGoal (nextId : String) : IO Unit :=
    commit { state with selectedGoalId := nextId, actionStatus := "Ready" }
  let revealCursor : IO Unit := do
    let ok ← Lean.Vir.Infoview.Command.revealCursor surface
    commit { state with actionStatus := commandStatus "Reveal cursor" ok }
  let copyCursor : IO Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText (cursorClipboardText surface)
    commit { state with actionStatus := copyStatus "Cursor" ok }
  let copySelection : IO Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText (selectionClipboardText surface)
    commit { state with actionStatus := copyStatus "Selection" ok }
  let copyTarget (goal : Goal) : IO Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText goal.target
    commit { state with actionStatus := copyStatus "Target" ok }
  let copyContext (goal : Goal) : IO Unit := do
    let ok ← Lean.Vir.Infoview.Clipboard.writeText (goalClipboardText surface goal)
    commit { state with actionStatus := copyStatus "Context" ok }
  Root.renderIntoSelector selector <|
    view
      surface
      selectGoal
      revealCursor
      copyCursor
      copySelection
      copyTarget
      copyContext
      state

def mount (selector : String) (surface : Surface) : IO Bool := do
  let state ←
    match ← findState? selector with
    | some previous => pure (reconcileState surface previous)
    | none => pure (initialState surface)
  let mounted ← renderInto selector surface state
  if mounted then
    rememberState selector state
  pure mounted

def unmount (selector : String) : IO Bool := do
  let previous ← takeState? selector
  let unmounted ← Root.unmountSelector selector
  pure <| unmounted || previous.isSome

def irPackage : Lean.Vir.Infoview.IRPackage where
  roots := #[
    "ReactProofWidget.mount",
    "ReactProofWidget.unmount"
  ]

def infoviewDemoProps : Lean.Vir.Infoview.WidgetProps where
  wasmPath := "web/public/vir-upstream.wasm"
  irPackage := some irPackage
  entry := "ReactProofWidget.mount"
  unmountEntry := "ReactProofWidget.unmount"
  mountId := "vir-react-proof-widget"
  autoReloadMs := 1000
  setupHint :=
    "Run `npm run build:demo` to refresh the embedded infoview shell and web/public/vir-upstream.wasm. If this file was already open in VS Code, restart the Lean server or reopen the file."

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
session, so no local dev server is required. `ReactProofWidget.irPackage` is the
explicit widget activation package declaration. Its `.irpkg` payload is built
from the active Lean server snapshot and sent over the RPC channel when the
runtime service is first needed. `autoReloadMs` only performs a cheap package
stat after that; the stat token is derived from source ranges in the local
package closure, so ordinary proof edits outside the widget code do not rebuild
the package. Cursor navigation updates the proof surface without rebuilding the
package. The JavaScript shell passes the real infoview panel goals to
`ReactProofWidget.mount`.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidget.infoviewDemoProps]

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
