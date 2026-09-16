/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

import all Vir.Browser.Types
import all Vir.Js.Types
import all Vir.React.Types
public import Vir.ProofWidgets.Jsx

open Lean.Vir
open Lean.Vir.Browser
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

-- Explicit initial-union membership determines state shape without coercions.
example (value : Js String) : React.ReactM (Js (React.StateTuple String)) :=
  React.Hooks.useState (React.Initial.ofValue value)

example (initializer : Js.Function0 (Js String)) :
    React.ReactM (Js (React.StateTuple String)) :=
  React.Hooks.useState (React.Initial.ofInitializer initializer)

example (handler : Js.Function1 (Js String) Unit) :
    React.ReactM (Js (React.StateTuple (Js.Function.Unary (Js String) Unit))) := do
  let initializer ← Js.Function.ofLean0 (pure handler)
  React.Hooks.useState (React.Initial.ofInitializer initializer)

example (value : Js String) :
    Js.erase (React.Initial.ofValue value) = Js.erase value := rfl

example (initializer : Js.Function0 (Js String)) :
    Js.erase (React.Initial.ofInitializer initializer) = Js.erase initializer := rfl

example (_value : Js String) (_initializer : Js.Function0 (Js String))
    (_void : Js.Function0 Unit) (_unary : Js.Function1 (Js String) (Js String)) : True := by
  fail_if_success have _ := React.Hooks.useState _value
  fail_if_success have _ := React.Hooks.useState _initializer
  fail_if_success have _ : React.ReactM (Js (React.StateTuple Bool)) :=
    React.Hooks.useState (React.Initial.ofInitializer _initializer)
  fail_if_success have _ := React.Initial.ofInitializer _void
  fail_if_success have _ := React.Initial.ofInitializer _unary
  trivial

-- Native function aliases preserve arity and complete result relationships.
example (body : RuntimeM (Js String)) : RuntimeM (Js (React.MemoCalculation String)) :=
  Js.Function.ofLean0 body

-- DOM conversion is an explicit identity, not an implicit lift or a renamed effect.
example (body : DomM Unit) :
    DomM.toRuntime body = (by unfold DomM at body; exact body) := rfl

example (_body : DomM Unit) : True := by
  fail_if_success have _ : RuntimeM Unit := _body
  trivial

example (cleanup : RuntimeM Unit) : RuntimeM (Js React.EffectCallback) :=
  Js.Function.ofLean0 do
    let release ← Js.Function.ofLean0Void cleanup
    pure (Js.UndefinedOr.ofJs release)

example : RuntimeM (Js React.EffectCallback) :=
  Js.Function.ofLean0 (Js.UndefinedOr.undefined)

example (reduce : Js String → Js Bool → RuntimeM (Js String)) :
    RuntimeM (Js (React.Reducer String Bool)) := Js.Function.ofLean2 reduce

example (setter : Js (React.StateSetter String)) (value : Js String)
    (update : Js.Function1 (Js String) (Js String)) : RuntimeM Unit := do
  Js.Function.callVoid setter (React.SetStateAction.ofValue value)
  Js.Function.callVoid setter (React.SetStateAction.ofUpdater update)

example (_unary : Js.Function1 (Js String) (Js String))
    (_void : Js.Function0 Unit) (_string : Js.Function0 (Js String))
    (_wrongReducer : Js.Function2 (Js String) (Js Bool) (Js Bool))
    (_wrongUpdate : Js.Function1 (Js String) (Js Bool)) : True := by
  fail_if_success have _ : Js React.EffectCallback := _void
  fail_if_success have _ : Js React.EffectCallback := _string
  fail_if_success have _ : Js (React.MemoCalculation String) := _unary
  fail_if_success have _ : Js (React.Reducer String Bool) := _wrongReducer
  fail_if_success have _ : Js (React.SetStateAction.Value String) :=
    React.SetStateAction.ofUpdater _wrongUpdate
  trivial

-- Phantom shapes remain distinct unless a cast explicitly unfolds the handle view.
example (_value : Js String) (_values : Js.Array String) : True := by
  fail_if_success have _ : Js Bool := _value
  fail_if_success have _ : Js.Array Bool := _values
  fail_if_success have _ : Js String = Js Bool := rfl
  trivial

