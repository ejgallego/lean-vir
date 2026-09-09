/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js

public section

namespace Vir.Fixtures.PromiseTypeFidelity

open Lean.Vir

set_option linter.unusedVariables false

def value {α β : Type} (p : Js.Promise α) (f : Js.Function1 (Js α) (Js β)) :
    RuntimeM (Js.Promise β) := Js.Promise.thenValue p f

def promise {α β : Type} (p : Js.Promise α) (f : Js.Function1 (Js α) (Js.Promise β)) :
    RuntimeM (Js.Promise β) := Js.Promise.thenPromise p f

def both {α β : Type} (p : Js.Promise α) (f : Js.Function1 (Js α) (Js β))
    (g : Js.Function1 Js.Any (Js β)) : RuntimeM (Js.Promise β) :=
  Js.Promise.thenValueWithRejection p f g

def recover {α : Type} (p : Js.Promise α) (g : Js.Function1 Js.Any (Js α)) :
    RuntimeM (Js.Promise α) := Js.Promise.catchValue p g

def discard {α : Type} (p : Js.Promise α) (f : Js.Function1 (Js α) Unit) :
    RuntimeM (Js.Promise Js.Undefined.Value) := Js.Promise.thenVoid p f

def discardBoth {α : Type} (p : Js.Promise α) (f : Js.Function1 (Js α) Unit)
    (g : Js.Function1 Js.Any Unit) : RuntimeM (Js.Promise Js.Undefined.Value) :=
  Js.Promise.thenVoidWithRejection p f g

-- Like the explicit TS subset, this does not compute Awaited or establish
-- runtime settlement shape. Compile only; no foreign payload is executed.
def selectedNested (p : Js.Promise String)
    (f : Js.Function1 (Js String) (Js.Promise String)) :
    RuntimeM (Js.Promise (Js.Promise.Value String)) := Js.Promise.thenValue p f

example (p : Js.Promise String) (typedError : Js.Function1 (Js String) (Js String))
    (forgedError : Js.Function1 (JSL Nat) (Js String))
    (differentResult : Js.Function1 Js.Any (Js Float)) : True := by
  fail_if_success
    have bad := Js.Promise.catchValue p typedError
  fail_if_success
    have bad := Js.Promise.catchValue p forgedError
  fail_if_success
    have bad := Js.Promise.catchValue p differentResult
  fail_if_success
    have bad := Js.Promise.thenValueWithRejection p typedError differentResult
  fail_if_success
    have bad : RuntimeM (Js.Promise Float) := Js.Promise.thenValue p typedError
  trivial

example (p : Js.Promise String) (wrongInput : Js.Function1 (Js Float) (Js String))
    (wrongPromiseInput : Js.Function1 (Js Float) (Js.Promise String)) : True := by
  fail_if_success
    have bad := Js.Promise.thenValue p wrongInput
  fail_if_success
    have bad := Js.Promise.thenPromise p wrongPromiseInput
  trivial

end Vir.Fixtures.PromiseTypeFidelity
