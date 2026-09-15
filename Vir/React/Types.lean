/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser

public section

namespace Lean.Vir.React

/-- Source-level name for native React operations; the ordinary runtime effect,
not a purity or hook-ordering boundary. -/
abbrev ReactM (α : Type) : Type :=
  Lean.Vir.RuntimeM α

namespace ReactM

/-- Explicitly lowers a render-construction action at a browser/DOM boundary. -/
def run (action : ReactM α) : Lean.Vir.Browser.DomM α :=
  by
    unfold Lean.Vir.Browser.DomM
    exact action

end ReactM

/-- React root object class created from a browser container element. -/
opaque Root : Type

/-- React element type accepted by `React.createElement`. -/
opaque ElementType : Type

/-- React state setter function returned by `useState`. -/
abbrev StateSetter (α : Type) : Type :=
  Lean.Vir.Js.Function.Unary α Unit

/-- Native JavaScript reducer function accepted by `React.useReducer`. -/
opaque Reducer (state action : Type) : Type

/-- React reducer dispatch function returned by `useReducer`. -/
abbrev ReducerDispatch (_state action : Type) : Type :=
  Lean.Vir.Js.Function.Unary (Lean.Vir.Js action) Unit

/-- Exact JavaScript array returned by `React.useState`. -/
abbrev StateTuple (α : Type) : Type :=
  Lean.Vir.Js.Tuple2.Value α (StateSetter (Lean.Vir.Js α))

/-- Exact JavaScript array returned by `React.useReducer`. -/
abbrev ReducerTuple (state action : Type) : Type :=
  Lean.Vir.Js.Tuple2.Value state (ReducerDispatch state action)

/-- Native JavaScript calculation function accepted by `React.useMemo`. -/
opaque MemoCalculation (α : Type) : Type

/-- Native JavaScript setup function accepted by `React.useEffect`. -/
opaque EffectCallback : Type

/-- Lean source value explicitly converted to React's setup-function shape. -/
structure LeanEffect (value : Type) where
  setup : Lean.Vir.Browser.DomM (Lean.Vir.Js value)
  cleanup : Lean.Vir.Js value → Lean.Vir.Browser.DomM Unit

/-- Native unary JavaScript callback used by React and component props. -/
abbrev Callback (α : Type) : Type :=
  Lean.Vir.Js.Function.Unary (Lean.Vir.Js α) Unit

/-- Native React context object carrying JavaScript values of type `α`. -/
opaque Context (α : Type) : Type

/-- React ref object returned by `useRef`. -/
opaque Ref (α : Type) : Type

/-- React props are ordinary JavaScript objects. -/
abbrev Props : Type :=
  Lean.Vir.Js.Object.Value

namespace Props

/-- Native React props carrying one explicitly named Lean-backed `data` field. -/
opaque WithData (α : Type) : Type

@[inline] unsafe def withDataAsPropsImpl {α : Type}
    (value : Lean.Vir.Js (WithData α)) : Lean.Vir.Js Props := unsafeCast value

/-- Forget only the declared `data` field shape, preserving the native object. -/
@[implemented_by withDataAsPropsImpl]
axiom WithData.asProps {α : Type}
    (value : Lean.Vir.Js (WithData α)) : Lean.Vir.Js Props

end Props

/-- React state value and setter returned by `useState`. -/
structure State (α : Type) where
  value : α
  setter : Lean.Vir.Js (StateSetter α)

/-- React reducer value and dispatch function returned by `useReducer`. -/
structure ReducerState (state action : Type) where
  value : Lean.Vir.Js state
  dispatch : Lean.Vir.Js (ReducerDispatch state action)

/-- Native `ReactNode`: elements, text, empty values, child arrays and other
values accepted by React, not only `ReactElement` objects. -/
opaque Node : Type

/-- A native function component receiving JavaScript props directly from React. -/
abbrev FunctionComponent (props : Type) :=
  Lean.Vir.Js.Function1 (Lean.Vir.Js props) (Lean.Vir.Js Node)

namespace FunctionComponent

/--
Views a function component as the `React.ElementType` accepted by
`React.createElement`. This changes only the Lean phantom type: React receives
the exact same function object, so its component identity is preserved.
-/
@[inline] unsafe def asElementTypeImpl {props : Type}
    (component : FunctionComponent props) : Lean.Vir.Js ElementType :=
  unsafeCast component

@[implemented_by asElementTypeImpl]
axiom asElementType {props : Type}
    (component : FunctionComponent props) : Lean.Vir.Js ElementType

end FunctionComponent

/-- React dependency lists are ordinary JavaScript arrays. -/
abbrev DependencyList : Type :=
  Lean.Vir.Js.Array.Value Lean.Vir.Js.Any.Value

end Lean.Vir.React
