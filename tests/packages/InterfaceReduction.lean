/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js
public import Vir.Browser.Types
public import Vir.React.Types
public meta import Vir.Attributes
public meta import Vir.HostValidation

public section

namespace InterfaceReduction

structure Carrier where
  type : Type

@[expose] def stringCarrier : Carrier := ⟨String⟩
@[expose] def carrierOf (α : Type) : Carrier := ⟨α⟩
abbrev Text := stringCarrier.type

example : Text = String := rfl

def direct (x : String) : String := x
@[vir_export] def projected (x : Text) : Text := x
@[vir_export] def parameterized (x : (carrierOf String).type) : String := x

inductive FamilyValue (β : Nat → Type) where
  | mk (key : Nat) (value : β key)

@[vir_export] def constantFamily (x : FamilyValue (fun _ => String)) :
    FamilyValue (fun _ => String) := x

@[expose] def plainType : Type := String
opaque hiddenType : Type := String
opaque hiddenCarrier : Carrier := ⟨String⟩
@[irreducible, expose] def sealedCarrier : Carrier := ⟨String⟩
@[expose] def matchingCarrier : Nat → Carrier
  | 0 => ⟨String⟩
  | _ + 1 => ⟨Nat⟩

structure NestedCarrier where
  inner : Carrier

structure ParameterizedCarrier (α : Type) where
  type : Type
  fallback : α

structure FamilyCarrier where
  family : Nat → Type

inductive Indexed : Nat → Type where
  | zero : Indexed 0

structure ErasedField where
  type : Type
  value : Nat

meta section

open Lean Vir.Interface

private def expect (label : String) (ok : Bool) : CoreM Unit :=
  unless ok do throwError "interface reduction: {label}"

private def expectType (label : String) (e : Expr) (expected : InterfaceType) : CoreM Unit := do
  match ← interfaceType e with
  | .ok actual => expect label (actual == expected)
  | .error error => throwError "interface reduction: {label}: {error.toMessageData}"

private def rejected (label : String) (e : Expr) : CoreM Unit := do
  match ← interfaceType e with
  | .error _ => pure ()
  | .ok actual => throwError "interface reduction: {label} unexpectedly accepted {repr actual}"

private def argumentType (name : Name) : CoreM Expr := do
  let .forallE _ arg .. := (← getConstInfo name).type
    | throwError "expected unary declaration {name}"
  return arg

