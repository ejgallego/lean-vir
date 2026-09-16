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

-- Tuple notation keeps native position types and a hygienic temporary.
example (tuple : Js.Tuple2 String Bool) : RuntimeM (Js Bool) := do
  js#let (text, flag) := tuple
  let _ : Js String := text
  return flag

example (source : RuntimeM (Js.Tuple2 String Bool)) : RuntimeM (Js String) := do
  js#let (tuple, flag) ← source
  let _ : Js Bool := flag
  return tuple

example (_tuple : Js.Tuple2 String Bool) (_pair : Js String × Js Bool)
    (_array : Js.Array String) : True := by
  fail_if_success
    have _ : RuntimeM (Js String) := do
      js#let (text, flag) := _tuple
      return flag
  fail_if_success
    have _ : RuntimeM (Js String) := do
      js#let (text, flag) := _pair
      return text
  fail_if_success
    have _ : RuntimeM (Js String) := do
      js#let (text, flag) := _array
      return text
  trivial

-- Default inference is initializer-first; result annotations still take priority.
private def inferredValue (value : Js String) := React.Hooks.useState (React.Initial.ofValue value)
private def inferredInitializer (value : Js.Function0 (Js String)) := React.Hooks.useState value
private def inferredFunction (value : Js.Function0 (Js.Function0 (Js String))) :=
  React.Hooks.useState value
private def inferredGeneric (value : Js α) := React.Hooks.useState (React.Initial.ofValue value)
private def inferredUnion (value : Js (React.Initial.Value α)) := React.Hooks.useState value
private def inferredVoidThunk (value : Js.Function0 (Js.Function0 Unit)) := React.Hooks.useState value
private def inferredUnaryThunk (value : Js.Function0 (Js.Function1 (Js String) Unit)) :=
  React.Hooks.useState value

example : Js String → React.ReactM (Js (React.StateTuple String)) := inferredValue
example : Js.Function0 (Js String) → React.ReactM (Js (React.StateTuple String)) := inferredInitializer
example : Js.Function0 (Js.Function0 (Js String)) →
    React.ReactM (Js (React.StateTuple (Js.Function.Nullary (Js String)))) := inferredFunction
example : Js α → React.ReactM (Js (React.StateTuple α)) := inferredGeneric
example : Js (React.Initial.Value α) → React.ReactM (Js (React.StateTuple α)) := inferredUnion
example : Js.Function0 (Js.Function0 Unit) →
    React.ReactM (Js (React.StateTuple (Js.Function.Nullary Unit))) := inferredVoidThunk
example : Js.Function0 (Js.Function1 (Js String) Unit) →
    React.ReactM (Js (React.StateTuple (Js.Function.Unary (Js String) Unit))) := inferredUnaryThunk

example (value : Js String) : React.ReactM (Js (React.StateTuple String)) :=
  React.Hooks.useState value

example (value : Js.Function0 (Js String)) :
    React.ReactM (Js (React.StateTuple (Js.Function.Nullary (Js String)))) :=
  React.Hooks.useState value

example (value : Js.Function0 (Js String)) :=
  React.Hooks.useState (α := Js.Function.Nullary (Js String)) value

example (value : Js.Function0 Unit) :=
  React.Hooks.useState (α := Js.Function.Nullary Unit) value

example (value : Js.Function1 (Js String) (Js String)) :
    React.ReactM (Js (React.StateTuple (Js.Function.Unary (Js String) (Js String)))) :=
  React.Hooks.useState value

