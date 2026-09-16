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
open Lean.Vir.React
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

/-!
Native VIR port of the static surface from upstream
`ProofWidgets/Demos/Jsx.lean`, including attributes, components, callbacks,
keys, child iteration, and exact native props.
-/

structure CardProps where
  title : String

def Card : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData CardProps)) :=
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
  let data ← Lean.Vir.React.Props.WithData.data nativeProps
  let ctx ← Lean.Vir.LeanRef.fromJSL data
  let children ← Lean.Vir.React.Props.WithData.children nativeProps
  let props ← js%{
    "id" := js#"proofwidgets-jsx-card",
    "className" := js#"pw-jsx-card",
    "data-component" := js#"Card"
  }
  return ← <section @props={props}>
    <h3 className="pw-jsx-card-title">{Html.text ctx.title}</h3>
    <div id="proofwidgets-jsx-card-body" className="pw-jsx-card-body">
      {children}
    </div>
  </section>

structure MarkdownProps where
  contents : String

def MarkdownDisplay : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData MarkdownProps)) :=
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
  let data ← Lean.Vir.React.Props.WithData.data nativeProps
  let ctx ← Lean.Vir.LeanRef.fromJSL data
  let props ← js%{
    "id" := js#"proofwidgets-jsx-markdown",
    "className" := js#"pw-jsx-markdown",
    "data-component" := js#"MarkdownDisplay"
  }
  return ← <section @props={props}>
    <h3 className="pw-jsx-markdown-title">MarkdownDisplay</h3>
    <pre className="pw-jsx-markdown-source">{Html.text ctx.contents}</pre>
  </section>

def htmlLetters : Lean.Vir.React.ReactM (Js.Array Node) := do
  js#[← (do
    let style ← js%{ "color" := js#"red" }
    return ← <span key="h" id="proofwidgets-jsx-letter-h" style={style}>H</span>),
  ← (do
    let style ← js%{ "color" := js#"yellow" }
    return ← <span key="t" id="proofwidgets-jsx-letter-t" style={style}>T</span>),
  ← (do
    let style ← js%{ "color" := js#"green" }
    return ← <span key="m" id="proofwidgets-jsx-letter-m" style={style}>M</span>),
  ← (do
    let style ← js%{ "color" := js#"blue" }
    return ← <span key="l" id="proofwidgets-jsx-letter-l" style={style}>L</span>)]

def htmlHeadline : Html :=
  <b id="proofwidgets-jsx-headline">What, HTML in Lean?!</b>

def parrotImage : Html :=
  <img id="proofwidgets-jsx-parrot"
    src={← JsValue.ofString ("https://" ++ "upload.wikimedia.org/wikipedia/commons/a/a5/Parrot_montage.jpg")}
    alt="Six photos of parrots arranged in a grid." />

def arrayInterpolation : Html :=
  <b id="proofwidgets-jsx-array">You can use {htmlLetters} in Lean {Html.text s!"{1 + 3}! "}<hr id="proofwidgets-jsx-divider" /></b>

def markdownExample (MarkdownDisplay : Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData MarkdownProps)) : Html :=
  do
    let data ← LeanRef.toJSL {
      contents := "
  ## Hello, Markdown
  We have **bold text**, _italic text_, `example : True := by trivial`,
  and $3*19 = \\int\\limits_0^{57}1~dx$.
" }
    let props ← Props.WithData.make data
    return ← <MarkdownDisplay @props={props}/>

structure BadgeProps where
  tone : String
  label : String

def Badge : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData BadgeProps)) :=
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
  let data ← Lean.Vir.React.Props.WithData.data nativeProps
  let ctx ← Lean.Vir.LeanRef.fromJSL data
  let children ← Lean.Vir.React.Props.WithData.children nativeProps
  let props ← js%{
    "id" := (← JsValue.ofString ("proofwidgets-jsx-badge-" ++ ctx.tone)),
    "className" := (← JsValue.ofString ("pw-jsx-badge pw-jsx-badge-" ++ ctx.tone)),
    "data-tone" := (← JsValue.ofString ctx.tone)
  }
  return ← <span @props={props}>
    {Html.text ctx.label}{children}
  </span>

def row (key label value : String) : Html :=
  <li key={← JsValue.ofString key} className="pw-jsx-row">
    <strong className="pw-jsx-row-label">{Html.text label}</strong>
    <span className="pw-jsx-row-value">{Html.text value}</span>
  </li>

