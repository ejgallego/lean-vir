/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactProofWidget

open Lean.Vir.React

-- Keep this example independent from any future ProofWidgets compatibility DSL.
def el
    (tag : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  Html.elementWith tag props handlers children

def keyedEl
    (tag key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  Html.keyedElementWith tag key props handlers children

def codeText (props : Array Property) (value : String) : Html :=
  el "code" props #[] #[.text value]

structure Hypothesis where
  id : String
  name : String
  type : String

structure Goal where
  id : String
  title : String
  status : String
  target : String
  hypotheses : List Hypothesis

def mainGoal : Goal :=
  {
    id := "main",
    title := "Main goal",
    status := "active",
    target := "xs.reverse.reverse = xs",
    hypotheses := [
      { id := "xs", name := "xs", type := "List Nat" }
    ]
  }

def stepGoal : Goal :=
  {
    id := "step",
    title := "Induction step",
    status := "needs simp",
    target := "(x :: xs).reverse.reverse = x :: xs",
    hypotheses := [
      { id := "x", name := "x", type := "Nat" },
      { id := "xs", name := "xs", type := "List Nat" },
      { id := "ih", name := "ih", type := "xs.reverse.reverse = xs" }
    ]
  }

def goals : List Goal :=
  [mainGoal, stepGoal]

def selectedGoal (selectedId : String) : Goal :=
  goals.find? (fun goal => goal.id == selectedId) |>.getD mainGoal

def hypothesisView (hypothesis : Hypothesis) : Html :=
  keyedEl "li" hypothesis.id
    #[Property.classList #["react-proof-hypothesis"], Property.role "listitem"]
    #[]
    #[
      codeText #[Property.classList #["react-proof-hypothesis-name"]] hypothesis.name,
      Html.span #[.text " : "],
      codeText #[Property.classList #["react-proof-hypothesis-type"]] hypothesis.type
    ]

def hypothesesView (goal : Goal) : Html :=
  el "ul"
    #[
      Property.id "react-proof-hypotheses",
      Property.classList #["react-proof-hypotheses"],
      Property.role "list",
      Property.ariaLabel ("Hypotheses for " ++ goal.title)
    ]
    #[]
    (goal.hypotheses.map hypothesisView |>.toArray)

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
  keyedEl "li" goal.id
    #[Property.classList #["react-proof-goal-item"], Property.role "listitem"]
    #[]
    #[
      Html.buttonWith
        #[
          Property.id ("react-proof-goal-" ++ goal.id),
          Property.classList (selectedClasses selected),
          Property.ariaPressed selected,
          Property.ariaSelected selected,
          Property.data "goal" goal.id
        ]
        #[EventHandler.onClick (selectGoal goal.id)]
        #[
          Html.spanWith
            #[Property.classList #["react-proof-goal-title"]]
            #[]
            #[.text goal.title],
          Html.spanWith
            #[Property.classList #["react-proof-goal-status"]]
            #[]
            #[.text goal.status]
        ]
    ]

def goalList (selectGoal : String → IO Unit) (selectedId : String) : Html :=
  el "ul"
    #[
      Property.id "react-proof-goal-list",
      Property.classList #["react-proof-goal-list"],
      Property.role "list",
      Property.ariaLabel "Proof goals"
    ]
    #[]
    (goals.map (goalButton selectGoal selectedId) |>.toArray)

def summaryText (goal : Goal) : String :=
  let count := goal.hypotheses.length
  let noun := if count == 1 then "hypothesis" else "hypotheses"
  s!"{goal.title}; {count} {noun}; status {goal.status}"

def detailView (goal : Goal) : Html :=
  el "article"
    #[
      Property.id "react-proof-detail",
      Property.classList #["react-proof-detail"],
      Property.ariaLive "polite"
    ]
    #[]
    #[
      el "h3" #[Property.id "react-proof-selected-title"] #[] #[.text ("Selected: " ++ goal.title)],
      el "p" #[Property.classList #["react-proof-status-line"]] #[] #[
        el "strong" #[] #[] #[.text "Status: "],
        Html.spanWith #[Property.id "react-proof-selected-status"] #[] #[.text goal.status]
      ],
      el "pre" #[Property.classList #["react-proof-target"]] #[] #[
        codeText #[Property.id "react-proof-target-code"] goal.target
      ],
      el "h3" #[] #[] #[.text "Local context"],
      hypothesesView goal
    ]

def view (selectGoal : String → IO Unit) (selectedId : String) : Html :=
  let goal := selectedGoal selectedId
  el "section"
    #[
      Property.id "react-proof-widget",
      Property.classList #["react-proof-widget"],
      Property.role "region",
      Property.ariaLabel "Proof widget example"
    ]
    #[]
    #[
      el "header" #[Property.classList #["react-proof-header"]] #[] #[
        el "h3" #[] #[] #[.text "Proof state"],
        el "p"
          #[
            Property.id "react-proof-summary",
            Property.classList #["react-proof-summary"],
            Property.ariaLive "polite"
          ]
          #[]
          #[.text (summaryText goal)]
      ],
      Html.divWith #[Property.classList #["react-proof-layout"]] #[] #[
        Html.divWith #[Property.classList #["react-proof-sidebar"]] #[] #[
          el "p" #[Property.classList #["react-proof-panel-label"]] #[] #[.text "Goals"],
          goalList selectGoal selectedId
        ],
        detailView goal
      ]
    ]

partial def renderInto (root : Root) (selectedId : String) : IO Unit :=
  Root.render root (view (fun nextId => renderInto root nextId) selectedId)

def mount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => renderInto root mainGoal.id

def mountDefault : IO Bool :=
  mount "#react-proof-root"

end ReactProofWidget
