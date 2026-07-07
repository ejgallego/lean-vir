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

The current runtime lowers `ReactM` through `Lean.Vir.RuntimeM`, so this is an
irreducible effect marker rather than a separate runtime representation. Use
`ReactM.run` only at explicit root boundaries that already live in `DomM`.
-/
@[irreducible] def ReactM (α : Type) : Type :=
  Lean.Vir.RuntimeM α

namespace ReactM

/-- Explicitly lowers a render-construction action at a browser/DOM boundary. -/
def run (action : ReactM α) : Lean.Vir.Browser.DomM α :=
  by
    unfold ReactM at action
    unfold Lean.Vir.Browser.DomM
    exact action

instance : Monad ReactM where
  pure value :=
    by
      unfold ReactM
      exact pure value
  bind action next :=
    by
      unfold ReactM at action
      unfold ReactM
      exact action >>= fun value => by
        unfold ReactM at next
        exact next value

instance : MonadLift Lean.Vir.RuntimeM ReactM where
  monadLift action :=
    by
      unfold ReactM
      exact action

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
React element type value accepted by `React.createElement`.

DOM tag strings are explicitly wrapped with `ElementType.ofTag`. Future
JavaScript library bindings can return `Lean.Vir.Js ElementType` resources for
component functions or React component objects and pass them to
`Node.createElement` without inventing a parallel element-construction API.
-/
opaque ElementType : Type

/--
React state setter object returned by `useState`.

The JavaScript host owns the underlying setter function. Lean code can retain
the typed `Js (StateSetter α)` handle in callbacks and pass it back to the
state setter helpers in this module.
-/
opaque StateSetter (α : Type) : Type

/--
React reducer dispatch function returned by `useReducer`.

The JavaScript host owns the underlying dispatch function. Lean callbacks can
retain the typed handle and pass `Js action` values back through
`ReducerDispatch.dispatch`.
-/
opaque ReducerDispatch (state action : Type) : Type

/--
React ref object returned by `useRef`.

The JavaScript host owns the underlying `{ current }` object. Reading and
writing `current` does not schedule a React render, matching React's ref
lifetime semantics.
-/
opaque Ref (α : Type) : Type

/--
Default React props object marker.

`Root.renderComponent` accepts Lean-side props directly. This marker names the
JavaScript object shape used by hosts that want to pass an opaque props object
through `Lean.Vir.Js Props`. Lean-authored element construction uses
`Props.Entry` below to build this JavaScript-owned props object explicitly.
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

/--
A non-event React property.

Public element construction consumes `Props.Entry`, which can carry properties,
event handlers, and special React props such as `key`. `Property` remains the
typed non-event property payload used by the current host ABI.
-/
structure Property where
  name : String
  value : PropValue

/-- A DOM-like React event handler backed by a retained Lean closure. -/
structure EventHandler where
  name : String
  callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit

namespace Props

/--
One public React props entry.

This is the React-shaped public lane: element construction receives one props
array containing ordinary properties, event handlers, and special React props.
`Node.createElement` lowers these entries into a JavaScript-owned `Props`
resource before calling the low-level host import.
-/
inductive Entry where
  | key (value : String)
  | ref {α : Type} (value : Lean.Vir.Js (Ref (Lean.Vir.Js α)))
  | property (value : Property)
  | eventHandler (value : EventHandler)

end Props

/-- React state value and setter returned by `useState`. -/
structure State (α : Type) where
  value : α
  setter : Lean.Vir.Js (StateSetter α)

/--
React reducer value and dispatch function returned by `useReducer`.

Reducer state and actions live in JavaScript-land. Use `Js` resources directly
for JavaScript-owned state. Use `Lean.Vir.JSL α` when React should store a
retained Lean-owned value, and call `Lean.Vir.LeanRef.toJSL` / `fromJSL`
explicitly at the application boundary.
-/
structure ReducerState (state action : Type) where
  value : Lean.Vir.Js state
  dispatch : Lean.Vir.Js (ReducerDispatch state action)

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
JavaScript-owned React child list.

