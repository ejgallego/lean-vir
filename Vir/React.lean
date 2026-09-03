/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React.Generated

namespace Lean.Vir.React

private def stringToJs (value : String) : ReactM (Lean.Vir.Js String) := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  pure jsValue

namespace Component

/--
Converts a Lean render function into one reusable JavaScript React component.

The returned JavaScript function is the component type. Reuse the same value
where React should preserve hook state; creating another value intentionally
creates another component type.
-/
def ofLean
    (render : props → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js (Component props)) :=
  ofLeanJs fun props => do
    render (← Lean.Vir.LeanRef.fromJSL props)

end Component

namespace EffectCallback

/-- Explicitly builds React's native setup-function shape from Lean setup and cleanup actions. -/
def ofLean
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.RuntimeM (Lean.Vir.Js EffectCallback) :=
  ofLeanJs { setup, cleanup }

end EffectCallback

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

def setKey (props : @& Lean.Vir.Js Lean.Vir.React.Props) (key : @& String) : ReactM Unit := do
  let property ← Property.toJs (Property.string "key" key)
  setProperty props property

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

end StateSetter

namespace ReducerDispatch

def dispatch {state action : Type}
    (dispatch : Lean.Vir.Js (ReducerDispatch state action))
    (action : Lean.Vir.Js action) : Lean.Vir.RuntimeM Unit :=
  dispatchJs dispatch action

end ReducerDispatch

namespace StateTuple

/-- Explicitly projects React's native `useState` result array into a Lean structure. -/
def toState {α : Type}
    (result : @& Lean.Vir.Js (StateTuple (Lean.Vir.Js α))) :
    Lean.Vir.RuntimeM (State (Lean.Vir.Js α)) := do
  let value ← StateTuple.value result
  let setter ← StateTuple.setter result
  pure { value, setter }

end StateTuple

namespace ReducerTuple

/-- Explicitly projects React's native `useReducer` result array into a Lean structure. -/
def toState {state action : Type}
    (result : @& Lean.Vir.Js (ReducerTuple state action)) :
    Lean.Vir.RuntimeM (ReducerState state action) := do
  let value ← ReducerTuple.value result
  let dispatch ← ReducerTuple.dispatch result
  pure { value, dispatch }

end ReducerTuple

namespace Hooks

namespace DependencyList

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

def useMemoWithArrayDeps {α β : Type}
    (calculate : @& Lean.Vir.Js (MemoCalculation α))
    (deps : @& Array (Lean.Vir.Js β)) :
    ReactM (Lean.Vir.Js α) := do
  let jsDeps ← DependencyList.ofArray deps
  useMemo calculate jsDeps

def useMemoWithStringDeps {α : Type}
    (calculate : @& Lean.Vir.Js (MemoCalculation α))
    (deps : @& Array String) :
    ReactM (Lean.Vir.Js α) := do
  let jsDeps ← DependencyList.ofStrings deps
  useMemo calculate jsDeps

def useEffect
    (setup : @& Lean.Vir.Js EffectCallback)
    (dependencies : Option (Lean.Vir.Js DependencyList) := none) :
    ReactM Unit :=
  match dependencies with
  | none => useEffectWithoutDeps setup
  | some deps => useEffectWithDeps setup deps

/-- Lean convenience over `EffectCallback.ofLean` and the exact `useEffect` binding. -/
def useLeanEffect {α : Type}
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit)
    (dependencies : Option (Lean.Vir.Js DependencyList) := none) : ReactM Unit := do
  let effect ← EffectCallback.ofLean setup cleanup
  useEffect effect dependencies

def useLeanEffectWithArrayDeps {α β : Type}
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit)
    (deps : @& Array (Lean.Vir.Js β)) :
    ReactM Unit := do
  let jsDeps ← DependencyList.ofArray deps
  useLeanEffect setup cleanup (some jsDeps)

def useLeanEffectWithStringDeps {α : Type}
    (setup : Lean.Vir.Browser.DomM (Lean.Vir.Js α))
    (cleanup : @& Lean.Vir.Js α → Lean.Vir.Browser.DomM Unit)
    (deps : @& Array String) :
    ReactM Unit := do
  let jsDeps ← DependencyList.ofStrings deps
  useLeanEffect setup cleanup (some jsDeps)

end Hooks

namespace Ref

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

def ofTag (tag : @& String) : ReactM (Lean.Vir.Js ElementType) := do
  let jsTag ← Lean.Vir.JsValue.ofString tag
  tagJs jsTag

end ElementType

namespace Node

def text (value : @& String) : ReactM (Lean.Vir.Js Node) := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  textJs jsValue

