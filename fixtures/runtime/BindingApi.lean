/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.ProofWidgets.Jsx

open Lean.Vir
open Lean.Vir.Browser
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

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