Lean-facing builders accept ordinary Lean arrays for ergonomics, then populate
this resource with explicit `react.node.children.*` calls before crossing the
host boundary.
-/
opaque NodeChildren : Type

/-- JavaScript-owned React hook dependency list. -/
opaque DependencyList : Type

/--
A React function component authored in Lean.

The JavaScript host wraps this function in a real React function component, so
React hooks exposed by this module run under React's normal hook dispatcher.
-/
abbrev Component (props : Type := Unit) : Type :=
  props → ReactM (Lean.Vir.Js Node)

private def stringToJs (value : String) : ReactM (Lean.Vir.Js String) := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  pure jsValue

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

@[vir_js_explicit_conversion "js.value.react.property"]
opaque toJs (value : @& Property) : Lean.Vir.RuntimeM (Lean.Vir.Js Property)

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

@[vir_js_explicit_conversion "js.value.react.eventHandler"]
opaque toJs (value : @& EventHandler) : Lean.Vir.RuntimeM (Lean.Vir.Js EventHandler)

end EventHandler

namespace Props

/-- React `key` special prop. -/
def key (value : String) : Entry :=
  .key value

/-- React `ref` special prop. -/
def ref {α : Type} (value : Lean.Vir.Js (Ref (Lean.Vir.Js α))) : Entry :=
  .ref value

def property (value : Property) : Entry :=
  .property value

def eventHandler (value : EventHandler) : Entry :=
  .eventHandler value

def string (name value : String) : Entry :=
  property <| Property.string name value

def bool (name : String) (value : Bool) : Entry :=
  property <| Property.bool name value

def int (name : String) (value : Int) : Entry :=
  property <| Property.int name value

def float (name : String) (value : Float) : Entry :=
  property <| Property.float name value

def id (value : String) : Entry :=
  property <| Property.id value

def inputName (value : String) : Entry :=
  property <| Property.inputName value

def formName (value : String) : Entry :=
  property <| Property.formName value

def className (value : String) : Entry :=
  property <| Property.className value

def classList (classes : Array String) : Entry :=
  property <| Property.classList classes

def title (value : String) : Entry :=
  property <| Property.title value

def role (value : String) : Entry :=
  property <| Property.role value

def ariaLabel (value : String) : Entry :=
  property <| Property.ariaLabel value

def ariaHidden (value : Bool) : Entry :=
  property <| Property.ariaHidden value

def ariaControls (value : String) : Entry :=
  property <| Property.ariaControls value

def ariaCurrent (value : String) : Entry :=
  property <| Property.ariaCurrent value

def ariaDescribedBy (value : String) : Entry :=
  property <| Property.ariaDescribedBy value

def ariaExpanded (value : Bool) : Entry :=
  property <| Property.ariaExpanded value

def ariaLabelledBy (value : String) : Entry :=
  property <| Property.ariaLabelledBy value

def ariaLive (value : String) : Entry :=
  property <| Property.ariaLive value

def ariaPressed (value : Bool) : Entry :=
  property <| Property.ariaPressed value

def ariaSelected (value : Bool) : Entry :=
  property <| Property.ariaSelected value

def data (name value : String) : Entry :=
  property <| Property.data name value

def dataTestId (value : String) : Entry :=
  property <| Property.dataTestId value

def tabIndex (value : Int) : Entry :=
  property <| Property.tabIndex value

def style (entries : Array StyleProperty) : Entry :=
  property <| Property.style entries

def stylePairs (entries : Array (String × String)) : Entry :=
  property <| Property.stylePairs entries

def type (value : String) : Entry :=
  property <| Property.type value

def href (value : String) : Entry :=
  property <| Property.href value

def target (value : String) : Entry :=
  property <| Property.target value

def rel (value : String) : Entry :=
  property <| Property.rel value

def src (value : String) : Entry :=
  property <| Property.src value

def alt (value : String) : Entry :=
  property <| Property.alt value

def htmlFor (value : String) : Entry :=
  property <| Property.htmlFor value

def inputValue (value : String) : Entry :=
  property <| Property.inputValue value

def defaultValue (value : String) : Entry :=
  property <| Property.defaultValue value

def placeholder (value : String) : Entry :=
  property <| Property.placeholder value

