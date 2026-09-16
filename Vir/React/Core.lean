/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React.Generated

/-!
Native React operations and small compositions over exact JavaScript values.
Native JSX notation lives in `Vir.ProofWidgets.Jsx`.
-/

public section

namespace Lean.Vir.React

/-- React's initializer overload, with exact input, initializer and reducer.
The identity-only definition keeps erased types out of the fixed-arity host ABI. -/
@[inline] def Hooks.useReducerWithInit {state action input : Type}
    (reducer : Lean.Vir.Js (Reducer state action)) (initial : Lean.Vir.Js input)
    (init : Lean.Vir.Js.Function1 (Lean.Vir.Js input) (Lean.Vir.Js state)) :
    ReactM (Lean.Vir.Js (ReducerTuple state action)) := by
  have invoke := Hooks.Internal.useReducerWithInit
  unfold Lean.Vir.Js.Function1 Lean.Vir.Js.Any Lean.Vir.Js at *
  exact invoke reducer initial init

namespace ElementType

/-- Views the exact native string as an element type, without a host call. -/
@[inline] def tag (tag : @& Lean.Vir.Js String) : ReactM (Lean.Vir.Js ElementType) := by
  unfold Lean.Vir.Js at *
  exact pure tag

end ElementType

/-- Creates a native function component from a Lean render callback. -/
def FunctionComponent.ofLean
    (render : Lean.Vir.Js props → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.RuntimeM (FunctionComponent props) :=
  Lean.Vir.Js.Function.ofLean render

namespace Node

/-- Views the exact native string as a text node, without a host call. -/
@[inline] def text (value : @& Lean.Vir.Js String) : ReactM (Lean.Vir.Js Node) :=
  pure (ofJs value)

@[inline] private def componentProps {α : Type}
    (props : Lean.Vir.Js α) : Lean.Vir.Js Props := by
  unfold Lean.Vir.Js at *
  exact props

/--
Builds an element from a native function component and its native props.
The function and its matching native props are passed directly to React.
-/
def functionComponent [Shape α]
    (component : @& FunctionComponent props)
    (props : @& Lean.Vir.Js props)
    (children : @& Lean.Vir.Js.Array α) :
    ReactM (Lean.Vir.Js Node) :=
  createElement (FunctionComponent.asElementType component) (componentProps props) children

end Node

end Lean.Vir.React
