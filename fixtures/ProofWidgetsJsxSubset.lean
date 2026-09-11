/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.ProofWidgets

public section

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

def Card : RuntimeM (Component CardProps) := Component.ofLean fun ctx =>
  <section id="proofwidgets-jsx-card" className="pw-jsx-card"
      {...#[Lean.Vir.React.Props.data "component" "Card"]}>
    <h3 className="pw-jsx-card-title">{Html.text ctx.props.title}</h3>
    <div id="proofwidgets-jsx-card-body" className="pw-jsx-card-body">
      {...ctx.children}
    </div>
  </section>

structure MarkdownProps where
  contents : String

def MarkdownDisplay : RuntimeM (Component MarkdownProps) := Component.ofLean fun ctx =>
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

def markdownExample (MarkdownDisplay : Component MarkdownProps) : Html :=
  <MarkdownDisplay contents={"
  ## Hello, Markdown
  We have **bold text**, _italic text_, `example : True := by trivial`,
  and $3*19 = \\int\\limits_0^{57}1~dx$.
"} />

structure BadgeProps where
  tone : String
  label : String

def Badge : RuntimeM (Component BadgeProps) := Component.ofLean fun ctx =>
  <span id={"proofwidgets-jsx-badge-" ++ ctx.props.tone}
      className={"pw-jsx-badge pw-jsx-badge-" ++ ctx.props.tone}
      {...#[Lean.Vir.React.Props.data "tone" ctx.props.tone]}>
    {Html.text ctx.props.label}{...ctx.children}
  </span>

def row (key label value : String) : Html :=
  <li key={key} className="pw-jsx-row">
    <strong className="pw-jsx-row-label">{Html.text label}</strong>
    <span className="pw-jsx-row-value">{Html.text value}</span>
  </li>

-- Uppercase JSX tags consume these local component values during macro expansion,
-- which Lean's unused-variable linter does not count as an explicit reference.
set_option linter.unusedVariables false in
def View : RuntimeM (Component Unit) := do
  let Card ← Card
  let MarkdownDisplay ← MarkdownDisplay
  let Badge ← Badge
  Component.ofLean fun _ => do
    let renderedRows := 3
    let surfaceProps : Array PropEntry := #[
      Lean.Vir.React.Props.role "region",
      Lean.Vir.React.Props.ariaLabel "ProofWidgets JSX subset combinator demo"
    ]
    let view : Html := <section {...surfaceProps} id="proofwidgets-jsx-subset"
        dataTestId="proofwidgets-jsx-subset">
      <Card title="JSX-shaped combinators">
        {htmlHeadline}{parrotImage}{spreadInterpolation}{markdownExample MarkdownDisplay}
        <Badge key="info-badge" tone="info" label="component"> children</Badge>
        <button id="proofwidgets-jsx-action" className="pw-jsx-action"
            onClick={do
              let title ← Lean.Vir.JsValue.ofString "ProofWidgets JSX subset clicked"
              Lean.Vir.Browser.Document.setTitle
                (← Lean.Vir.Browser.Document.current) title}>
          {Html.text "mark"}
        </button>
        <ul id="proofwidgets-jsx-rows" className="pw-jsx-rows">
          {row "tags" "lowercase tags" "b, img, span, hr"}
          {row "components" "uppercase components" "Card, MarkdownDisplay, Badge"}
          {row "interpolation" "interpolation" s!"{renderedRows} rendered rows"}
        </ul>
      </Card>
    </section>
    view

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
  mount "#proofwidgets-jsx-subset-root"

end ProofWidgetsJsxSubset
