/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Infoview
import Vir.React

namespace ReactProofWidgetHello

open Lean.Vir.React
open Lean.Vir.Infoview (Goal Hypothesis Surface)

namespace Style

def style (entries : Array (String × String)) : Property :=
  Property.style <| entries.map fun (name, value) => { name, value }

def vscodeColor (name fallback : String) : String :=
  "var(--vscode-" ++ name ++ ", " ++ fallback ++ ")"

def fg : String := vscodeColor "editor-foreground" "#24292f"
def mutedFg : String := vscodeColor "descriptionForeground" "#57606a"
def panelBg : String := vscodeColor "editorWidget-background" "#ffffff"
def editorBg : String := vscodeColor "editor-background" "#ffffff"
def codeBg : String := vscodeColor "textCodeBlock-background" "#f6f8fa"
def borderColor : String := vscodeColor "editorWidget-border" "#d0d7de"

def border : String :=
  "1px solid " ++ borderColor

def shell : Property := style #[
  ("display", "grid"),
  ("gap", "10px"),
  ("minWidth", "0"),
  ("padding", "12px"),
  ("border", border),
  ("borderRadius", "8px"),
  ("background", panelBg),
  ("color", fg),
  ("colorScheme", "light dark"),
  ("fontFamily", "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
]

def title : Property := style #[
  ("margin", "0"),
  ("fontSize", "1rem"),
  ("fontWeight", "780"),
  ("lineHeight", "1.25")
]

def summary : Property := style #[
  ("margin", "0"),
  ("color", mutedFg),
  ("fontSize", "0.82rem"),
  ("fontWeight", "650"),
  ("lineHeight", "1.35"),
  ("overflowWrap", "anywhere")
]

def grid : Property := style #[
  ("display", "grid"),
  ("gridTemplateColumns", "repeat(auto-fit, minmax(110px, 1fr))"),
  ("gap", "1px"),
  ("overflow", "hidden"),
  ("border", border),
  ("borderRadius", "8px"),
  ("background", borderColor)
]

def metric : Property := style #[
  ("display", "grid"),
  ("gap", "3px"),
  ("minWidth", "0"),
  ("padding", "8px 10px"),
  ("background", editorBg)
]

def metricLabel : Property := style #[
  ("color", mutedFg),
  ("fontSize", "0.66rem"),
  ("fontWeight", "780"),
  ("textTransform", "uppercase")
]

def metricValue : Property := style #[
  ("overflow", "hidden"),
  ("textOverflow", "ellipsis"),
  ("whiteSpace", "nowrap"),
  ("fontSize", "0.82rem"),
  ("fontWeight", "720")
]

def pre : Property := style #[
  ("margin", "0"),
  ("padding", "10px"),
  ("overflow", "auto"),
  ("border", border),
  ("borderRadius", "6px"),
  ("background", codeBg),
  ("color", fg),
  ("fontFamily", "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  ("fontSize", "0.78rem"),
  ("lineHeight", "1.35")
]

end Style

open Style

def plural (count : Nat) (one many : String) : String :=
  if count == 1 then one else many

def hypothesisCount (surface : Surface) : Nat :=
  surface.goals.foldl (init := 0) fun count goal => count + goal.hypotheses.size

def hypothesisLabel (hypothesis : Hypothesis) : String :=
  match hypothesis.names.toList with
  | [] => hypothesis.id
  | names => " ".intercalate names

def goalTitle (goal : Goal) : String :=
  match goal.userName with
  | some userName => "case " ++ userName
  | none => goal.title

def goalSummary (goal : Goal) : String :=
  goalTitle goal ++ " - " ++ goal.status

def firstGoalSummary (surface : Surface) : String :=
  match surface.goals[0]? with
  | none => "No proof goals at " ++ surface.cursor.label
  | some goal => goalSummary goal

def firstHypothesisSummary (goal : Goal) : String :=
  match goal.hypotheses[0]? with
  | none => "No local hypotheses."
  | some hypothesis => hypothesisLabel hypothesis ++ " : " ++ hypothesis.type

