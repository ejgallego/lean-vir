/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser

namespace Lean.Vir.React

/--
Effect used by Lean-authored React render construction.

`ReactM` is intentionally narrower than `IO`: React render construction can
allocate React-side resources exposed by this module, but arbitrary host `IO`
must stay outside the render surface unless the API exposes a render-safe
operation for it.

The current runtime lowers `ReactM` through the same synchronous host-call ABI
as `DomM`, so this is an irreducible effect marker rather than a separate
runtime representation. Use `ReactM.run` only at explicit root/event boundaries
that already live in `DomM`.
-/
@[irreducible] def ReactM (α : Type) : Type :=
  Lean.Vir.Browser.DomM α

namespace ReactM

/-- Explicitly lowers a render-construction action at a browser/DOM boundary. -/
def run (action : ReactM α) : Lean.Vir.Browser.DomM α :=
  by
    unfold ReactM at action
    exact action

protected def pure (value : α) : ReactM α :=
  by
    unfold ReactM
    exact pure value

protected def bind (action : ReactM α) (next : α → ReactM β) : ReactM β :=
  by
    unfold ReactM
    exact do
      let value ← action.run
      (next value).run

protected def map (f : α → β) (action : ReactM α) : ReactM β :=
  by
    unfold ReactM
    exact f <$> action.run

instance : Monad ReactM where
  pure := ReactM.pure
  bind := ReactM.bind

instance : MonadLift ReactM Lean.Vir.Browser.DomM where
  monadLift := ReactM.run

instance : Nonempty (ReactM α) :=
  by
    unfold ReactM
    infer_instance

end ReactM

/--
React root object class created from a browser container element.

The JavaScript host owns the underlying React root and any callbacks retained by
the currently rendered tree until `Root.unmount`, package reload, or runtime
disposal.
-/
opaque Root : Type

/--
React state setter object returned by `useState`.

The JavaScript host owns the underlying setter function. Lean code can retain
the typed `Js (StateSetter α)` handle in callbacks and pass it back to the
state setter helpers in this module.
-/
opaque StateSetter (α : Type) : Type

/--
Default React props object marker.

`Root.renderComponent` accepts Lean-side props directly. This marker names the
JavaScript object shape used by hosts that want to pass an opaque props object
through `Lean.Vir.Js Props`.
-/
opaque Props : Type

/-- A single React `style` object entry. Use camelCase property names. -/
structure StyleProperty where
  name : String
  value : String

/-- Conservative v0 set of React property values. -/
inductive PropValue where
  | string (value : String)
  | bool (value : Bool)
  | int (value : Int)
  | float (value : Float)
  | style (entries : Array StyleProperty)
  | classList (classes : Array String)

/-- A React property. Event handlers live in `EventHandler`, not `Property`. -/
structure Property where
  name : String
  value : PropValue

/-- A DOM-like React event handler backed by a retained Lean closure. -/
structure EventHandler where
  name : String
  callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit

/-- React state value and setter returned by `useState`. -/
structure State (α : Type) where
  value : α
  setter : Lean.Vir.Js (StateSetter α)

namespace JsValue

@[vir_js "js.string"]
opaque ofString (value : @& String) : ReactM (Lean.Vir.Js String)

@[vir_js "js.string.value"]
opaque toString (value : @& Lean.Vir.Js String) : ReactM String

@[vir_js "js.nat"]
opaque ofNat (value : Nat) : ReactM (Lean.Vir.Js Nat)

@[vir_js "js.nat.value"]
opaque toNat (value : @& Lean.Vir.Js Nat) : ReactM Nat

@[vir_js "js.bool"]
opaque ofBool (value : Bool) : ReactM (Lean.Vir.Js Bool)

@[vir_js "js.bool.value"]
opaque toBool (value : @& Lean.Vir.Js Bool) : ReactM Bool

end JsValue

/--
React node object class created by the JavaScript host through React's public
APIs.

Lean code builds values of this marker through `Node.text` and
`Node.createElement`.
At the host boundary these are typed `Lean.Vir.Js Node` resources, so React
nodes are constructed once with `React.createElement` instead of decoded from a
private recursive tree on every render.
-/
opaque Node : Type

/--
A React function component authored in Lean.