def autoComplete (value : String) : Entry :=
  property <| Property.autoComplete value

def min (value : String) : Entry :=
  property <| Property.min value

def max (value : String) : Entry :=
  property <| Property.max value

def step (value : String) : Entry :=
  property <| Property.step value

def maxLength (value : Int) : Entry :=
  property <| Property.maxLength value

def width (value : Int) : Entry :=
  property <| Property.width value

def height (value : Int) : Entry :=
  property <| Property.height value

def rows (value : Int) : Entry :=
  property <| Property.rows value

def cols (value : Int) : Entry :=
  property <| Property.cols value

def checked (value : Bool) : Entry :=
  property <| Property.checked value

def defaultChecked (value : Bool) : Entry :=
  property <| Property.defaultChecked value

def disabled (value : Bool) : Entry :=
  property <| Property.disabled value

def multiple (value : Bool) : Entry :=
  property <| Property.multiple value

def readOnly (value : Bool) : Entry :=
  property <| Property.readOnly value

def required (value : Bool) : Entry :=
  property <| Property.required value

def selected (value : Bool) : Entry :=
  property <| Property.selected value

def on (name : String)
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.on name callback

def onUnit (name : String) (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onUnit name callback

def onClick (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onClick callback

def onClickWith
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onClickWith callback

def onDoubleClick (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onDoubleClick callback

def onDoubleClickWith
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onDoubleClickWith callback

def onInput
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onInput callback

def onInputUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onInputUnit callback

def onChange
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onChange callback

def onChangeUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onChangeUnit callback

def onFocus
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onFocus callback

def onFocusUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onFocusUnit callback

def onBlur
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onBlur callback

def onBlurUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onBlurUnit callback

def onKeyDown
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onKeyDown callback

def onKeyDownUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onKeyDownUnit callback

def onKeyUp
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onKeyUp callback

def onKeyUpUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onKeyUpUnit callback

def onMouseDown
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onMouseDown callback

def onMouseDownUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onMouseDownUnit callback

def onMouseUp
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onMouseUp callback

def onMouseUpUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onMouseUpUnit callback

def onMouseEnter
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onMouseEnter callback

def onMouseEnterUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onMouseEnterUnit callback

def onMouseLeave
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onMouseLeave callback

def onMouseLeaveUnit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onMouseLeaveUnit callback

def onSubmit (callback : Lean.Vir.Browser.DomM Unit) : Entry :=
  eventHandler <| EventHandler.onSubmit callback

def onSubmitWith
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Entry :=
  eventHandler <| EventHandler.onSubmitWith callback

@[vir_js "react.props.empty"]
opaque empty : ReactM (Lean.Vir.Js Lean.Vir.React.Props)

@[vir_js "react.props.setKey"]
private opaque setKeyJs
    (props : @& Lean.Vir.Js Lean.Vir.React.Props)
    (key : @& Lean.Vir.Js String) :
    ReactM Unit

@[vir_js "react.props.setProperty"]
opaque setProperty
    (props : @& Lean.Vir.Js Lean.Vir.React.Props)
    (property : @& Lean.Vir.Js Property) :
    ReactM Unit

@[vir_js "react.props.setEventHandler"]
opaque setEventHandler
    (props : @& Lean.Vir.Js Lean.Vir.React.Props)
    (handler : @& Lean.Vir.Js EventHandler) :
    ReactM Unit

@[vir_js "react.props.setRef"]
opaque setRef {α : Type}
    (props : @& Lean.Vir.Js Lean.Vir.React.Props)
    (ref : @& Lean.Vir.Js (Ref (Lean.Vir.Js α))) :
    ReactM Unit

def setKey (props : @& Lean.Vir.Js Lean.Vir.React.Props) (key : @& String) : ReactM Unit := do
  let jsKey ← stringToJs key
  setKeyJs props jsKey

def pushEntry (props : @& Lean.Vir.Js Lean.Vir.React.Props) : Entry → ReactM Unit
  | .key value => setKey props value
  | .ref value => setRef props value
  | .property value => do
      let jsValue ← Property.toJs value
      setProperty props jsValue
  | .eventHandler value => do
      let jsValue ← EventHandler.toJs value
      setEventHandler props jsValue

def fromEntries (entries : Array Entry) : ReactM (Lean.Vir.Js Lean.Vir.React.Props) := do
  let props ← empty
  for entry in entries do
    pushEntry props entry
  pure props

end Props

namespace StateSetter

@[vir_js "react.state.set"]
opaque set {α : Type}
    (setter : @& Lean.Vir.Js (StateSetter (Lean.Vir.Js α)))
    (value : @& Lean.Vir.Js α) :
    Lean.Vir.RuntimeM Unit

@[vir_js "react.state.modify"]
opaque modify {α : Type}
    (setter : @& Lean.Vir.Js (StateSetter (Lean.Vir.Js α)))
    (update : Lean.Vir.Js α → Lean.Vir.RuntimeM (Lean.Vir.Js α)) :
    Lean.Vir.RuntimeM Unit

end StateSetter

namespace ReducerDispatch

@[vir_js "react.reducer.dispatch"]
private opaque dispatchJs {state action : Type}
    (dispatch : @& Lean.Vir.Js (ReducerDispatch state action))
    (action : @& Lean.Vir.Js action) :
    Lean.Vir.RuntimeM Unit

def dispatch {state action : Type}
    (dispatch : Lean.Vir.Js (ReducerDispatch state action))
    (action : Lean.Vir.Js action) : Lean.Vir.RuntimeM Unit :=
  dispatchJs dispatch action

end ReducerDispatch

namespace Hooks

@[vir_js "react.useReducer"]
private opaque useReducerJs {state action : Type}
    (reducer : Lean.Vir.Js state → Lean.Vir.Js action → Lean.Vir.RuntimeM (Lean.Vir.Js state))
    (initial : @& Lean.Vir.Js state) :
    ReactM (Lean.Vir.Js (ReducerState state action))

@[vir_js "react.reducerState.value"]
private opaque reducerStateValueJs {state action : Type}
    (reducerState : @& Lean.Vir.Js (ReducerState state action)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js state)

@[vir_js "react.reducerState.dispatch"]
private opaque reducerStateDispatchJs {state action : Type}
    (reducerState : @& Lean.Vir.Js (ReducerState state action)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js (ReducerDispatch state action))

@[vir_js "react.useState"]
private opaque useStateJs {α : Type}
    (initial : @& Lean.Vir.Js α) :
    ReactM (Lean.Vir.Js (State (Lean.Vir.Js α)))

@[vir_js "react.state.value"]
private opaque stateValueJs {α : Type}
    (state : @& Lean.Vir.Js (State (Lean.Vir.Js α))) :
    Lean.Vir.RuntimeM (Lean.Vir.Js α)

@[vir_js "react.state.setter"]
private opaque stateSetterJs {α : Type}
    (state : @& Lean.Vir.Js (State (Lean.Vir.Js α))) :
    Lean.Vir.RuntimeM (Lean.Vir.Js (StateSetter (Lean.Vir.Js α)))

def useState {α : Type} (initial : @& Lean.Vir.Js α) : ReactM (State (Lean.Vir.Js α)) := do
  let state ← useStateJs initial
  let value ← stateValueJs state
  let setter ← stateSetterJs state
  pure { value, setter }

def useReducer {state action : Type}
    (reducer : Lean.Vir.Js state → Lean.Vir.Js action → Lean.Vir.RuntimeM (Lean.Vir.Js state))
    (initial : @& Lean.Vir.Js state) : ReactM (ReducerState state action) := do
  let reducerStateJs ← useReducerJs reducer initial
  let valueJs ← reducerStateValueJs reducerStateJs
  let dispatch ← reducerStateDispatchJs reducerStateJs
  pure { value := valueJs, dispatch }

@[vir_js "react.useRef"]
opaque useRef {α : Type} (initial : @& Lean.Vir.Js α) : ReactM (Lean.Vir.Js (Ref (Lean.Vir.Js α)))

/--
Runs a React effect whose setup returns a host resource cleaned up by React.

This is the v0 resource-shaped `useEffect` binding with React's no-dependency
behavior: React calls `setup` after each committed render and calls `cleanup`
with the returned resource before the effect is replaced, before unmount, or
when the runtime is disposed.
-/
@[vir_js "react.useEffect"]
opaque useEffect {α : Type}
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit) :
    ReactM Unit

/-
Runs a resource-shaped React effect with a dependency list.

This is the dependency-array form of `useEffect`: React calls `setup` after the
initial committed render and after later commits where any dependency changes
according to `Object.is`, and calls `cleanup` with the returned resource before
replacement or unmount. Use `#[]` for React's empty dependency array behavior.
-/
namespace DependencyList

@[vir_js "react.deps.empty"]
opaque empty : ReactM (Lean.Vir.Js DependencyList)

@[vir_js "react.deps.push"]
opaque push {α : Type}
    (deps : @& Lean.Vir.Js DependencyList)
    (value : @& Lean.Vir.Js α) :
    ReactM Unit

def ofArray {α : Type} (deps : @& Array (Lean.Vir.Js α)) :
    ReactM (Lean.Vir.Js DependencyList) := do
  let jsDeps ← empty
  for dep in deps do
    push jsDeps dep
  pure jsDeps

def ofStrings (deps : @& Array String) : ReactM (Lean.Vir.Js DependencyList) := do
  let jsDeps ← empty
  for dep in deps do
    let jsDep ← stringToJs dep
    push jsDeps jsDep
  pure jsDeps

end DependencyList

@[vir_js "react.useMemo"]
opaque useMemo {α : Type}
    (calculate : ReactM (Lean.Vir.Js α))
    (deps : @& Lean.Vir.Js DependencyList) :
    ReactM (Lean.Vir.Js α)

def useMemoWithArrayDeps {α β : Type}
    (calculate : ReactM (Lean.Vir.Js α))
    (deps : @& Array (Lean.Vir.Js β)) :
    ReactM (Lean.Vir.Js α) := do
  let jsDeps ← DependencyList.ofArray deps
  useMemo calculate jsDeps

def useMemoWithStringDeps {α : Type}
    (calculate : ReactM (Lean.Vir.Js α))
    (deps : @& Array String) :
    ReactM (Lean.Vir.Js α) := do
  let jsDeps ← DependencyList.ofStrings deps
  useMemo calculate jsDeps

@[vir_js "react.useEffectWithDeps"]
private opaque useEffectWithDepsJs {α : Type}
    (deps : @& Lean.Vir.Js DependencyList)
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit) :
    ReactM Unit

def useEffectWithDeps {α : Type}
    (deps : @& Lean.Vir.Js DependencyList)
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit) :
    ReactM Unit :=
  useEffectWithDepsJs deps setup cleanup