-- Explicit union widenings remain available, without changing callable semantics.
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
  fail_if_success have _ : React.ReactM (Js (React.StateTuple Bool)) := React.Hooks.useState _value
  fail_if_success have _ : React.ReactM (Js (React.StateTuple Bool)) := React.Hooks.useState _initializer
  fail_if_success have _ : React.ReactM (Js (React.StateTuple Bool)) :=
    React.Hooks.useState (React.Initial.ofInitializer _initializer)
  fail_if_success have _ := React.Initial.ofInitializer _void
  fail_if_success have _ := React.Initial.ofInitializer _unary
  fail_if_success have _ : React.ReactM (Js (React.StateTuple String)) := React.Hooks.useState _void
  fail_if_success have _ : React.ReactM (Js (React.StateTuple String)) := React.Hooks.useState _unary
  fail_if_success have _ := React.Hooks.useStateNative
  fail_if_success have _ := React.Root.renderNative
  fail_if_success have _ := React.Node.createElementNative
  fail_if_success have _ := React.Node.fragmentNative
  trivial

-- No contextual state type: no universal default may silently accept callables.
example (_void : Js.Function0 Unit) (_unary : Js.Function1 (Js String) (Js String))
    (_binary : Js.Function2 (Js String) (Js String) (Js String))
    (_ternary : Js.Function3 (Js String) (Js String) (Js String) Unit)
    (_decoded : Js.Function0 String) (_value : Js String) (_generic : Js α) : True := by
  fail_if_success have _ := React.Hooks.useState _void
  fail_if_success have _ := React.Hooks.useState _unary
  fail_if_success have _ := React.Hooks.useState _binary
  fail_if_success have _ := React.Hooks.useState _ternary
  fail_if_success have _ := React.Hooks.useState _decoded
  fail_if_success have _ := React.Hooks.useState _value
  fail_if_success have _ := React.Hooks.useState _generic
  trivial

example : React.ReactM (Js React.Node) := do
  let values : Js.Array React.Node ← Js.Array.empty
  let state ← React.Hooks.useState (React.Initial.ofValue values)
  return ← <div>{← Js.Tuple2.first state}</div>

-- Host-import proofs are checked in their telescope and excluded from JS args.
private noncomputable opaque proofPrefixSignature {α : Type} [React.Node.Shape α] (_h : True)
    (value : @& Js α) : RuntimeM (Js α)
private noncomputable opaque propositionPrefixSignature {p : Prop} (_h : p)
    (value : @& Js String) : RuntimeM (Js String)
private noncomputable opaque dataInstanceSignature {α : Type} [evidence : Inhabited α]
    (value : @& Js α) : RuntimeM (Js α)
private noncomputable opaque lateProofSignature (value : @& Js String) (_h : True) : RuntimeM (Js String)

run_cmd Lean.Elab.Command.liftCoreM do
  for (name, expectedPrefix) in [( ``proofPrefixSignature, 3), (``propositionPrefixSignature, 2)] do
    let type := (← Lean.getConstInfo name).type
    let .ok signature ← Vir.Interface.classifyHostImportSignature type
      | throwError "proof-prefix signature rejected"
    unless signature.erasedPrefixArgs == expectedPrefix && signature.args.size == 1 do
      throwError "proof prefix leaked into host arguments"
  let dataType := (← Lean.getConstInfo ``dataInstanceSignature).type
  let .error (.implicitOrInstanceArgument _) ← Vir.Interface.classifyHostImportSignature dataType
    | throwError "data-carrying instance accepted as a proof"
  let lateType := (← Lean.getConstInfo ``lateProofSignature).type
  let .error (.runtimeErasedParameterAfterArguments _) ← Vir.Interface.classifyHostImportSignature lateType
    | throwError "proof after runtime argument accepted"

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
example [React.Node.Shape α] (value : Js α) : Js React.Node := React.Node.ofJs value

example [React.Node.Shape α] (value : Js α) :
    Js.erase (React.Node.ofJs value) = Js.erase value := rfl

example (root : Js React.Root) (values : Js.Array (Js.UndefinedOr.Value (Js.Nullable.Value String))) :
    DomM Unit := React.Root.render root values

example (tag : Js React.ElementType) (props : Js React.Props) (values : Js.Array String) :
    React.ReactM (Js React.Node) := React.Node.createElement tag props values

example (props : Js React.Props) (values : Js.Array String) :
    React.ReactM (Js React.Node) := React.Node.fragment props values

example (props : Js React.Props) : React.ReactM (Js React.Node) := do
  React.Node.fragment props (← Js.Array.empty)

