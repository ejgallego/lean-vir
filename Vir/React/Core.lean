/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React.Generated
import all Vir.React.Generated

/-!
Native React operations and small compositions over exact JavaScript values.
Lean HTML/props authoring helpers live in `Vir.React.Builders`.
-/

public section

namespace Lean.Vir.React

namespace StateSetter

def set
    (setter : @& Lean.Vir.Js (StateSetter (Lean.Vir.Js α)))
    (value : @& Lean.Vir.Js α) : Lean.Vir.RuntimeM Unit :=
  Lean.Vir.Js.Function.callVoid setter value

end StateSetter

namespace ReducerDispatch

def dispatch {state action : Type}
    (dispatch : Lean.Vir.Js (ReducerDispatch state action))
    (action : Lean.Vir.Js action) : Lean.Vir.RuntimeM Unit :=
  Lean.Vir.Js.Function.callVoid dispatch action

end ReducerDispatch

namespace StateTuple

def value {α : Type}
    (result : @& Lean.Vir.Js (StateTuple (Lean.Vir.Js α))) :
    Lean.Vir.RuntimeM (Lean.Vir.Js α) :=
  Lean.Vir.Js.Tuple2.first result

def setter {α : Type}
    (result : @& Lean.Vir.Js (StateTuple (Lean.Vir.Js α))) :
    Lean.Vir.RuntimeM (Lean.Vir.Js (StateSetter (Lean.Vir.Js α))) :=
  Lean.Vir.Js.Tuple2.second result

/-- Explicitly projects React's native `useState` result array into a Lean structure. -/
def toState {α : Type}
    (result : @& Lean.Vir.Js (StateTuple (Lean.Vir.Js α))) :
    Lean.Vir.RuntimeM (State (Lean.Vir.Js α)) := do
  let value ← StateTuple.value result
  let setter ← StateTuple.setter result
  pure { value, setter }

end StateTuple

namespace ReducerTuple

def value {state action : Type}
    (result : @& Lean.Vir.Js (ReducerTuple state action)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js state) :=
  Lean.Vir.Js.Tuple2.first result

def dispatch {state action : Type}
    (result : @& Lean.Vir.Js (ReducerTuple state action)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js (ReducerDispatch state action)) :=
  Lean.Vir.Js.Tuple2.second result

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

def empty : ReactM (Lean.Vir.Js DependencyList) := do
  Lean.Vir.Js.Array.empty

def push
    (deps : @& Lean.Vir.Js DependencyList)
    (value : @& Lean.Vir.Js α) : ReactM Unit := do
  let _ ← Lean.Vir.Js.Array.push deps (Lean.Vir.Js.erase value)
  pure ()

def ofArray {α : Type} (deps : @& Array (Lean.Vir.Js α)) :
    ReactM (Lean.Vir.Js DependencyList) := do
  let jsDeps ← empty
  for dep in deps do
    push jsDeps dep
  pure jsDeps

end DependencyList

/-- Calls React's native effect hook, omitting its dependency argument when absent. -/
def useEffect
    (setup : @& Lean.Vir.Js EffectCallback)
    (dependencies : Option (Lean.Vir.Js DependencyList) := none) :
    ReactM Unit :=
  match dependencies with
  | none => useEffectWithoutDeps setup
  | some deps => useEffectWithDeps setup deps

end Hooks

namespace State

def set (state : State (Lean.Vir.Js α)) (value : Lean.Vir.Js α) : Lean.Vir.RuntimeM Unit :=
  StateSetter.set state.setter value

def modify
    (state : State (Lean.Vir.Js α))
    (update : Lean.Vir.Js α → Lean.Vir.RuntimeM (Lean.Vir.Js α)) :
    Lean.Vir.RuntimeM Unit :=
  StateSetter.modify state.setter update

end State

end Lean.Vir.React