def useEffectWithArrayDeps {α β : Type}
    (deps : @& Array (Lean.Vir.Js β))
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit) :
    ReactM Unit := do
  let jsDeps ← DependencyList.ofArray deps
  useEffectWithDeps jsDeps setup cleanup

def useEffectWithStringDeps {α : Type}
    (deps : @& Array String)
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit) :
    ReactM Unit := do
  let jsDeps ← DependencyList.ofStrings deps
  useEffectWithDeps jsDeps setup cleanup

end Hooks

namespace Ref

@[vir_js "react.ref.get"]
opaque get {α : Type} (ref : @& Lean.Vir.Js (Ref (Lean.Vir.Js α))) : Lean.Vir.RuntimeM (Lean.Vir.Js α)

@[vir_js "react.ref.set"]
opaque set {α : Type}
    (ref : @& Lean.Vir.Js (Ref (Lean.Vir.Js α)))
    (value : @& Lean.Vir.Js α) :
    Lean.Vir.RuntimeM Unit

end Ref

namespace State

def set (state : State (Lean.Vir.Js α)) (value : Lean.Vir.Js α) : Lean.Vir.RuntimeM Unit :=
  StateSetter.set state.setter value

def modify
    (state : State (Lean.Vir.Js α))
    (update : Lean.Vir.Js α → Lean.Vir.RuntimeM (Lean.Vir.Js α)) :
    Lean.Vir.RuntimeM Unit :=
  StateSetter.modify state.setter update

