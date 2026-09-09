/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace Vir.Fixtures.CollectionTypeFidelity

open Lean.Vir
open Lean.Vir.React

-- Negative checks only elaborate candidate terms; no forged payload is executed.
set_option linter.unusedVariables false

def sameElement {α : Type} (value : Js α) (index : Js Float) : RuntimeM (Js α) := do
  let array ← Js.Array.empty
  let _ ← Js.Array.push array value
  Js.Array.getJs array index

def sameJSL {α : Type} (value : JSL α) (index : Js Float) : RuntimeM (JSL α) :=
  sameElement value index

def stateValue {α : Type} (tuple : Js (StateTuple (Js α))) : RuntimeM (Js α) :=
  StateTuple.value tuple

def stateSetter {α : Type} (tuple : Js (StateTuple (Js α))) :
    RuntimeM (Js (StateSetter (Js α))) :=
  StateTuple.setter tuple

def reducerValue {state action : Type} (tuple : Js (ReducerTuple state action)) :
    RuntimeM (Js state) :=
  ReducerTuple.value tuple

def reducerDispatch {state action : Type} (tuple : Js (ReducerTuple state action)) :
    RuntimeM (Js (ReducerDispatch state action)) :=
  ReducerTuple.dispatch tuple

def sameCallbackInput {α : Type} (value : JSL α) : RuntimeM Unit := do
  let callback ← Callback.ofUnary fun (_ : JSL α) => pure ()
  Js.Function.callVoid callback value

-- Unary callbacks preserve their argument type independently of collection
-- indexing and the JSL recovery implementation.
example (value : JSL String) : True := by
  fail_if_success
    have wrongCallbackInput : RuntimeM Unit := do
      let callback ← Callback.ofUnary fun (_ : JSL Nat) => pure ()
      Js.Function.callVoid callback value
  trivial

example {α β : Type} (array : Js.Array α) (index : Js Float) : True := by
  fail_if_success
    have wrong : RuntimeM (Js β) := Js.Array.getJs array index
  trivial

example {α β : Type} (array : Js.Array α) (value : Js β) : True := by
  fail_if_success
    have wrong : RuntimeM (Js Float) := Js.Array.push array value
  trivial

example (array : Js.Array (LeanRef.Handle String)) (index : Js Float) : True := by
  fail_if_success
    have forged : RuntimeM (JSL Nat) := Js.Array.getJs array index
  trivial

example (array : Js.Array Nat) (value : Nat) : True := by
  fail_if_success
    have rawLeanValue : RuntimeM (Js Float) := Js.Array.push array value
  trivial

example {α β : Type} (tuple : Js (StateTuple (Js α))) : True := by
  fail_if_success
    have erased : Js (StateTuple (Js β)) := tuple
  fail_if_success
    have wrongValue : RuntimeM (Js β) := StateTuple.value tuple
  fail_if_success
    have wrongSetter : RuntimeM (Js (StateSetter (Js β))) := StateTuple.setter tuple
  trivial

example {state action other : Type} (tuple : Js (ReducerTuple state action)) : True := by
  fail_if_success
    have erasedState : Js (ReducerTuple other action) := tuple
  fail_if_success
    have erasedAction : Js (ReducerTuple state other) := tuple
  fail_if_success
    have wrongValue : RuntimeM (Js other) := ReducerTuple.value tuple
  fail_if_success
    have wrongDispatch : RuntimeM (Js (ReducerDispatch state other)) := ReducerTuple.dispatch tuple
  trivial

example {α β : Type} (tuple : Js.Tuple2 (Js α) (Js β)) : True := by
  fail_if_success
    have wrongFirst : RuntimeM (Js β) := Js.Tuple2.first tuple
  fail_if_success
    have wrongSecond : RuntimeM (Js α) := Js.Tuple2.second tuple
  trivial

end Vir.Fixtures.CollectionTypeFidelity