The JavaScript host wraps this function in a real React function component, so
React hooks exposed by this module run under React's normal hook dispatcher.
-/
abbrev Component (props : Type := Unit) : Type :=
  props → ReactM (Lean.Vir.Js Node)

namespace Property

/-- Raw string-valued prop escape hatch. Prefer named helpers in the v0 surface. -/
def string (name value : String) : Property :=
  { name, value := .string value }

/-- Raw boolean-valued prop escape hatch. Prefer named helpers in the v0 surface. -/
def bool (name : String) (value : Bool) : Property :=
  { name, value := .bool value }

/-- Raw integer-valued prop escape hatch. Prefer named helpers in the v0 surface. -/
def int (name : String) (value : Int) : Property :=
  { name, value := .int value }

/-- Raw floating-point prop escape hatch. Prefer named helpers in the v0 surface. -/
def float (name : String) (value : Float) : Property :=
  { name, value := .float value }

def id (value : String) : Property :=
  string "id" value

def inputName (value : String) : Property :=
  string "name" value

def formName (value : String) : Property :=
  string "name" value

def className (value : String) : Property :=
  string "className" value

/-- DOMTokenList-like class helper. The host validates and deduplicates tokens. -/
def classList (classes : Array String) : Property :=
  { name := "className", value := .classList classes }

def title (value : String) : Property :=
  string "title" value

def role (value : String) : Property :=
  string "role" value

def ariaLabel (value : String) : Property :=
  string "aria-label" value

def ariaHidden (value : Bool) : Property :=
  bool "aria-hidden" value

def ariaControls (value : String) : Property :=
  string "aria-controls" value

def ariaCurrent (value : String) : Property :=
  string "aria-current" value

def ariaDescribedBy (value : String) : Property :=
  string "aria-describedby" value

def ariaExpanded (value : Bool) : Property :=
  bool "aria-expanded" value

def ariaLabelledBy (value : String) : Property :=
  string "aria-labelledby" value

def ariaLive (value : String) : Property :=
  string "aria-live" value

def ariaPressed (value : Bool) : Property :=
  bool "aria-pressed" value

def ariaSelected (value : Bool) : Property :=
  bool "aria-selected" value

/--
DOM `data-*` prop helper. Pass the suffix without `data-`; the JavaScript
renderer rejects an empty suffix to avoid producing `data-`.
-/
def data (name value : String) : Property :=
  string ("data-" ++ name) value

def dataTestId (value : String) : Property :=
  data "testid" value

def tabIndex (value : Int) : Property :=
  int "tabIndex" value

/-- React style-object helper. Use camelCase style names and string values. -/
def style (entries : Array StyleProperty) : Property :=
  { name := "style", value := .style entries }

/-- React style-object helper for inline `(name, value)` pairs. -/
def stylePairs (entries : Array (String × String)) : Property :=
  style <| entries.map fun (name, value) => { name, value }

def type (value : String) : Property :=
  string "type" value

def href (value : String) : Property :=
  string "href" value

def target (value : String) : Property :=
  string "target" value

def rel (value : String) : Property :=
  string "rel" value

def src (value : String) : Property :=
  string "src" value

def alt (value : String) : Property :=
  string "alt" value

def htmlFor (value : String) : Property :=
  string "htmlFor" value

def inputValue (value : String) : Property :=
  string "value" value

def defaultValue (value : String) : Property :=
  string "defaultValue" value

def placeholder (value : String) : Property :=
  string "placeholder" value

def autoComplete (value : String) : Property :=
  string "autoComplete" value

def min (value : String) : Property :=
  string "min" value

def max (value : String) : Property :=
  string "max" value

def step (value : String) : Property :=
  string "step" value

def maxLength (value : Int) : Property :=
  int "maxLength" value

def width (value : Int) : Property :=
  int "width" value

def height (value : Int) : Property :=
  int "height" value

def rows (value : Int) : Property :=
  int "rows" value

def cols (value : Int) : Property :=
  int "cols" value

def checked (value : Bool) : Property :=
  bool "checked" value

def defaultChecked (value : Bool) : Property :=
  bool "defaultChecked" value

def disabled (value : Bool) : Property :=
  bool "disabled" value

def multiple (value : Bool) : Property :=
  bool "multiple" value

def readOnly (value : Bool) : Property :=
  bool "readOnly" value

def required (value : Bool) : Property :=
  bool "required" value

