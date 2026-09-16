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

namespace Initial

/-- Native `S | (() => S)`, with no tag or wrapper around the JavaScript value. -/
opaque Value (α : Type) : Type

/-- Passes the exact value; callable values retain React's initializer semantics. -/
@[inline] def ofValue (value : Lean.Vir.Js α) : Lean.Vir.Js (Value α) := by
  unfold Lean.Vir.Js at *
  exact value

/-- Passes the exact initializer without invoking it. React chooses when to call it. -/
@[inline] def ofInitializer
    (initializer : Lean.Vir.Js.Function0 (Lean.Vir.Js α)) :
    Lean.Vir.Js (Value α) := by
  unfold Lean.Vir.Js.Function0 Lean.Vir.Js at *
  exact initializer

end Initial

namespace SetStateAction

/-- Native `S | ((previous: S) => S)`, not a Lean sum or value wrapper. -/
opaque Value (α : Type) : Type

/-- Pass the exact value as React's state action; functions retain React's updater semantics. -/
@[inline] def ofValue (value : Lean.Vir.Js α) : Lean.Vir.Js (Value α) := by
  unfold Lean.Vir.Js at *
  exact value

/-- Pass the exact native updater as React's state action. -/
@[inline] def ofUpdater
    (update : Lean.Vir.Js.Function1 (Lean.Vir.Js α) (Lean.Vir.Js α)) :
    Lean.Vir.Js (Value α) := by
  unfold Lean.Vir.Js.Function1 Lean.Vir.Js at *
  exact update

end SetStateAction

/-- React's exact state setter, accepting either a value or a functional updater. -/
abbrev StateSetter (α : Type) : Type :=
  Lean.Vir.Js.Function.Unary (Lean.Vir.Js (SetStateAction.Value α)) Unit

/-- Native JavaScript reducer function accepted by `React.useReducer`. -/
abbrev Reducer (state action : Type) : Type :=
  Lean.Vir.Js.Function.Binary (Lean.Vir.Js state) (Lean.Vir.Js action) (Lean.Vir.Js state)

/-- React reducer dispatch function returned by `useReducer`. -/
abbrev ReducerDispatch (_state action : Type) : Type :=
  Lean.Vir.Js.Function.Unary (Lean.Vir.Js action) Unit

/-- Exact JavaScript array returned by `React.useState`. -/
abbrev StateTuple (α : Type) : Type :=
  Lean.Vir.Js.Tuple2.Value α (StateSetter α)

/-- Exact JavaScript array returned by `React.useReducer`. -/
abbrev ReducerTuple (state action : Type) : Type :=
  Lean.Vir.Js.Tuple2.Value state (ReducerDispatch state action)

/-- Native JavaScript calculation function accepted by `React.useMemo`. -/
abbrev MemoCalculation (α : Type) : Type :=
  Lean.Vir.Js.Function.Nullary (Lean.Vir.Js α)

/-- Native JavaScript setup function accepted by `React.useEffect`. -/
abbrev EffectCallback : Type :=
  Lean.Vir.Js.Function.Nullary
    (Lean.Vir.Js.UndefinedOr (Lean.Vir.Js.Function.Nullary Unit))

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

/-- Forget only the declared `data` field shape, preserving the native object. -/
@[inline] def WithData.asProps {α : Type}
    (value : Lean.Vir.Js (WithData α)) : Lean.Vir.Js Props := by
  unfold Lean.Vir.Js at *
  exact value

end Props

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
@[inline] def asElementType {props : Type}
    (component : FunctionComponent props) : Lean.Vir.Js ElementType := by
  unfold FunctionComponent Lean.Vir.Js.Function1 Lean.Vir.Js at *
  exact component

end FunctionComponent

/-- React dependency lists are ordinary JavaScript arrays. -/
abbrev DependencyList : Type :=
  Lean.Vir.Js.Array.Value Lean.Vir.Js.Any.Value

end Lean.Vir.React
