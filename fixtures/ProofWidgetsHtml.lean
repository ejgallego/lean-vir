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

def Stat : RuntimeM (Component StatProps) := Component.ofLean fun ctx =>
  Html.liWith
    #[
      Attr.className "pw-html-stat",
      Attr.data "label" ctx.props.label
    ]
    #[
      Html.spanWith #[Attr.className "pw-html-stat-label"] #[Html.text ctx.props.label],
      Html.strongWith #[Attr.className "pw-html-stat-value"] #[Html.text ctx.props.value]
    ]

def View : RuntimeM (Component Unit) := do
  let stat ← Stat
  Component.ofLean fun _ =>
    Html.sectionWith
    #[
      Attr.id "proofwidgets-html-demo",
      Attr.role "region",
      Attr.ariaLabel "ProofWidgets HTML facade demo",
      Attr.classList #["pw-html-demo", "is-live"],
      Attr.dataTestId "proofwidgets-html"
    ]
    #[
      Html.h3With #[Attr.className "pw-html-title"] #[
        Html.text "ProofWidgets-style Html"
      ],
      Html.pWith #[Attr.className "pw-html-summary"] #[
        Html.text "This tree is written through a shallow Html facade and rendered as native React nodes."
      ],
      Html.ulWith #[Attr.className "pw-html-stats"] #[
        Html.ofComponent stat { label := "Elements", value := "5" },
        Html.ofComponent stat { label := "Components", value := "1" },
        Html.liWith #[Attr.className "pw-html-stat"] #[
          Html.spanWith #[Attr.className "pw-html-stat-label"] #[Html.text "Text"],
          Html.strongWith #[Attr.className "pw-html-stat-value"] #[Html.text "native"]
        ]
      ],
      Html.element "code" #[Attr.className "pw-html-code"] #[
        Html.text "Html.element \"section\" attrs children"
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
      let props ← Lean.Vir.LeanRef.toJSL (componentProps ())
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#proofwidgets-html-root"

end ProofWidgetsHtml
