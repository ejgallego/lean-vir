/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.ProofWidgets

public section

namespace ProofWidgetsHtml

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.ProofWidgets

structure StatProps where
  label : String
  value : String

def Stat : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData StatProps)) :=
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
    let data ← Lean.Vir.React.Props.WithData.data nativeProps
    let props ← Lean.Vir.LeanRef.fromJSL data
    Html.elementWithProps "li" #[
      Lean.Vir.React.Props.className "pw-html-stat",
      Lean.Vir.React.Props.data "label" props.label
    ] #[
      Html.elementWithProps "span" #[Lean.Vir.React.Props.className "pw-html-stat-label"] #[Html.text props.label],
      Html.elementWithProps "strong" #[Lean.Vir.React.Props.className "pw-html-stat-value"] #[Html.text props.value]
    ]

def View : RuntimeM (Lean.Vir.React.FunctionComponent Lean.Vir.React.Props) := do
  let stat ← Stat
  Lean.Vir.React.FunctionComponent.ofLean fun _ =>
    Html.elementWithProps "section"
    #[
      Lean.Vir.React.Props.id "proofwidgets-html-demo",
      Lean.Vir.React.Props.role "region",
      Lean.Vir.React.Props.ariaLabel "ProofWidgets HTML facade demo",
      Lean.Vir.React.Props.classList #["pw-html-demo", "is-live"],
      Lean.Vir.React.Props.dataTestId "proofwidgets-html"
    ]
    #[
      Html.elementWithProps "h3" #[Lean.Vir.React.Props.className "pw-html-title"] #[
        Html.text "ProofWidgets-style Html"
      ],
      Html.elementWithProps "p" #[Lean.Vir.React.Props.className "pw-html-summary"] #[
        Html.text "This tree is written through a shallow Html facade and rendered as native React nodes."
      ],
      Html.elementWithProps "ul" #[Lean.Vir.React.Props.className "pw-html-stats"] #[
        (do Html.component stat (← Lean.Vir.LeanRef.toJSL { label := "Elements", value := "5" })),
        (do Html.component stat (← Lean.Vir.LeanRef.toJSL { label := "Components", value := "1" })),
        Html.elementWithProps "li" #[Lean.Vir.React.Props.className "pw-html-stat"] #[
          Html.elementWithProps "span" #[Lean.Vir.React.Props.className "pw-html-stat-label"] #[Html.text "Text"],
          Html.elementWithProps "strong" #[Lean.Vir.React.Props.className "pw-html-stat-value"] #[Html.text "native"]
        ]
      ],
      Html.elementWithProps "code" #[Lean.Vir.React.Props.className "pw-html-code"] #[
        Html.text "Html.elementWithProps \"section\" props children"
      ]
    ]

def mount (selector : String) : DomM Bool := do
  let component ← View
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.React.ReactM.run Lean.Vir.React.Props.empty
      let children ← Lean.Vir.Js.Array.ofArray #[]
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.functionComponent component props children)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#proofwidgets-html-root"

end ProofWidgetsHtml
