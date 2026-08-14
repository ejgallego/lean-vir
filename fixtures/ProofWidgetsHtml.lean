/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.ProofWidgets

namespace ProofWidgetsHtml

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.ProofWidgets

structure StatProps where
  label : String
  value : String

def Stat : Component StatProps := fun ctx =>
  Html.liWith
    #[
      Attr.className "pw-html-stat",
      Attr.data "label" ctx.props.label
    ]
    #[
      Html.spanWith #[Attr.className "pw-html-stat-label"] #[Html.text ctx.props.label],
      Html.strongWith #[Attr.className "pw-html-stat-value"] #[Html.text ctx.props.value]
    ]

def View : Component Unit := fun _ =>
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
        Html.ofComponent Stat { label := "Elements", value := "5" },
        Html.ofComponent Stat { label := "Components", value := "1" },
        Html.liWith #[Attr.className "pw-html-stat"] #[
          Html.spanWith #[Attr.className "pw-html-stat-label"] #[Html.text "Text"],
          Html.strongWith #[Attr.className "pw-html-stat-value"] #[Html.text "native"]
        ]
      ],
      Html.element "code" #[Attr.className "pw-html-code"] #[
        Html.text "Html.element \"section\" attrs children"
      ]
    ]

def mount (selector : String) : DomM Bool :=
  Lean.Vir.React.Root.renderComponentIntoSelector selector View (componentProps ())

def mountDefault : DomM Bool :=
  mount "#proofwidgets-html-root"

end ProofWidgetsHtml