example (_root : Js React.Root) (_props : Js React.Props) (_object : Js.Object)
    (_values : Js.Array Js.Any.Value) : True := by
  fail_if_success have _ := React.Root.render _root _object
  fail_if_success have _ := React.Node.fragment _props _values
  trivial

example (node : Js React.Node) (text : Js String) (number : Js Float) (bigint : Js Nat)
    (flag : Js Bool) (absent : Js.Undefined) : True := by
  have _ := React.Node.ofJs node
  have _ := React.Node.ofJs text
  have _ := React.Node.ofJs number
  have _ := React.Node.ofJs bigint
  have _ := React.Node.ofJs flag
  have _ := React.Node.ofJs absent
  trivial

example (_object : Js.Object) (_any : Js.Any) (_lean : JSL String)
    (_pending : Js.Promise String) (_fn : Js.Function0 (Js String))
    (_values : Array (Js React.Node)) (_action : RuntimeM (Js String)) : True := by
  fail_if_success have _ := React.Node.ofJs _object
  fail_if_success have _ := React.Node.ofJs _any
  fail_if_success have _ := React.Node.ofJs _lean
  fail_if_success have _ := React.Node.ofJs _pending
  fail_if_success have _ := React.Node.ofJs _fn
  fail_if_success have _ := React.Node.ofJs _values
  fail_if_success have _ := React.Node.ofJs _action
  trivial

example : True := by
  fail_if_success have _ : React.Node.Shape Js.Object.Value := inferInstance
  trivial

example (node : Js React.Node) (text : Js String) (nodes : Js.Array React.Node) :
    React.ReactM (Js React.Node) := <div>{node}{text}{nodes}</div>

example (node : Js React.Node) :
    (<div>{node}</div> : React.ReactM (Js React.Node)) =
      <div>{React.Node.ofJs node}</div> := rfl

example (text : Js String) :
    (<div>{text}</div> : React.ReactM (Js React.Node)) =
      <div>{React.Node.ofJs text}</div> := rfl

example [React.Node.Shape α] (value : Js α) : React.ReactM (Js React.Node) :=
  <div>{value}</div>

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

example (s : Js String) (n : Js Float) (b : Js Bool) : RuntimeM (Js String) :=
  js#!"name={s}, number={n}, flag={b}"

example (value : Js.Any) : RuntimeM (Option (Js String)) := Js.cast? value
example (value : Js.Any) : RuntimeM (Option (Js Float)) := Js.cast? value
example (value : Js.Any) : RuntimeM (Except Js.TypeConvError (Js Bool)) := Js.cast value

example (_value : Js.Any) : True := by
  fail_if_success have _ : RuntimeM (Js String) := Js.Number.fromAny _value
  fail_if_success have _ : RuntimeM (Js Nat) := Js.Number.fromAny _value
  fail_if_success have _ : RuntimeM (Js Float) := Js.Boolean.fromAny _value
  trivial

example (_event : Js React.SyntheticEvent) : True := by
  fail_if_success have _ : DomM Unit := Browser.Event.preventDefault _event
  trivial

example (event : Js React.SyntheticEvent) : RuntimeM (Js Browser.Event) :=
  React.SyntheticEvent.nativeEvent event

example (_s : String) : True := by
  fail_if_success have _ : RuntimeM (Js String) := js#!"{_s}"
  trivial

example (values : Js.Array String) (p : Js.Function1 (Js String) (Js Bool)) :
    RuntimeM (Js.Array String) := Js.Array.filter (β := Bool) values p

example (values : Js.Array String) (p : Js.Function1 (Js String) (Js Float)) :
    RuntimeM (Js Bool) := Js.Array.some (β := Float) values p

example (values : Js.Array String) (f : Js.Function1 (Js String) Unit) :
    RuntimeM Unit := Js.Array.forEach values f

example (_values : Js.Array String) (_p : Js.Function1 (Js Float) (Js Bool)) : True := by
  fail_if_success have _ := Js.Array.filter _values _p
  trivial