def metric (label value : String) : Html :=
  Html.divWith #[Style.metric] #[] #[
    Html.spanWith #[Style.metricLabel] #[] #[.text label],
    Html.strongWith #[Style.metricValue] #[] #[.text value]
  ]

def metrics (surface : Surface) : Html :=
  let goalCount := surface.goals.size
  let hypCount := hypothesisCount surface
  let selectionCount := surface.selections.size
  Html.divWith #[Property.id "react-proof-hello-metrics", Style.grid] #[] #[
    metric "Goals" s!"{goalCount} {plural goalCount "goal" "goals"}",
    metric "Hypotheses" s!"{hypCount}",
    metric "Selection" s!"{selectionCount}",
    metric "Cursor" surface.cursor.label
  ]

def goalDetails (surface : Surface) : Html :=
  match surface.goals[0]? with
  | none =>
      Html.pWith #[Property.id "react-proof-hello-empty", Style.summary] #[] #[
        .text "Move the cursor into a proof to see its first goal."
      ]
  | some goal =>
      Html.articleWith #[Property.id "react-proof-hello-goal"] #[] #[
        Html.pWith #[Property.id "react-proof-hello-goal-title", Style.summary] #[] #[
          .text (goalSummary goal)
        ],
        Html.preWith #[Property.id "react-proof-hello-target", Style.pre] #[] #[
          .text goal.target
        ],
        Html.pWith #[Property.id "react-proof-hello-hypothesis", Style.summary] #[] #[
          .text (firstHypothesisSummary goal)
        ]
      ]

def view (surface : Surface) : Html :=
  Html.sectionWith
    #[
      Property.id "react-proof-hello",
      Property.role "region",
      Property.ariaLabel "Minimal Lean proof widget",
      Style.shell
    ]
    #[]
    #[
      Html.h3With #[Property.id "react-proof-hello-title", Style.title] #[] #[
        .text "Hello ProofWidget"
      ],
      Html.pWith #[Property.id "react-proof-hello-summary", Style.summary] #[] #[
        .text (firstGoalSummary surface)
      ],
      metrics surface,
      goalDetails surface
    ]

def render (surface : Surface) : Html :=
  view surface

def mount (selector : String) (surface : Surface) : IO Bool := do
  Root.renderIntoSelector selector (render surface)

def unmount (selector : String) : IO Bool :=
  Root.unmountSelector selector

def irPackage : Lean.Vir.Infoview.IRPackage where
  roots := #[
    "ReactProofWidgetHello.mount",
    "ReactProofWidgetHello.unmount"
  ]

def infoviewDemoProps : Lean.Vir.Infoview.WidgetProps where
  wasmPath := "web/public/vir-upstream.wasm"
  irPackage := some irPackage
  entry := "ReactProofWidgetHello.mount"
  unmountEntry := "ReactProofWidgetHello.unmount"
  mountId := "vir-react-proof-widget-hello"
  autoReloadMs := 1000
  setupHint :=
    "Run `npm run build:demo` to refresh the embedded infoview shell and web/public/vir-upstream.wasm. If this file was already open in VS Code, restart the Lean server or reopen the file."

end ReactProofWidgetHello

/-!
This is the smallest live VIR proof-widget example. It demonstrates the
required shape:

- a `String -> Surface -> IO Bool` mount entry;
- a matching `String -> IO Bool` unmount entry;
- a file-local `IRPackage` that names those entries;
- a `show_panel_widgets` command that loads the package in the infoview.

For a fuller API showcase, see `examples/ReactProofWidget.lean`.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with ReactProofWidgetHello.infoviewDemoProps]

section Playground

theorem proofWidgetHello_and_comm (p q : Prop) : p ∧ q → q ∧ p := by
  intro h
  constructor
  · exact h.right
  · exact h.left

theorem proofWidgetHello_add_zero (n : Nat) : n + 0 = n := by
  exact Nat.add_zero n

end Playground
