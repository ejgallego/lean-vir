/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.ProofWidgets

namespace ProofWidgetsJsxSubset

open Lean.Vir.Browser (DomM)
open Lean.Vir.ProofWidgets

structure CardProps where
  title : String

def Card : Component CardProps := fun ctx =>
  Html.sectionWith
    #[
      Attr.id "proofwidgets-jsx-card",
      Attr.className "pw-jsx-card",
      Attr.data "component" "Card"
    ]
    #[
      Html.h3With #[Attr.className "pw-jsx-card-title"] #[Html.text ctx.props.title],
      Html.divWith #[Attr.id "proofwidgets-jsx-card-body", Attr.className "pw-jsx-card-body"] ctx.children
    ]

structure BadgeProps where
  tone : String
  label : String

def Badge : Component BadgeProps := fun ctx =>
  Html.spanWith
    #[
      Attr.id ("proofwidgets-jsx-badge-" ++ ctx.props.tone),
      Attr.className ("pw-jsx-badge pw-jsx-badge-" ++ ctx.props.tone),
      Attr.data "tone" ctx.props.tone
    ]
    (#[Html.text ctx.props.label] ++ ctx.children)

def row (key label value : String) : Html :=
  Html.keyedElement "li" key #[Attr.className "pw-jsx-row"] #[
    Html.strongWith #[Attr.className "pw-jsx-row-label"] #[Html.text label],
    Html.spanWith #[Attr.className "pw-jsx-row-value"] #[Html.text value]
  ]

def View : Component Unit := fun _ => do
  let renderedRows := 3
  Html.sectionWith
    #[
      Attr.id "proofwidgets-jsx-subset",
      Attr.role "region",
      Attr.ariaLabel "ProofWidgets JSX subset combinator demo",
      Attr.dataTestId "proofwidgets-jsx-subset"
    ]
    #[
      Html.ofComponent Card { title := "JSX-shaped combinators" } #[
        Html.pWith #[Attr.className "pw-jsx-copy"] #[
          Html.text "Lowercase tags become Html.element calls; uppercase tags become Html.ofComponent calls."
        ],
        Html.ofComponent Badge { tone := "info", label := "component" } #[
          Html.text " children"
        ],
        Html.buttonWith
          #[Attr.id "proofwidgets-jsx-action", Attr.className "pw-jsx-action"]
          #[Handler.onClick do
            Lean.Vir.Browser.Document.setTitle "ProofWidgets JSX subset clicked"]
          #[Html.text "mark"],
        Html.ulWith #[Attr.id "proofwidgets-jsx-rows", Attr.className "pw-jsx-rows"] #[
          row "tags" "lowercase tags" "section, p, ul, li",
          row "components" "uppercase components" "Card, Badge",
          row "interpolation" "interpolation" s!"{renderedRows} rendered rows"
        ]
      ]
    ]

def mount (selector : String) : DomM Bool :=
  Lean.Vir.React.Root.renderComponentIntoSelector selector View (componentProps ())

def mountDefault : DomM Bool :=
  mount "#proofwidgets-jsx-subset-root"

end ProofWidgetsJsxSubset