run_elab do
  for name in #[``direct, ``projected, ``parameterized] do
    expectType name.toString (← argumentType name) .string
  let string := mkConst ``String
  let record := mkApp (mkConst ``Carrier.mk) string
  let project := fun receiver => Expr.proj ``Carrier 0 receiver
  expectType "literal record" (project record) .string
  expectType "definition receiver" (project (mkConst ``stringCarrier)) .string
  expectType "generic receiver" (project (mkApp (mkConst ``carrierOf) string)) .string
  expectType "nested projection"
    (project (.proj ``NestedCarrier 0 (mkApp (mkConst ``NestedCarrier.mk) record))) .string
  expectType "constructor parameters are not fields"
    (.proj ``ParameterizedCarrier 0
      (mkAppN (mkConst ``ParameterizedCarrier.mk) #[mkConst ``Nat, string, mkNatLit 0])) .string
  let family := Expr.lam `key (mkConst ``Nat) string .default
  expectType "constant family with bound key" (mkApp family (.bvar 0)) .string
  expectType "projection then beta"
    (mkApp (.proj ``FamilyCarrier 0 (mkApp (mkConst ``FamilyCarrier.mk) family)) (.bvar 0)) .string
  expectType "beta then projection"
    (mkApp (.lam `key (mkConst ``Nat) (project record) .default) (.bvar 0)) .string
  -- The specialized dependent constructor must retain the concrete value ABI.
  match ← interfaceType (← argumentType ``constantFamily) with
  | .ok (.customInductive _ _ variants) =>
      let some (_, _, _, _, _, fields) := variants[0]? | throwError "missing constructor"
      expect "constant family field types" (fields.map (·.2.1) == #[.nat, .string])
  | result => throwError "constant family descriptor: {repr result}"

  for name in #[``hiddenCarrier, ``sealedCarrier] do
    rejected name.toString (project (mkConst name))
  rejected "no type-definition unfolding" (mkConst ``plainType)
  rejected "opaque type" (mkConst ``hiddenType)
  rejected "no match evaluation" (project (mkApp (mkConst ``matchingCarrier) (mkNatLit 0)))
  rejected "unresolved receiver" (project (.bvar 0))
  let dependent := mkApp (.lam `α (.sort (.succ .zero)) (.bvar 0) .default) (.bvar 0)
  rejected "beta must not expose generic bvar ABI" dependent
  let dependentArray := mkApp
    (.lam `α (.sort (.succ .zero)) (mkApp (mkConst ``Array [.zero]) (.bvar 0)) .default)
    (.bvar 0)
  rejected "beta must not hide dependency under container" dependentArray
  let letType := Expr.letE `t (.sort (.succ .zero)) string (.bvar 0) false
  rejected "no let evaluation" letType
  rejected "free receiver" (project (.fvar ⟨`unresolved⟩))
  rejected "metavariable receiver" (project (.mvar ⟨`unresolved⟩))
  rejected "wrong constructor owner" (.proj ``NestedCarrier 0 record)
  rejected "invalid field index" (.proj ``Carrier 1 record)
  rejected "partial record constructor" (project (mkConst ``Carrier.mk))
  -- Budget exhaustion must leave the expression alone, not expose a partial ABI.
  let deep := (List.range 40).foldl (fun ty _ => project (mkApp (mkConst ``Carrier.mk) ty)) string
  expect "budget leaves original type" ((← reduceTypeAliases deep) == deep)
  rejected "budget exhaustion" deep
  let indexed := mkApp (mkConst ``Indexed) (mkNatLit 0)
  for ty in #[indexed, mkConst ``ErasedField] do
    rejected "direct unsupported layout" ty
    rejected "projection cannot bypass layout rejection" (project (mkApp (mkConst ``Carrier.mk) ty))
    rejected "beta cannot bypass layout rejection"
      (mkApp (.lam `key (mkConst ``Nat) ty .default) (.bvar 0))

  -- Preserve supported ABI heads exactly, including through both new forms.
  for ty in #[mkConst ``Unit, mkConst ``Nat, mkConst ``String,
      mkApp (mkConst ``Array [.zero]) string,
      mkApp (mkConst ``Lean.Vir.Js) string,
      mkApp (mkConst ``IO) string, mkApp (mkConst ``Lean.Vir.RuntimeM) string,
      mkApp (mkConst ``Lean.Vir.Browser.DomM) string,
      mkApp (mkConst ``Lean.Vir.React.ReactM) string] do
    let wrapped := project (mkApp (mkConst ``Carrier.mk) ty)
    expect "preserved projected head" ((← reduceTypeAliases wrapped) == ty)
    expect "preserved beta head"
      ((← reduceTypeAliases (mkApp (.lam `key (mkConst ``Nat) ty .default) (.bvar 0))) == ty)
  let element := mkConst ``Lean.Vir.Browser.Element
  rejected "naked resource marker" (project (mkApp (mkConst ``Carrier.mk) element))
  let jsElement := mkApp (mkConst ``Lean.Vir.Js) element
  expectType "projected resource"
    (project (mkApp (mkConst ``Carrier.mk) jsElement))
    (.resource ``Lean.Vir.Browser.Element "Element")
  for (name, effect) in #[( ``IO, InterfaceEffect.io), (``Lean.Vir.RuntimeM, .runtime),
      (``Lean.Vir.Browser.DomM, .dom), (``Lean.Vir.React.ReactM, .react)] do
    let ty := project (mkApp (mkConst ``Carrier.mk) (mkApp (mkConst name) string))
    expect "effect identity" ((← effectResult? ty) == some (effect, string))
  -- A raw Lean string still cannot become a faithful JavaScript host argument.
  let signature : ClassifiedSignature := {
    args := #[{ name := "value", type := .string }], result := .unit, effect := .runtime }
  match Vir.HostValidation.validateHostImportBoundary .hostImport "test.string" signature with
  | .error (.unsupportedArgument "value" .string) => pure ()
  | _ => throwError "host boundary must still reject raw string"

end

end InterfaceReduction
