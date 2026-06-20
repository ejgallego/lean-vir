/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.ProofWidgets

namespace ProofWidgetsJsxSubset

open Lean.Vir.Browser (DomM)
open Lean.Vir.ProofWidgets

/-!
Combinator-only port of the static surface from upstream
`ProofWidgets/Demos/Jsx.lean`.

The upstream file demonstrates JSX notation. This fixture keeps the same shape
with explicit `Html` combinators so the compatibility layer can grow from real
ProofWidgets examples before adding syntax sugar.
-/

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

structure MarkdownProps where
  contents : String

def MarkdownDisplay : Component MarkdownProps := fun ctx =>
  Html.sectionWith
    #[
      Attr.id "proofwidgets-jsx-markdown",
      Attr.className "pw-jsx-markdown",
      Attr.data "component" "MarkdownDisplay"
    ]
    #[
      Html.h3With #[Attr.className "pw-jsx-markdown-title"] #[Html.text "MarkdownDisplay"],
      Html.element "pre" #[Attr.className "pw-jsx-markdown-source"] #[
        Html.text ctx.props.contents
      ]
    ]

def htmlLetters : Array Html := #[
  Html.spanWith
    #[Attr.id "proofwidgets-jsx-letter-h", Attr.stylePairs #[("color", "red")]]
    #[Html.text "H"],
  Html.spanWith
    #[Attr.id "proofwidgets-jsx-letter-t", Attr.stylePairs #[("color", "yellow")]]
    #[Html.text "T"],
  Html.spanWith
    #[Attr.id "proofwidgets-jsx-letter-m", Attr.stylePairs #[("color", "green")]]
    #[Html.text "M"],
  Html.spanWith
    #[Attr.id "proofwidgets-jsx-letter-l", Attr.stylePairs #[("color", "blue")]]
    #[Html.text "L"]
]

def htmlHeadline : Html :=
  Html.bWith #[Attr.id "proofwidgets-jsx-headline"] #[
    Html.text "What, HTML in Lean?!"
  ]

def parrotImage : Html :=
  Html.img #[
    Attr.id "proofwidgets-jsx-parrot",
    Attr.src ("https://" ++ "upload.wikimedia.org/wikipedia/commons/a/a5/Parrot_montage.jpg"),
    Attr.alt "Six photos of parrots arranged in a grid."
  ]

def spreadInterpolation : Html :=
  Html.bWith #[Attr.id "proofwidgets-jsx-spread"] <|
    #[Html.text "You can use "] ++
    htmlLetters ++
    #[
      Html.text s!" in Lean {1 + 3}! ",
      Html.hr #[Attr.id "proofwidgets-jsx-divider"]
    ]

def markdownExample : Html :=
  Html.ofComponent MarkdownDisplay {
    contents := "
  ## Hello, Markdown
  We have **bold text**, _italic text_, `example : True := by trivial`,
  and $3*19 = \\int\\limits_0^{57}1~dx$.
"
  }

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

structure ExprPreview where
  code : String
  type : String

def sampleExpr : WithRpcRef ExprPreview :=
  {
    value := { code := "fun x => x + 1", type := "Nat -> Nat" },
    ref := {
      id := "jsx-demo.expr.successor",
      label := "fun x => x + 1",
      typeName := "ExprWithCtx",
      summary := "A sample expression reference from the JSX subset demo."
    }
  }

structure InteractiveExprProps where
  expr : WithRpcRef ExprPreview

def InteractiveExpr : Component InteractiveExprProps := fun ctx =>
  Html.buttonWith
    #[
      Attr.id "proofwidgets-jsx-interactive-expr",
      Attr.className "pw-jsx-interactive-expr",
      Attr.title ctx.props.expr.ref.summary,
      Attr.data "component" "InteractiveExpr",
      Attr.data "rpc-ref" ctx.props.expr.ref.id,
      Attr.data "type" ctx.props.expr.value.type
    ]
    #[Handler.onClick do
      discard <| Rpc.inspect ctx.props.expr]
    #[
      Html.spanWith #[Attr.className "pw-jsx-interactive-label"] #[
        Html.text "InteractiveExpr "
      ],
      Html.element "code" #[Attr.className "pw-jsx-interactive-code"] #[
        Html.text ctx.props.expr.value.code
      ]
    ]

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
        htmlHeadline,
        parrotImage,
        spreadInterpolation,
        markdownExample,
        Html.ofComponent Badge { tone := "info", label := "component" } #[
          Html.text " children"
        ],
        Html.ofComponent InteractiveExpr { expr := sampleExpr },
        Html.buttonWith
          #[Attr.id "proofwidgets-jsx-action", Attr.className "pw-jsx-action"]
          #[Handler.onClick do
            Lean.Vir.Browser.Document.setTitle "ProofWidgets JSX subset clicked"]
          #[Html.text "mark"],
        Html.ulWith #[Attr.id "proofwidgets-jsx-rows", Attr.className "pw-jsx-rows"] #[
          row "tags" "lowercase tags" "b, img, span, hr",
          row "components" "uppercase components" "Card, MarkdownDisplay, Badge, InteractiveExpr",
          row "interpolation" "interpolation" s!"{renderedRows} rendered rows"
        ]
      ]
    ]

def mount (selector : String) : DomM Bool :=
  Lean.Vir.React.Root.renderComponentIntoSelector selector View (componentProps ())

def mountDefault : DomM Bool :=
  mount "#proofwidgets-jsx-subset-root"

end ProofWidgetsJsxSubset