def selected (value : Bool) : Property :=
  bool "selected" value

end Property

namespace EventHandler

/-- Raw event handler escape hatch. Prefer named `onClick`/`onInput`/`onChange` helpers. -/
def on (name : String) (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  { name, callback }

/-- Raw event handler escape hatch for handlers that ignore the event. -/
def onUnit (name : String) (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on name fun _event => callback

def onClick (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onClick" callback

def onClickWith (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onClick" callback

def onDoubleClick (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onDoubleClick" callback

def onDoubleClickWith (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onDoubleClick" callback

def onInput (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onInput" callback

def onInputUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onInput" callback

def onChange (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onChange" callback

def onChangeUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onChange" callback

def onFocus (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onFocus" callback

def onFocusUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onFocus" callback

def onBlur (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onBlur" callback

def onBlurUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onBlur" callback

def onKeyDown (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onKeyDown" callback

def onKeyDownUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onKeyDown" callback

def onKeyUp (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onKeyUp" callback

def onKeyUpUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onKeyUp" callback

def onMouseDown (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onMouseDown" callback

def onMouseDownUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onMouseDown" callback

def onMouseUp (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onMouseUp" callback

def onMouseUpUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onMouseUp" callback

def onMouseEnter (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onMouseEnter" callback

def onMouseEnterUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onMouseEnter" callback

def onMouseLeave (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onMouseLeave" callback

def onMouseLeaveUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onMouseLeave" callback

def onSubmit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onSubmit" callback

def onSubmitWith (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onSubmit" callback

end EventHandler

namespace StateSetter

@[vir_js "react.state.set"]
opaque set {α : Type}
    (setter : @& Lean.Vir.Js (StateSetter (Lean.Vir.Js α)))
    (value : @& Lean.Vir.Js α) :
    ReactM Unit

@[vir_js "react.state.modify"]
opaque modify {α : Type}
    (setter : @& Lean.Vir.Js (StateSetter (Lean.Vir.Js α)))
    (update : Lean.Vir.Js α → Lean.Vir.Js α) :
    ReactM Unit

end StateSetter

namespace Hooks

@[vir_js "react.useState"]
opaque useState {α : Type} (initial : @& Lean.Vir.Js α) : ReactM (State (Lean.Vir.Js α))

end Hooks

namespace State

def set (state : State (Lean.Vir.Js α)) (value : Lean.Vir.Js α) : ReactM Unit :=
  StateSetter.set state.setter value

def modify (state : State (Lean.Vir.Js α)) (update : Lean.Vir.Js α → Lean.Vir.Js α) : ReactM Unit :=
  StateSetter.modify state.setter update

end State

namespace Node

@[vir_js "react.node.text"]
opaque text (value : @& String) : ReactM (Lean.Vir.Js Node)

@[vir_js "react.node.createElement"]
opaque createElement
    (tag : @& String)
    (key? : Option String)
    (props : Array Property)
    (handlers : Array EventHandler)
    (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node)

/-- Renders a Lean function component with typed props. -/
def component (component : Component props) (props : props) : ReactM (Lean.Vir.Js Node) :=
  component props

/-- ProofWidgets-style alias for rendering a Lean function component. -/
def ofComponent (component : Component props) (props : props) : ReactM (Lean.Vir.Js Node) :=
  Node.component component props

/-- Renders a nullary Lean function component. -/
def componentUnit (component : Component Unit) : ReactM (Lean.Vir.Js Node) :=
  component ()

/-- Raw element escape hatch. Prefer named helpers in the v0 DOM-like surface. -/
def elementWith
    (tag : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  createElement tag none props handlers children

/-- Raw keyed element escape hatch. Prefer named helpers in the v0 DOM-like surface. -/
def keyedElementWith
    (tag key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  createElement tag (some key) props handlers children

private def childElement (tag : String) (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) :=
  elementWith tag #[] #[] children

private def keyedChildElement (tag key : String) (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) :=
  keyedElementWith tag key #[] #[] children

private def childElementWith
    (tag : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  elementWith tag props handlers children

private def keyedChildElementWith
    (tag key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  keyedElementWith tag key props handlers children

local macro "nodeChildElement " plain:ident keyed:ident withName:ident keyedWith:ident tag:str : command => do
  let keyName := Lean.mkIdent `key
  let propsName := Lean.mkIdent `props
  let handlersName := Lean.mkIdent `handlers
  let childrenName := Lean.mkIdent `children
  `(
      section
      def $plain ($childrenName : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
        childElement $tag $childrenName

      def $keyed ($keyName : String) ($childrenName : Array (Lean.Vir.Js Node)) :
          ReactM (Lean.Vir.Js Node) :=
        keyedChildElement $tag $keyName $childrenName

      def $withName
          ($propsName : Array Property := #[])
          ($handlersName : Array EventHandler := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        childElementWith $tag $propsName $handlersName $childrenName

      def $keyedWith
          ($keyName : String)
          ($propsName : Array Property := #[])
          ($handlersName : Array EventHandler := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        keyedChildElementWith $tag $keyName $propsName $handlersName $childrenName
      end
    )

local macro "nodeEmptyElement " plain:ident keyed:ident tag:str : command => do
  let keyName := Lean.mkIdent `key
  let propsName := Lean.mkIdent `props
  let handlersName := Lean.mkIdent `handlers
  `(
      section
      def $plain
          ($propsName : Array Property := #[])
          ($handlersName : Array EventHandler := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        elementWith $tag $propsName $handlersName #[]

      def $keyed
          ($keyName : String)
          ($propsName : Array Property := #[])
          ($handlersName : Array EventHandler := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        keyedElementWith $tag $keyName $propsName $handlersName #[]
      end
    )

local macro "nodeButtonElement " plain:ident keyed:ident withName:ident keyedWith:ident : command => do
  let keyName := Lean.mkIdent `key
  let propsName := Lean.mkIdent `props
  let handlersName := Lean.mkIdent `handlers
  let childrenName := Lean.mkIdent `children
  `(
      section
      def $plain ($childrenName : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
        elementWith "button" #[Property.type "button"] #[] $childrenName

      def $keyed ($keyName : String) ($childrenName : Array (Lean.Vir.Js Node)) :
          ReactM (Lean.Vir.Js Node) :=
        keyedElementWith "button" $keyName #[Property.type "button"] #[] $childrenName

      def $withName
          ($propsName : Array Property := #[])
          ($handlersName : Array EventHandler := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        elementWith "button" (#[Property.type "button"] ++ $propsName) $handlersName $childrenName

      def $keyedWith
          ($keyName : String)
          ($propsName : Array Property := #[])
          ($handlersName : Array EventHandler := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        keyedElementWith "button" $keyName (#[Property.type "button"] ++ $propsName) $handlersName $childrenName
      end
    )

nodeChildElement div keyedDiv divWith keyedDivWith "div"
nodeChildElement span keyedSpan spanWith keyedSpanWith "span"
nodeChildElement a keyedA aWith keyedAWith "a"
nodeEmptyElement img keyedImg "img"
nodeEmptyElement br keyedBr "br"
nodeEmptyElement hr keyedHr "hr"
nodeEmptyElement input keyedInput "input"
nodeEmptyElement textarea keyedTextarea "textarea"
nodeChildElement label keyedLabel labelWith keyedLabelWith "label"
nodeChildElement form keyedForm formWith keyedFormWith "form"
nodeChildElement select keyedSelect selectWith keyedSelectWith "select"
nodeChildElement option keyedOption optionWith keyedOptionWith "option"
nodeChildElement fieldset keyedFieldset fieldsetWith keyedFieldsetWith "fieldset"
nodeChildElement legend keyedLegend legendWith keyedLegendWith "legend"
nodeChildElement «section» keyedSection sectionWith keyedSectionWith "section"
nodeChildElement article keyedArticle articleWith keyedArticleWith "article"
nodeChildElement aside keyedAside asideWith keyedAsideWith "aside"
nodeChildElement header keyedHeader headerWith keyedHeaderWith "header"
nodeChildElement footer keyedFooter footerWith keyedFooterWith "footer"
nodeChildElement nav keyedNav navWith keyedNavWith "nav"
nodeChildElement main keyedMain mainWith keyedMainWith "main"
nodeChildElement ul keyedUl ulWith keyedUlWith "ul"
nodeChildElement ol keyedOl olWith keyedOlWith "ol"
nodeChildElement li keyedLi liWith keyedLiWith "li"
nodeChildElement dl keyedDl dlWith keyedDlWith "dl"
nodeChildElement dt keyedDt dtWith keyedDtWith "dt"
nodeChildElement dd keyedDd ddWith keyedDdWith "dd"
nodeChildElement p keyedP pWith keyedPWith "p"
nodeChildElement pre keyedPre preWith keyedPreWith "pre"
nodeChildElement code keyedCode codeWith keyedCodeWith "code"
nodeChildElement strong keyedStrong strongWith keyedStrongWith "strong"
nodeChildElement em keyedEm emWith keyedEmWith "em"
nodeChildElement small keyedSmall smallWith keyedSmallWith "small"
nodeChildElement table keyedTable tableWith keyedTableWith "table"
nodeChildElement thead keyedThead theadWith keyedTheadWith "thead"
nodeChildElement tbody keyedTbody tbodyWith keyedTbodyWith "tbody"
nodeChildElement tr keyedTr trWith keyedTrWith "tr"
nodeChildElement th keyedTh thWith keyedThWith "th"
nodeChildElement td keyedTd tdWith keyedTdWith "td"
nodeChildElement h1 keyedH1 h1With keyedH1With "h1"
nodeChildElement h2 keyedH2 h2With keyedH2With "h2"
nodeChildElement h3 keyedH3 h3With keyedH3With "h3"
nodeChildElement h4 keyedH4 h4With keyedH4With "h4"
nodeChildElement h5 keyedH5 h5With keyedH5With "h5"
nodeChildElement h6 keyedH6 h6With keyedH6With "h6"
nodeButtonElement button keyedButton buttonWith keyedButtonWith

end Node

namespace Root

/--
Creates a React root for an existing browser element.

Reference: [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot).
-/
@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Js Lean.Vir.Browser.Element) : Lean.Vir.Browser.DomM (Lean.Vir.Js Root)

/--
Creates a React root for the first element matching a CSS selector.
-/
def createFromSelector (selector : String) : Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Root)) := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure none
  | some container => some <$> create container

/--
Creates a React root for a selector and runs an action when the selector exists.

Returns `true` when a root was created and `false` when the selector did not match.
This is a small convenience for exported browser demos.
-/
def mountFromSelector
    (selector : String)
    (action : Lean.Vir.Js Root → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool := do
  match ← createFromSelector selector with
  | none => pure false
  | some root =>
      action root
      pure true

/--
Constructs a React tree and renders it into a React root.

The host retains callbacks embedded in the rendered resource graph until the
root is rerendered, unmounted, or the owning runtime is disposed.
-/
@[vir_js "react.root.render"]
opaque render
    (root : @& Lean.Vir.Js Root)
    (node : ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.Browser.DomM Unit

/--
Renders a Lean-authored React function component into a React root.

The host wraps the Lean function in a JavaScript React component, so hooks such
as `Hooks.useState` are evaluated by React during the component render.
-/
@[vir_js "react.root.renderComponent"]
opaque renderComponentThunk
    (root : @& Lean.Vir.Js Root)
    (component : Unit → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.Browser.DomM Unit

def renderComponent
    (root : @& Lean.Vir.Js Root)
    (component : Component props)
    (props : props) :
    Lean.Vir.Browser.DomM Unit :=
  renderComponentThunk root fun _ => component props

@[vir_js "react.root.renderIntoSelector"]
opaque renderIntoSelector
    (selector : @& String)
    (node : @& Lean.Vir.Js Node) :
    Lean.Vir.Browser.DomM Bool

@[vir_js "react.root.renderComponentIntoSelector"]
opaque renderComponentIntoSelectorThunk
    (selector : @& String)
    (component : Unit → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.Browser.DomM Bool

def renderComponentIntoSelector
    (selector : @& String)
    (component : Component props)
    (props : props) :
    Lean.Vir.Browser.DomM Bool :=
  renderComponentIntoSelectorThunk selector fun _ => component props

/--
Unmounts a React root and releases callbacks retained by its current render.

Reference: [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount).
-/
@[vir_js "react.root.unmount"]
opaque unmount (root : @& Lean.Vir.Js Root) : Lean.Vir.Browser.DomM Unit

@[vir_js "react.root.unmountSelector"]
opaque unmountSelector (selector : @& String) : Lean.Vir.Browser.DomM Bool

end Root

end Lean.Vir.React