end State

namespace ElementType

@[vir_js "react.elementType.tag"]
private opaque tagJs (tag : @& Lean.Vir.Js String) : ReactM (Lean.Vir.Js ElementType)

def ofTag (tag : @& String) : ReactM (Lean.Vir.Js ElementType) := do
  let jsTag ← Lean.Vir.JsValue.ofString tag
  tagJs jsTag

end ElementType

namespace Node

@[vir_js "react.node.text"]
private opaque textJs (value : @& Lean.Vir.Js String) : ReactM (Lean.Vir.Js Node)

@[vir_js "react.node.createElement"]
private opaque createElementJs
    (elementType : @& Lean.Vir.Js ElementType)
    (props : @& Lean.Vir.Js Props)
    (children : @& Lean.Vir.Js NodeChildren) :
    ReactM (Lean.Vir.Js Node)

@[vir_js "react.node.fragment"]
private opaque fragmentWithKeyJs
    (props : @& Lean.Vir.Js Props)
    (children : @& Lean.Vir.Js NodeChildren) :
    ReactM (Lean.Vir.Js Node)

namespace NodeChildren

@[vir_js "react.node.children.empty"]
opaque empty : ReactM (Lean.Vir.Js NodeChildren)

@[vir_js "react.node.children.push"]
opaque push
    (children : @& Lean.Vir.Js NodeChildren)
    (child : @& Lean.Vir.Js Node) :
    ReactM Unit

