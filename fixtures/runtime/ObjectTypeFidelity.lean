/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js
public import Vir.Browser.Generated

public section

namespace Vir.Fixtures.ObjectTypeFidelity

open Lean.Vir

set_option linter.unusedVariables false

def dynamicField {object : Type} (value : Js object) (name : Js String) : RuntimeM Js.Any :=
  Js.Object.get value name

def checkedStringField {object : Type} (value : Js object) (name : Js String) : RuntimeM (Js String) := do
  Js.String.fromAny (← Js.Object.get value name)

-- A concrete upstream field contract still provides a typed read directly.
def declaredTitle (document : Js Browser.Document) : Browser.DomM (Js String) :=
  Browser.Document.getTitle document

-- Compile only: neither the dynamic read nor its expected result type supplies
-- evidence for recovering a Lean payload or invoking a retyped callback.
example (object : Js.Object) (name : Js String) : True := by
  fail_if_success
    have forged : RuntimeM (JSL Nat) := Js.Object.get object name
  fail_if_success
    have forgedCallback : RuntimeM (Js.Function1 (JSL Nat) Unit) := Js.Object.get object name
  fail_if_success
    have uncheckedString : RuntimeM (Js String) := Js.Object.get object name
  trivial

example (value : Js.Any) : True := by
  fail_if_success
    have forged : RuntimeM (JSL String) := Js.String.fromAny value
  fail_if_success
    have arbitraryNarrowing : RuntimeM (Option (JSL Nat)) := Js.cast? value
  trivial

end Vir.Fixtures.ObjectTypeFidelity