def View : RuntimeM (Lean.Vir.React.FunctionComponent Lean.Vir.React.Props) := do
  let Card ← Card
  let MarkdownDisplay ← MarkdownDisplay
  let Badge ← Badge
  Lean.Vir.React.FunctionComponent.ofLean fun _ => do
    let renderedRows := 3
    let surfaceProps ← js%{
      "id" := js#"proofwidgets-jsx-subset",
      "data-testid" := js#"proofwidgets-jsx-subset",
      "role" := js#"region",
      "aria-label" := js#"ProofWidgets JSX subset combinator demo"
    }
    let cardData ← LeanRef.toJSL { title := "JSX-shaped combinators" }
    let cardProps ← Props.WithData.make cardData
    let markdown ← markdownExample MarkdownDisplay
    let badgeData ← LeanRef.toJSL { tone := "info", label := "component" }
    let badgeProps ← Props.WithData.make badgeData
    Js.Object.set (Props.WithData.asProps badgeProps) (← js#"key") (← js#"info-badge")
    let click ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.Browser.Event) => DomM.toRuntime do
      let title ← Lean.Vir.JsValue.ofString "ProofWidgets JSX subset clicked"
      Lean.Vir.Browser.Document.setTitle
        (← Lean.Vir.Browser.Document.current) title
    let buttonProps ← js%{
      "id" := js#"proofwidgets-jsx-action",
      "className" := js#"pw-jsx-action",
      "onClick" := click
    }
    let action ← <button @props={buttonProps}>{Html.text "mark"}</button>
    let rows ← <ul id="proofwidgets-jsx-rows" className="pw-jsx-rows">
      {row "tags" "lowercase tags" "b, img, span, hr"}
      {row "components" "uppercase components" "Card, MarkdownDisplay, Badge"}
      {row "interpolation" "interpolation" s!"{renderedRows} rendered rows"}
    </ul>
    let view : Html := <section @props={surfaceProps}>
      <Card @props={cardProps}>
        {htmlHeadline}{parrotImage}{arrayInterpolation}{markdown}
        <Badge @props={badgeProps}> children</Badge>
        {action}{rows}
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
      let props ← Lean.Vir.Js.Object.empty
      let children ← Lean.Vir.Js.Array.empty
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.functionComponent component props children)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#proofwidgets-jsx-subset-root"

/-- Native JSX keeps function, object and string inputs exact, without implicit JSL props. -/
def nativeConstruction
    (Component : Lean.Vir.React.FunctionComponent Lean.Vir.React.Props)
    (payload : Js.Object) (label : Js String)
    (callback : Js (Lean.Vir.React.Callback Lean.Vir.Browser.Event)) : Html := do
  let props ← js%{
    "label" := js#"superseded", "label" := label,
    "payload" := payload, "onClick" := callback, "values" := (← js#[label, label])
  }
  return ← <Component @props={props}>
    <span title={label} style={payload} onClick={callback}>{label}</span>
  </Component>

/-- A compile-time native props schema, never instantiated as a Lean record. -/
structure NativeProps where
  label : Js String
  payload : Js.Object
  onClick : Js (Lean.Vir.React.Callback Lean.Vir.Browser.Event)
  values : Js.Array String

def nativeTypedConstruction
    (Component : Lean.Vir.React.FunctionComponent NativeProps)
    (payload : Js.Object) (label : Js String)
    (callback : Js (Lean.Vir.React.Callback Lean.Vir.Browser.Event)) : Html :=
  <Component label={label} payload={payload} onClick={callback} values={(← js#[label, label])}/>

def nativeTypedLabel (props : Js NativeProps) : RuntimeM (Js String) :=
  js_field% props "label"

structure KeyedProps where
  name : Js String

def nativeKeyedChildren (Component : Lean.Vir.React.FunctionComponent KeyedProps)
    (names : Js.Array String) : Html := do
  let render ← Js.Function.ofLean3 fun (name : Js String) (_ : Js Float)
      (_ : Js.Array String) => <Component key={name} name={name}/>
  return ← <div>{names.map render}</div>

def nativeStringLength (value : Js String) : RuntimeM (Js Float) :=
  Js.String.length value

/-- Existing native arrays occupy one child slot, without fragments or flattening. -/
def nativeChildSlots (body : Js Node) (text : Js String)
    (nodes : Js.Array Node) (tail : Js Node) : Html :=
  <div>{body}{text}{nodes}{tail}</div>

/-- Native map calls a Lean-authored JS function; no Lean child array is built. -/
def nativeMappedChildren (labels : Js.Array String) : Html := do
  let render ← Js.Function.ofLean fun (label : Js String) =>
    <span key={label}>{label}</span>
  return ← <div>{labels.map (β := Node) render}</div>

/-- Native primitive/optional children require no arrays or payload conversions. -/
def nativePrimitiveChildren (node : Js.Nullable Node) (absent : Js.Undefined)
    (flag : Js Bool) (number : Js Float) (bigint : Js Nat)
    (nested : Js.Array (Js.Nullable.Value String)) : Html :=
  <div>{node}{absent}{flag}{number}{bigint}{nested}</div>

/-- Ordinary calls share JSX's node membership without inspecting native arrays. -/
def nativeNodeArray (values : Js.Array (Js.UndefinedOr.Value (Js.Nullable.Value String))) :
    Js Node := Node.ofJs values

def nativeRender (root : Js Root)
    (values : Js.Array (Js.UndefinedOr.Value (Js.Nullable.Value String))) : DomM Unit :=
  Root.render root values

def nativeTextFragment (props : Js Props) (values : Js.Array String) : Html :=
  Node.fragment props values

/-- Native map exposes its original index and source array without a callback envelope. -/
def nativeIndexedMap (values : Js.Array String) : RuntimeM (Js.Array Js.Object.Value) := do
  let render ← Js.Function.ofLean3 fun (value : Js String) (index : Js Float)
      (source : Js.Array String) => js%{ "value" := value, "index" := index, "source" := source }
  values.map render

def nativeLiteralConstruction : Html := do
  let props ← js%{ "title" := ((js#"native")), "values" := (← js#[js#"a", (js#"b")]) }
  return ← <span title={((js#"native"))} data-props={props}/>

end ProofWidgetsJsxSubset