def createElementTag
    (tag : @& String)
    (props : @& Lean.Vir.Js Props)
    (children : @& Lean.Vir.Js.Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) := do
  let elementType ← ElementType.ofTag tag
  createElement elementType props children

def fragmentWithKey (key? : Option String) (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node) := do
  let props ←
    match key? with
    | none => Props.empty
    | some key => Props.fromEntries #[Props.key key]
  let jsChildren ← Lean.Vir.Js.Array.ofArray children
  fragmentWithKeyJs props jsChildren

def fragment (children : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
  fragmentWithKey none children

def keyedFragment (key : String) (children : Array (Lean.Vir.Js Node)) : ReactM (Lean.Vir.Js Node) :=
  fragmentWithKey (some key) children

/-- Creates a React element from an exact reusable JavaScript component function. -/
def component
    (component : @& Lean.Vir.Js (Component props))
    (props : props) : ReactM (Lean.Vir.Js Node) := do
  let jsProps ← Lean.Vir.LeanRef.toJSL props
  componentJs component jsProps

/-- Creates a keyed React element from an exact reusable JavaScript component function. -/
def keyedComponent
    (key : @& String)
    (component : @& Lean.Vir.Js (Component props))
    (props : props) :
    ReactM (Lean.Vir.Js Node) := do
  let jsProps ← Lean.Vir.LeanRef.toJSL props
  let jsKey ← Lean.Vir.JsValue.ofString key
  keyedComponentJs component jsProps jsKey

/-- ProofWidgets-style alias for an exact reusable component value. -/
def ofComponent
    (component : @& Lean.Vir.Js (Component props))
    (props : props) : ReactM (Lean.Vir.Js Node) :=
  Node.component component props

/-- ProofWidgets-style alias for a keyed exact component value. -/
def keyedOfComponent
    (key : @& String)
    (component : @& Lean.Vir.Js (Component props))
    (props : props) :
    ReactM (Lean.Vir.Js Node) :=
  Node.keyedComponent key component props

/-- Creates an element from an exact component whose Lean props are `Unit`. -/
def componentUnit
    (component : @& Lean.Vir.Js (Component Unit)) : ReactM (Lean.Vir.Js Node) :=
  Node.component component ()

/-- Raw element escape hatch. Prefer named helpers in the v0 DOM-like surface. -/
def elementWith
    (tag : String)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) := do
  let jsProps ← Props.fromEntries props
  let jsChildren ← Lean.Vir.Js.Array.ofArray children
  createElementTag tag jsProps jsChildren

/-- Raw keyed element escape hatch. Prefer `Props.key` in React-shaped code. -/
def keyedElementWith
    (tag key : String)
    (props : Array Props.Entry := #[])
    (children : Array (Lean.Vir.Js Node) := #[]) :
    ReactM (Lean.Vir.Js Node) :=
  elementWith tag (props.push (Props.key key)) children

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

/-- Builds a node in Lean, then passes that exact node to React DOM's `Root.render`. -/
def render
    (root : @& Lean.Vir.Js Root)
    (tree : ReactM (Lean.Vir.Js Node)) : Lean.Vir.Browser.DomM Unit := do
  let node ← ReactM.run tree
  renderNode root node

/--
Creates a React root for the first element matching a CSS selector.
-/
def createFromSelector (selector : String) : Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Root)) := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
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
Renders an exact JavaScript React function component into a React root.

Create the component once with `Component.ofLean` and reuse that value when
React should preserve its component identity and hook state.
-/
def renderComponent
    (root : @& Lean.Vir.Js Root)
    (component : @& Lean.Vir.Js (Component props))
    (props : props) :
    Lean.Vir.Browser.DomM Unit := do
  let node ← ReactM.run (Node.component component props)
  renderNode root node

def renderIntoSelector
    (selector : @& String)
    (node : @& Lean.Vir.Js Node) :
    Lean.Vir.Browser.DomM Bool := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  let rendered ← renderIntoSelectorJs jsSelector node
  Lean.Vir.JsValue.toBool rendered

def renderComponentIntoSelector
    (selector : @& String)
    (component : @& Lean.Vir.Js (Component props))
    (props : props) :
    Lean.Vir.Browser.DomM Bool := do
  let node ← ReactM.run (Node.component component props)
  renderIntoSelector selector node

/-- Unmounts the React root associated with a selector, when present. -/
def unmountSelector (selector : @& String) : Lean.Vir.Browser.DomM Bool := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  let unmounted ← unmountSelectorJs jsSelector
  Lean.Vir.JsValue.toBool unmounted

end Root

end Lean.Vir.React