-- An explicit cast needs only the identity term, even in an importing module.
example {α β : Type} (value : Js α) : Js β := by
  unfold Js at *
  exact value

-- Literal notation constructs native containers; interpolation does not encode Lean data.
example (value : Js String) : RuntimeM Js.Object :=
  js%{ "value" := value }

-- Only explicit string literals are lifted in construction positions.
example : RuntimeM Js.Object := js%{ "value" := js#"native" }
example : React.ReactM (Js React.Node) := <span title={js#"native"}/>
example : RuntimeM (Js String) := js#"still an action"
example (action : RuntimeM (Js String)) : RuntimeM Js.Object :=
  js%{ "value" := (← action) }
-- Definitional equality verifies order and multiplicity, not only the result type.
example (action : RuntimeM (Js String)) :
    (js%{ "first" := js#"a", "middle" := (← action), "last" := js#"b" }) =
    (js%{ "first" := (← js#"a"), "middle" := (← action), "last" := (← js#"b") }) := rfl
example : (<span title={js#"native"}/> : React.ReactM (Js React.Node)) =
    <span title={(← js#"native")}/> := rfl
example (_action : RuntimeM (Js String)) : True := by
  fail_if_success have _ : RuntimeM Js.Object := js%{ "value" := _action }
  fail_if_success have _ : React.ReactM (Js React.Node) := <span title={_action}/>
  trivial

-- Literal construction must not invoke Object.prototype's legacy setter.
example (_value : Js.Object) (Component : React.FunctionComponent React.Props) : True := by
  let _ := Component
  fail_if_success have _ : RuntimeM Js.Object := js%{ "__proto__" := _value }
  fail_if_success have _ : React.ReactM (Js React.Node) := <div __proto__={_value}/>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div __proto__={_value}></div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <Component __proto__={_value}/>
  trivial

-- Other names remain ordinary properties; general assignment is still available.
example (value : Js.Object) : RuntimeM Js.Object :=
  js%{ "constructor" := value, "prototype" := value }

example (object value : Js.Object) : RuntimeM Unit := do
  Js.Object.set object (← js#"__proto__") value

example (first second : Js String) : RuntimeM (Js.Array String) :=
  js#[first, second]

example (text : Js String) : RuntimeM (Js Float) := Js.String.length text

example (value : Js String) : React.ReactM (Js React.Node) :=
  <span title={value}>{React.Node.text value}</span>

-- Native children are inserted unchanged, not converted to Lean collections.
example (node : Js React.Node) (text : Js String) (nodes : Js.Array React.Node) :
    React.ReactM (Js React.Node) := <div>{node}{text}{nodes}</div>

example (node : Js React.Node) :
    (<div>{node}</div> : React.ReactM (Js React.Node)) = <div>{pure node}</div> := rfl

example (text : Js String) :
    (<div>{text}</div> : React.ReactM (Js React.Node)) = <div>{React.Node.text text}</div> := rfl

example (action : RuntimeM (Js React.Node)) : React.ReactM (Js React.Node) :=
  <div>{action}</div>

example (values : Js.Array String) (render : Js.Function1 (Js String) (Js React.Node)) :
    React.ReactM (Js React.Node) := <div>{values.map (β := React.Node) render}</div>

example (text : RuntimeM (Js String)) (nodes : React.ReactM (Js.Array React.Node)) :
    React.ReactM (Js React.Node) := <div>{text}{nodes}</div>

example : React.ReactM (Js React.Node) := <div>{js#"native text"}</div>

example (nullable : Js.Nullable React.Node) (optional : Js.UndefinedOr String)
    (absent : Js.Undefined) (flag : Js Bool) (number : Js Float) (bigint : Js Nat)
    (nested : Js.Array (Js.Nullable.Value String)) : React.ReactM (Js React.Node) :=
  <div>{nullable}{optional}{absent}{flag}{number}{bigint}{nested}</div>

example (values : Js.Array String) : RuntimeM (Js React.Node) := do
  let render ← Js.Function.ofLean3 fun (text : Js String) (_ : Js Float)
      (_ : Js.Array String) => <span>{text}</span>
  return ← <div>{values.map render}</div>

example : RuntimeM (Js.Function1 (Js String) (Js React.Node)) :=
  Js.Function.ofLean fun (text : Js String) => <span>{text}</span>

example : RuntimeM (Js.Array String) := js#[js#"a", (js#"b"), ((js#"c"))]

example : RuntimeM Js.Object := js%{ "value" := ((js#"native")) }

example : React.ReactM (Js React.Node) := <span title={((js#"native"))}/>

example (_nullable : Js.Nullable Js.Object.Value) (_any : Js.Any)
    (_values : Js.Array Js.Any.Value) (_action : RuntimeM (Js.Array Js.Object.Value)) : True := by
  fail_if_success have _ : RuntimeM (Js React.Node) := <div>{_nullable}</div>
  fail_if_success have _ : RuntimeM (Js React.Node) := <div>{_any}</div>
  fail_if_success have _ : RuntimeM (Js React.Node) := <div>{_values}</div>
  fail_if_success have _ : RuntimeM (Js React.Node) := <div>{_action}</div>
  trivial

example (_action : RuntimeM (Js String)) : True := by
  fail_if_success have _ : RuntimeM (Js.Array String) := js#[_action]
  fail_if_success have _ : RuntimeM Js.Object := js%{ "value" := (_action) }
  fail_if_success have _ : RuntimeM (Js React.Node) := <span title={(_action)}/>
  trivial

example (_raw : Js.Object) (_nodes : Array (Js React.Node))
    (_actions : Js.Array (RuntimeM (Js React.Node)))
    (_leanActions : Array (React.ReactM (Js React.Node)))
    (_arrayAction : RuntimeM (Array (Js React.Node))) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{_raw}</div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{_nodes}</div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{_actions}</div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{_leanActions}</div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{_arrayAction}</div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{..._nodes}</div>
  fail_if_success have _ : React.ReactM (Js React.Node) := <div>{..._leanActions}</div>
  trivial

#guard_msgs in
example (Component : React.FunctionComponent (React.Props.WithData String))
    (props : Js (React.Props.WithData String)) : React.ReactM (Js React.Node) :=
  <Component @props={props} />

#guard_msgs in
example (Component : React.FunctionComponent React.Props)
    (props : Js React.Props) : React.ReactM (Js React.Node) :=
  <Component @props={props}></Component>

-- Exact props are not object spread, and cannot be mixed with field writes.
example (_props : Js React.Props) : True := by
  fail_if_success have _ : React.ReactM (Js React.Node) := <span {..._props}/>
  fail_if_success have _ : React.ReactM (Js React.Node) := <span @props={_props} id="mixed"/>
  trivial

-- A schema describes native properties, not an allocated Lean record.
structure NativeProps where
  title : Js String
  values : Js.Array String
  ref : Js.Any

example (Component : React.FunctionComponent NativeProps) (ref : Js.Any)
    (key : Js String) (number : Js Float) (bigint : Js Nat)
    (optional : Js.UndefinedOr String) (nullable : Js.Nullable String) : RuntimeM Unit := do
  let _ ← <Component key={key} title="x" values={(← Js.Array.empty)} ref={ref}/>
  let _ ← <Component key={number} title="x" values={(← Js.Array.empty)} ref={ref}/>
  let _ ← <Component key={bigint} title="x" values={(← Js.Array.empty)} ref={ref}/>
  let _ ← <Component key={optional} title="x" values={(← Js.Array.empty)} ref={ref}/>
  let _ ← <Component key={nullable} title="x" values={(← Js.Array.empty)} ref={ref}/>
  let _ ← <Component key={js#"literal"} title="x" values={(← Js.Array.empty)} ref={ref}/>
  pure ()

example (Component : React.FunctionComponent NativeProps) (ref : Js.Any)
    (_key : Js Bool) (_object : Js.Object) (_any : Js.Any) : True := by
  let _ := Component
  let _ := ref
  fail_if_success have _ : React.ReactM (Js React.Node) :=
    <Component key={_key} title="x" values={(← Js.Array.empty)} ref={ref}/>
  fail_if_success have _ : React.ReactM (Js React.Node) :=
    <Component key={_object} title="x" values={(← Js.Array.empty)} ref={ref}/>
  fail_if_success have _ : React.ReactM (Js React.Node) :=
    <Component key={_any} title="x" values={(← Js.Array.empty)} ref={ref}/>
  fail_if_success have _ : React.ReactM (Js React.Node) :=
    <Component key="a" key="b" title="x" values={(← Js.Array.empty)} ref={ref}/>
  trivial

example (_text : Js String) (_number : Js Float) : True := by
  fail_if_success have _ : RuntimeM (Js.Array String) := js#[_text, _number]
  fail_if_success have _ : RuntimeM (Js.Array String) := js#[_number]
  trivial

#guard_msgs in
example (Component : React.FunctionComponent NativeProps) (ref : Js.Any) : React.ReactM (Js React.Node) :=
  <Component title="native" values={(← Js.Array.empty)} ref={ref}></Component>

#guard_msgs in
example (Component : React.FunctionComponent NativeProps) (ref : Js.Any) : React.ReactM (Js React.Node) :=
  <Component title="native" values={(← Js.Array.empty)} ref={ref}/>

#guard_msgs in
example (Component : React.FunctionComponent NativeProps) (ref : Js.Any) : React.ReactM (Js React.Node) :=
  <Component title={js#"native"} values={(← Js.Array.empty)} ref={ref}/>

example (Component : React.FunctionComponent NativeProps) (ref : Js.Any) :
    (<Component title={js#"native"} values={(← Js.Array.empty)} ref={ref}/> : React.ReactM (Js React.Node)) =
    <Component title={(← js#"native")} values={(← Js.Array.empty)} ref={ref}/> := rfl

example (Component : React.FunctionComponent NativeProps) (_ref : Js.Any) : True := by
  let _ := Component
  fail_if_success have _ : React.ReactM (Js React.Node) :=
    <Component title={js#"native"} values={js#"not an array"} ref={_ref}/>
  trivial

#guard_msgs in
example (Component : React.FunctionComponent NativeProps) (props : Js NativeProps) : React.ReactM (Js React.Node) :=
  <Component @props={props}/>

#guard_msgs in
example (props : Js NativeProps) : RuntimeM (Js String) := js_field% props "title"

example (component : React.FunctionComponent NativeProps) (_title : Js String)
    (_values : Js.Array String) (_ref : Js.Any) (_wrong : Js Float) (_raw : Js.Object) : True := by
  let Component := component
  fail_if_success have _ : React.ReactM (Js React.Node) := <Component title={_title} ref={_ref}/>
  fail_if_success have _ : React.ReactM (Js React.Node) := <Component title={_wrong} values={_values} ref={_ref}/>
  fail_if_success have _ : React.ReactM (Js React.Node) := <Component title="a" title="b" values={_values} ref={_ref}/>
  fail_if_success have _ : React.ReactM (Js React.Node) := <Component title={_title} values={_values} ref={_ref} extra="x"/>
  fail_if_success have _ : React.ReactM (Js React.Node) := <Component @props={_raw}/>
  fail_if_success have _ : RuntimeM (Js String) := js_field% _raw "title"
  trivial

example (_props : Js NativeProps) : True := by
  fail_if_success have _ : RuntimeM (Js Float) := js_field% _props "title"
  fail_if_success have _ : RuntimeM (Js String) := js_field% _props "missing"
  trivial

structure NonNativeProps where
  title : String
structure ParameterizedProps (α : Type) where
  value : Js α
structure InheritedProps extends NativeProps where
  extra : Js String
structure ReservedProps where
  __proto__ : Js.Any
structure KeyProps where
  key : Js String
structure ChildrenProps where
  children : Js.Array React.Node

-- Deliberately bounded schema support; these are not unchecked cast routes.
example (_nonNative : Js NonNativeProps) (_parameterized : Js (ParameterizedProps String))
    (_inherited : Js InheritedProps) (_reserved : Js ReservedProps)
    (_key : Js KeyProps) (_children : Js ChildrenProps) : True := by
  fail_if_success have _ : RuntimeM (Js String) := js_field% _nonNative "title"
  fail_if_success have _ : RuntimeM (Js String) := js_field% _parameterized "value"
  fail_if_success have _ : RuntimeM (Js String) := js_field% _inherited "title"
  fail_if_success have _ : RuntimeM Js.Any := js_field% _reserved "__proto__"
  fail_if_success have _ : RuntimeM (Js String) := js_field% _key "key"
  fail_if_success have _ : RuntimeM (Js.Array React.Node) := js_field% _children "children"
  trivial

example (_value : String) (_callback : DomM Unit)
    (_component : React.FunctionComponent (React.Props.WithData String))
    (_props : Js (React.Props.WithData Nat)) : True := by
  fail_if_success have _ : RuntimeM Js.Object := js%{ "value" := _value }
  fail_if_success have _ : RuntimeM (Js.Array String) := js#[_value]
  fail_if_success have _ : React.ReactM (Js React.Node) := <span title={_value} />
  fail_if_success have _ : React.ReactM (Js React.Node) := <button onClick={_callback} />
  fail_if_success have _ := React.Node.functionComponent _component _props
  trivial

-- Application data shapes cannot be silently interchanged or inferred from an object.
example (_props : Js (React.Props.WithData String)) : True := by
  fail_if_success have _ : Js (React.Props.WithData Nat) := _props
  fail_if_success have _ : RuntimeM (JSL Nat) := React.Props.WithData.data _props
  trivial

example (_component : React.FunctionComponent (React.Props.WithData String))
    (_props : Js (React.Props.WithData Nat)) (_children : Js.Array React.Node) : True := by
  fail_if_success have _ := React.Node.functionComponent _component _props _children
  trivial

-- The short names preserve the native value boundary, not Lean conversions.
example (console : Js Console) (message : Js String) : RuntimeM Unit :=
  Console.log console message

example (ctx : Js CanvasRenderingContext2D) (x y width height : Js Float) : DomM Unit :=
  CanvasRenderingContext2D.fillRect ctx x y width height

example (callback : DomM Unit) (delay : Js Float) : DomM (Js Timeout) :=
  Timer.setTimeout callback delay

example (array : Js.Array α) (index : Js Float) : RuntimeM (Js α) :=
  Js.Array.get array index

example (setup : Js React.EffectCallback) : React.ReactM Unit := do
  React.Hooks.useEffect setup (← Js.UndefinedOr.undefined)

example (setup : Js React.EffectCallback) (deps : Js React.DependencyList) : React.ReactM Unit :=
  React.Hooks.useEffect setup (Js.UndefinedOr.ofJs deps)

-- Removed arity implementations and conversion wrappers stay absent.
example : True := by
  fail_if_success have _ := Lean.Vir.React.Hooks.useEffectWithoutDeps
  fail_if_success have _ := Lean.Vir.React.Hooks.useEffectWithDeps
  fail_if_success have _ := Lean.Vir.Browser.CanvasRenderingContext2D.fillRectJs
  fail_if_success have _ := Lean.Vir.Browser.Document.querySelectorString
  fail_if_success have _ := Lean.Vir.React.Hooks.useLeanEffect
  trivial

example (_setup : Js React.EffectCallback) (_deps : Js React.DependencyList)
    (_null : Js.Nullable React.DependencyList) : True := by
  fail_if_success have _ := React.Hooks.useEffect _setup (some _deps)
  fail_if_success have _ := React.Hooks.useEffect _setup (none : Option (Js React.DependencyList))
  fail_if_success have _ := React.Hooks.useEffect _setup (Js.erase _deps)
  fail_if_success have _ := React.Hooks.useEffect _setup _null
  trivial

open scoped Lean.Vir.Js in
example : RuntimeM (Js String) := js#"native string"

example (_console : Js Console) (_message : String) : True := by
  fail_if_success have _ := Console.log _console _message
  trivial

example (_ctx : Js CanvasRenderingContext2D) (_x _y _width _height : Float) : True := by
  fail_if_success have _ := CanvasRenderingContext2D.fillRect _ctx _x _y _width _height
  trivial