example (reducer : Js (React.Reducer String Bool)) (initial : Js Float)
    (init : Js.Function1 (Js Float) (Js String)) :
    React.ReactM (Js (React.ReducerTuple String Bool)) :=
  React.Hooks.useReducerWithInit reducer initial init

example (_reducer : Js (React.Reducer String Bool)) (_initial : Js Float)
    (_initialize : Js.Function1 (Js String) (Js Float)) : True := by
  fail_if_success have _ := React.Hooks.useReducerWithInit _reducer _initial _initialize
  trivial

example (initial : Js.Nullable Element) :
    React.ReactM (Js (React.Ref (Js.Nullable Element))) := React.Hooks.useRef initial

example (initial : Js.UndefinedOr Element) :
    React.ReactM (Js (React.Ref (Js.UndefinedOr Element))) := React.Hooks.useRef initial

-- useCallback preserves the supported native call shape, including its result.
example (f : Js.Function0 (Js String)) (deps : Js React.DependencyList) :
    React.ReactM (Js.Function0 (Js String)) := React.Hooks.useCallback f deps

example (f : Js.Function1 (Js Float) (Js String)) (deps : Js React.DependencyList) :
    React.ReactM (Js.Function1 (Js Float) (Js String)) := React.Hooks.useCallback f deps

example (f : Js.Function2 Js.Any (Js String) Unit) (deps : Js React.DependencyList) :
    React.ReactM (Js.Function2 Js.Any (Js String) Unit) := React.Hooks.useCallback f deps

example (f : Js.Function3 Js.Any (Js Float) (Js String) Js.Any)
    (deps : Js React.DependencyList) :
    React.ReactM (Js.Function3 Js.Any (Js Float) (Js String) Js.Any) :=
  React.Hooks.useCallback f deps

example (_s : Js String) (_o : Js.Object) (_a : Js.Any) (_deps : Js React.DependencyList) : True := by
  fail_if_success have _ := React.Hooks.useCallback _s _deps
  fail_if_success have _ := React.Hooks.useCallback _o _deps
  fail_if_success have _ := React.Hooks.useCallback _a _deps
  trivial

example (f : Js.Function2 (Js String) (Js Float) (Js Bool)) (s : Js String) (n : Js Float) :
    RuntimeM (Js Bool) := Js.Function.call2 f s n

example (_f : Js.Function2 (Js String) (Js Float) (Js Bool))
    (_s : Js String) (_n : Js Float) (_void : Js.Function0 Unit) : True := by
  fail_if_success have _ := Js.Function.call _f _s
  fail_if_success have _ := Js.Function.call2 _f _n _s
  fail_if_success have _ := Js.Function.call2Void _f _s _n
  fail_if_success have _ := Js.Function.call0 _void
  trivial

example (s : Js String) (n : Js Float) (end_ : Js.UndefinedOr Float) : RuntimeM (Js String) :=
  Js.String.slice s n end_

example (a b : Js Float) : RuntimeM (Js Bool) := Js.Number.equal a b
example (a b : Js Nat) : RuntimeM (Js Nat) := Js.Nat.mul a b
example (a b : Js String) : RuntimeM (Js Bool) := Js.String.equal a b
example (b : Js Bool) : RuntimeM (Js Bool) := Js.Boolean.not b

example (_n : Js Nat) (_f : Js Float) (_s : String) : True := by
  fail_if_success have _ := Js.Number.add _n _n
  fail_if_success have _ := Js.Nat.mul _f _f
  fail_if_success have _ := Js.String.equal _s _s
  fail_if_success have _ : RuntimeM Bool := Js.Number.equal _f _f
  trivial

example (_console : Js Console) (_message : String) : True := by
  fail_if_success have _ := Console.log _console _message
  trivial

example (_ctx : Js CanvasRenderingContext2D) (_x _y _width _height : Float) : True := by
  fail_if_success have _ := CanvasRenderingContext2D.fillRect _ctx _x _y _width _height
  trivial
