/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.ProofWidgets

namespace ProofWidgetsJsxSubset

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.ProofWidgets
open scoped ProofWidgets.Jsx

/-!
Native VIR port of the static surface from upstream
`ProofWidgets/Demos/Jsx.lean`, including attributes, components, callbacks,
keys, and child / prop spreads.
-/

structure CardProps where
  title : String

def Card : Component CardProps := .named "ProofWidgetsJsxSubset.Card" fun ctx =>
  <section id="proofwidgets-jsx-card" className="pw-jsx-card"
      {...#[Lean.Vir.React.Props.data "component" "Card"]}>
    <h3 className="pw-jsx-card-title">{Html.text ctx.props.title}</h3>
    <div id="proofwidgets-jsx-card-body" className="pw-jsx-card-body">
      {...ctx.children}
    </div>
  </section>

structure MarkdownProps where
  contents : String

def MarkdownDisplay : Component MarkdownProps := .named "ProofWidgetsJsxSubset.MarkdownDisplay" fun ctx =>
  <section id="proofwidgets-jsx-markdown" className="pw-jsx-markdown"
      {...#[Lean.Vir.React.Props.data "component" "MarkdownDisplay"]}>
    <h3 className="pw-jsx-markdown-title">MarkdownDisplay</h3>
    <pre className="pw-jsx-markdown-source">{Html.text ctx.props.contents}</pre>
  </section>

def htmlLetters : Array Html := #[
  <span id="proofwidgets-jsx-letter-h" style={#[("color", "red")]}>H</span>,
  <span id="proofwidgets-jsx-letter-t" style={#[("color", "yellow")]}>T</span>,
  <span id="proofwidgets-jsx-letter-m" style={#[("color", "green")]}>M</span>,
  <span id="proofwidgets-jsx-letter-l" style={#[("color", "blue")]}>L</span>
]

def htmlHeadline : Html :=
  <b id="proofwidgets-jsx-headline">What, HTML in Lean?!</b>

def parrotImage : Html :=
  <img id="proofwidgets-jsx-parrot"
    src={"https://" ++ "upload.wikimedia.org/wikipedia/commons/a/a5/Parrot_montage.jpg"}
    alt="Six photos of parrots arranged in a grid." />

def spreadInterpolation : Html :=
  <b id="proofwidgets-jsx-spread">You can use {...htmlLetters} in Lean {Html.text s!"{1 + 3}! "}<hr id="proofwidgets-jsx-divider" /></b>

def markdownExample : Html :=
  <MarkdownDisplay contents={"
  ## Hello, Markdown
  We have **bold text**, _italic text_, `example : True := by trivial`,
  and $3*19 = \\int\\limits_0^{57}1~dx$.
"} />

structure BadgeProps where
  tone : String
  label : String

def Badge : Component BadgeProps := .named "ProofWidgetsJsxSubset.Badge" fun ctx =>
  <span id={"proofwidgets-jsx-badge-" ++ ctx.props.tone}
      className={"pw-jsx-badge pw-jsx-badge-" ++ ctx.props.tone}
      {...#[Lean.Vir.React.Props.data "tone" ctx.props.tone]}>
    {Html.text ctx.props.label}{...ctx.children}
  </span>

def sampleExpr : WithRpcRef ExprWithCtx :=
  ExprWithCtx.save
    "jsx-demo.expr.successor"
    "fun x => x + 1"
    "Nat -> Nat"
    "A sample expression reference from the JSX subset demo."

structure InteractiveExprProps where
  expr : WithRpcRef ExprWithCtx

def InteractiveExpr : Component InteractiveExprProps :=
    .named "ProofWidgetsJsxSubset.InteractiveExpr" fun ctx => do
  let initialStatus ← JsValue.ofString "ready"
  let status ← Lean.Vir.React.StateTuple.toState
    (← Lean.Vir.React.Hooks.useState initialStatus)
  let statusText ← JsValue.toString status.value
  Html.buttonWith
    #[
      Attr.id "proofwidgets-jsx-interactive-expr",
      Attr.className "pw-jsx-interactive-expr",
      Attr.title ctx.props.expr.ref.summary,
      Attr.data "component" "InteractiveExpr",
      Attr.data "rpc-ref" ctx.props.expr.ref.id,
      Attr.data "type" ctx.props.expr.value.typeText
    ]
    #[Handler.onClick do
      let loading ← JsValue.ofString "resolving..."
      Lean.Vir.React.State.set status loading
      let ok ← Rpc.resolve ctx.props.expr fun info => do
        let resolved ← JsValue.ofString info.statusText
        Lean.Vir.React.State.set status resolved
      if !ok then
        let failed ← JsValue.ofString "RPC unavailable"
        Lean.Vir.React.State.set status failed]
    #[
      Html.spanWith #[Attr.className "pw-jsx-interactive-label"] #[
        Html.text "InteractiveExpr "
      ],
      Html.element "code" #[Attr.className "pw-jsx-interactive-code"] #[
        Html.text ctx.props.expr.value.code
      ],
      Html.spanWith
        #[Attr.id "proofwidgets-jsx-interactive-status", Attr.className "pw-jsx-interactive-status"]
        #[
          Html.text (" " ++ statusText)
        ]
    ]

def row (key label value : String) : Html :=
  <li key={key} className="pw-jsx-row">
    <strong className="pw-jsx-row-label">{Html.text label}</strong>
    <span className="pw-jsx-row-value">{Html.text value}</span>
  </li>

def View : Component Unit := .named "ProofWidgetsJsxSubset.View" fun _ => do
  let renderedRows := 3
  let surfaceProps : Array PropEntry := #[
    Lean.Vir.React.Props.role "region",
    Lean.Vir.React.Props.ariaLabel "ProofWidgets JSX subset combinator demo"
  ]
  let view : Html := <section {...surfaceProps} id="proofwidgets-jsx-subset"
      dataTestId="proofwidgets-jsx-subset">
    <Card title="JSX-shaped combinators">
      {htmlHeadline}{parrotImage}{spreadInterpolation}{markdownExample}
      <Badge key="info-badge" tone="info" label="component"> children</Badge>
      <InteractiveExpr expr={sampleExpr} />
      <button id="proofwidgets-jsx-action" className="pw-jsx-action"
          onClick={do
            let title ← Lean.Vir.JsValue.ofString "ProofWidgets JSX subset clicked"
            Lean.Vir.Browser.Document.setTitle title}>
        {Html.text "mark"}
      </button>
      <ul id="proofwidgets-jsx-rows" className="pw-jsx-rows">
        {row "tags" "lowercase tags" "b, img, span, hr"}
        {row "components" "uppercase components" "Card, MarkdownDisplay, Badge, InteractiveExpr"}
        {row "interpolation" "interpolation" s!"{renderedRows} rendered rows"}
      </ul>
    </Card>
  </section>
  view

def mount (selector : String) : DomM Bool :=
  Lean.Vir.React.Root.renderComponentIntoSelector selector View (componentProps ())

def mountDefault : DomM Bool :=
  mount "#proofwidgets-jsx-subset-root"

end ProofWidgetsJsxSubset