def ofArray (children : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js NodeChildren) := do
  let jsChildren ← empty
  for child in children do
    push jsChildren child
  pure jsChildren

end NodeChildren

def text (value : @& String) : ReactM (Lean.Vir.Js Node) := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  textJs jsValue

def createElement
    (elementType : @& Lean.Vir.Js ElementType)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) := do
  let jsProps ← Props.fromEntries props
  let jsChildren ← NodeChildren.ofArray children
  createElementJs elementType jsProps jsChildren

def createElementTag
    (tag : @& String)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) := do
  let elementType ← ElementType.ofTag tag
  createElement elementType props children

def fragmentWithKey (key? : Option String) (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) := do
  let props ←
    match key? with
    | none => Props.empty
    | some key => Props.fromEntries #[Props.key key]
  let jsChildren ← NodeChildren.ofArray children
  fragmentWithKeyJs props jsChildren

def fragment (children : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
  fragmentWithKey none children

def keyedFragment (key : String) (children : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
  fragmentWithKey (some key) children

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
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  createElementTag tag props children

/-- Raw keyed element escape hatch. Prefer `Props.key` in React-shaped code. -/
def keyedElementWith
    (tag key : String)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  createElementTag tag (props.push (Props.key key)) children

private def childElement (tag : String) (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) :=
  elementWith tag #[] children

private def keyedChildElement (tag key : String) (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) :=
  keyedElementWith tag key #[] children

private def childElementWith
    (tag : String)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  elementWith tag props children

private def keyedChildElementWith
    (tag key : String)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  keyedElementWith tag key props children

local macro "nodeChildElement " plain:ident keyed:ident withName:ident keyedWith:ident tag:str : command => do
  let keyName := Lean.mkIdent `key
  let propsName := Lean.mkIdent `props
  let childrenName := Lean.mkIdent `children
  `(
      section
      def $plain ($childrenName : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
        childElement $tag $childrenName

      def $keyed ($keyName : String) ($childrenName : Array (Lean.Vir.Js Node)) :
          ReactM (Lean.Vir.Js Node) :=
        keyedChildElement $tag $keyName $childrenName

      def $withName
          ($propsName : Array Props.Entry := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        childElementWith $tag $propsName $childrenName

      def $keyedWith
          ($keyName : String)
          ($propsName : Array Props.Entry := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        keyedChildElementWith $tag $keyName $propsName $childrenName
      end
    )

local macro "nodeEmptyElement " plain:ident keyed:ident tag:str : command => do
  let keyName := Lean.mkIdent `key
  let propsName := Lean.mkIdent `props
  `(
      section
      def $plain
          ($propsName : Array Props.Entry := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        elementWith $tag $propsName #[]

      def $keyed
          ($keyName : String)
          ($propsName : Array Props.Entry := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        keyedElementWith $tag $keyName $propsName #[]
      end
    )

local macro "nodeButtonElement " plain:ident keyed:ident withName:ident keyedWith:ident : command => do
  let keyName := Lean.mkIdent `key
  let propsName := Lean.mkIdent `props
  let childrenName := Lean.mkIdent `children
  `(
      section
      def $plain ($childrenName : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
        elementWith "button" #[Props.type "button"] $childrenName

      def $keyed ($keyName : String) ($childrenName : Array (Lean.Vir.Js Node)) :
          ReactM (Lean.Vir.Js Node) :=
        keyedElementWith "button" $keyName #[Props.type "button"] $childrenName

      def $withName
          ($propsName : Array Props.Entry := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        elementWith "button" (#[Props.type "button"] ++ $propsName) $childrenName

      def $keyedWith
          ($keyName : String)
          ($propsName : Array Props.Entry := #[])
          ($childrenName : Array (Lean.Vir.Js Node) := #[]) :
          ReactM (Lean.Vir.Js Node) :=
        keyedElementWith "button" $keyName (#[Props.type "button"] ++ $propsName) $childrenName
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

/-- Element builder shape used by text-child convenience helpers. -/
abbrev TextBuilder :=
  Array Props.Entry → Array (Lean.Vir.Js Node) → ReactM (Lean.Vir.Js Node)

/-- Builds one text node and passes it as the only child to `build`. -/
def textWith
    (build : TextBuilder)
    (props : Array Props.Entry)
    (value : String) : ReactM (Lean.Vir.Js Node) := do
  let textNode ← text value
  build props #[textNode]

def codeText (props : Array Props.Entry) (value : String) : ReactM (Lean.Vir.Js Node) :=
  textWith (fun props children => codeWith props children) props value

def spanText (value : String) : ReactM (Lean.Vir.Js Node) := do
  let textNode ← text value
  span #[textNode]

def spanTextWith (props : Array Props.Entry) (value : String) : ReactM (Lean.Vir.Js Node) :=
  textWith (fun props children => spanWith props children) props value

def pTextWith (props : Array Props.Entry) (value : String) : ReactM (Lean.Vir.Js Node) :=
  textWith (fun props children => pWith props children) props value

def h3TextWith (props : Array Props.Entry) (value : String) : ReactM (Lean.Vir.Js Node) :=
  textWith (fun props children => h3With props children) props value

def strongTextWith (props : Array Props.Entry) (value : String) : ReactM (Lean.Vir.Js Node) :=
  textWith (fun props children => strongWith props children) props value

def buttonTextWith
    (props : Array Props.Entry)
    (value : String) : ReactM (Lean.Vir.Js Node) :=
  textWith (fun props children => buttonWith props children) props value

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
private opaque renderIntoSelectorJs
    (selector : @& Lean.Vir.Js String)
    (node : @& Lean.Vir.Js Node) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Bool)

@[vir_js "react.root.renderComponentIntoSelector"]
private opaque renderComponentIntoSelectorThunkJs
    (selector : @& Lean.Vir.Js String)
    (component : Unit → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Bool)

def renderIntoSelector
    (selector : @& String)
    (node : @& Lean.Vir.Js Node) :
    Lean.Vir.Browser.DomM Bool := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  let rendered ← renderIntoSelectorJs jsSelector node
  Lean.Vir.JsValue.toBool rendered

private def renderComponentIntoSelectorThunk
    (selector : @& String)
    (component : Unit → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.Browser.DomM Bool := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  let rendered ← renderComponentIntoSelectorThunkJs jsSelector component
  Lean.Vir.JsValue.toBool rendered

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
private opaque unmountSelectorJs (selector : @& Lean.Vir.Js String) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Bool)

def unmountSelector (selector : @& String) : Lean.Vir.Browser.DomM Bool := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  let unmounted ← unmountSelectorJs jsSelector
  Lean.Vir.JsValue.toBool unmounted

end Root

end Lean.Vir.React
