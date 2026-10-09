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
public meta import Vir.Compiler.HostValidation
public meta import Vir.Compiler.Interface.Encode

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

def valueCallback (_f : (value : Nat) → String) : Unit := ()
def hostCallback (_f : (value : Lean.Vir.Js String) → Lean.Vir.RuntimeM Unit) :
    Lean.Vir.RuntimeM Unit := pure ()

def erasedHost {α : Type} (_proof : True) (_left _right : Lean.Vir.Js String) :
    Lean.Vir.RuntimeM Unit := pure ()

inductive «Constructor.names» where
  | «left.value» (value : Nat)
  | right (value : String)

inductive Status where
  | ready
  | done

inductive CallbackNode where
  | done
  | next (resume : Unit → CallbackNode)

inductive CallbackParam (α : Type) where
  | done
  | next (resume : Unit → CallbackParam α)

mutual
inductive CallbackLeft where
  | next (resume : Unit → CallbackRight)
inductive CallbackRight where
  | next (resume : Unit → CallbackLeft)
end

inductive OrdinaryTree where
  | leaf
  | next (child : Option OrdinaryTree)

universe u

inductive PolyTree (α : Type u) where
  | leaf (value : α)
  | next (child : Option (PolyTree α))

structure PolyCell (α : Type u) where
  value : α
  next : Option (PolyCell α)

inductive UniverseTree : Type u where
  | leaf
  | next (child : Option UniverseTree)

@[vir_export] def polymorphicTreeIdentity (value : PolyTree Nat) : PolyTree Nat := value
@[vir_export] def polymorphicCellIdentity (value : PolyCell Nat) : PolyCell Nat := value

inductive FamilyTree (β : Nat → Type) where
  | leaf (value : β 0)
  | next (child : Option (FamilyTree β))

-- A complete callback result descriptor owns its own recursion.
def treeCallback (_f : Unit → OrdinaryTree) : Unit := ()

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

private def errorCause : InterfaceClassifierError → InterfaceClassifierError
  | .inContext _ cause => errorCause cause
  | error => error

private def argumentType (name : Name) : CoreM Expr := do
  let .forallE _ arg .. := (← getConstInfo name).type
    | throwError "expected unary declaration {name}"
  return arg

private def expectConstructorNames (type : Expr) (expected : Array (Name × String)) : CoreM Unit := do
  let .ok descriptor ← interfaceType type
    | throwError "constructor-name classification failed"
  let .ok encoded := Json.parse descriptor.toJson
    | throwError "constructor-name JSON failed"
  let .ok constructors := (encoded.getObjVal? "constructors").bind Json.getArr?
    | throwError "constructor-name array missing"
  expect "constructor count" (constructors.size == expected.size)
  for h : index in *...expected.size do
    let some constructor := constructors[index]?
      | throwError "constructor missing"
    let .ok name := constructor.getObjValAs? String "name"
      | throwError "constructor Name missing"
    let .ok label := constructor.getObjValAs? String "jsName"
      | throwError "constructor label missing"
    let .ok tag := constructor.getObjValAs? Nat "tag"
      | throwError "constructor tag missing"
    expect "canonical constructor Name" (name == expected[index].1.toString)
    expect "relative constructor label" (label == expected[index].2)
    expect "constructor order" (tag == index)

run_elab do
  for name in #[``direct, ``projected, ``parameterized] do
    expectType name.toString (← argumentType name) .string
  let string := mkConst ``String
  expectType "nested metadata" (.mdata {} (.mdata {} string)) .string
  for (typeName, ctorName, expected) in #[
      (`Owner, `Owner.mk, "mk"),
      (`Owner, `Other.mk, "Other.mk"),
      (`Owner, `Owner, "Owner"),
      (Name.num `Owner 7, Name.str (Name.num `Owner 7) "mk", "mk")] do
    expect "structural constructor label" (constructorLabel typeName ctorName == expected)
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
      let some constructor := variants[0]? | throwError "missing constructor"
      expect "constant family field types" (constructor.fields.map (·.type) == #[.nat, .string])
  | result => throwError "constant family descriptor: {repr result}"

  -- Compare actual classified constructor metadata with independent wire labels.
  let .forallE _ familyType .. := (← getConstInfo ``constantFamily).type
    | throwError "family argument missing"
  expectConstructorNames familyType #[( ``FamilyValue.mk, "mk")]
  let nat := mkConst ``Nat
  expectConstructorNames (mkApp2 (mkConst ``Sum [.zero, .zero]) nat string)
    #[( `Sum.inl, "inl"), (`Sum.inr, "inr")]
  expectConstructorNames (mkApp2 (mkConst ``Except [.zero, .zero]) string nat)
    #[( `Except.error, "error"), (`Except.ok, "ok")]
  expectConstructorNames (mkConst ``«Constructor.names»)
    #[( ``«Constructor.names».«left.value», "«left.value»"), (``«Constructor.names».right, "right")]
  expectConstructorNames (mkConst ``Status) #[( ``Status.ready, "ready"), (``Status.done, "done")]

  -- Applied declaration universes reach recursively synthesized field types.
  let polyTree := mkApp (mkConst ``PolyTree [.zero]) nat
  let .ok (.customInductive name _ variants) ← interfaceType polyTree
    | throwError "universe-polymorphic tree classification failed"
  expect "polymorphic tree owner" (name == ``PolyTree)
  let some next := variants[1]? | throwError "polymorphic tree next constructor missing"
  let some child := next.fields[0]? | throwError "polymorphic tree child field missing"
  expect "polymorphic tree self field"
    (child.type == .option (.recursiveSelf ``PolyTree "InterfaceReduction.PolyTree Nat"))
  let polyCell := mkApp (mkConst ``PolyCell [.zero]) nat
  let .ok (.structure name _ descriptor) ← interfaceType polyCell
    | throwError "universe-polymorphic structure classification failed"
  expect "polymorphic structure owner" (name == ``PolyCell)
  let some next := descriptor.fields[1]? | throwError "polymorphic structure next field missing"
  expect "polymorphic projection self field"
    (next.type == .option (.recursiveSelf ``PolyCell "InterfaceReduction.PolyCell Nat"))
  let universeTree := mkConst ``UniverseTree [.zero]
  let .ok (.customInductive _ _ _) ← interfaceType universeTree
    | throwError "universe-polymorphic parameter-free recursion failed"
  let .ok (.recursiveSelf _ _) ← interfaceType (.mdata {} universeTree) #[⟨universeTree⟩]
    | throwError "outer metadata must not alter recursion identity"
  let .error universeError ← interfaceType (mkConst ``UniverseTree [.succ .zero]) #[⟨universeTree⟩]
    | throwError "different universe instances must not share recursion identity"
  expect "universe identity reason" (errorCause universeError == .nonUniformRecursive .inductive ``UniverseTree)
  -- Existing metadata values, rather than their debug spelling, determine identity.
  let annotated (id : Nat) := mkApp (mkConst ``PolyTree [.zero])
    (.mdata (({} : MData).setNat `origin id) nat)
  let .error metadataError ← interfaceType (annotated 2) #[⟨annotated 1⟩]
    | throwError "distinct nested metadata must have distinct recursion keys"
  expect "nested metadata identity reason" (errorCause metadataError == .nonUniformRecursive .inductive ``PolyTree)
  let family (name : Name) (binder : BinderInfo) :=
    mkApp (mkConst ``FamilyTree) (.lam name nat string binder)
  for (original, changed) in #[
      (family `left .default, family `right .default),
      (family `left .default, family `left .implicit)] do
    expect "alpha equality is broader than recursion identity" (original == changed)
    let .error binderError ← interfaceType changed #[⟨original⟩]
      | throwError "binder syntax must remain part of structural identity"
    expect "binder identity reason" (errorCause binderError == .nonUniformRecursive .inductive ``FamilyTree)

  -- Callback invocation has no enclosing aggregate owner: fail finitely.
  let node := mkConst ``CallbackNode
  let .error nodeError ← interfaceType node
    | throwError "recursive callback aggregate must be rejected"
  expect "recursive callback result reason"
    (errorCause nodeError == .recursiveCallback ``CallbackNode)
  let context : RecursiveSeen := #[⟨node⟩]
  for type in #[
      .forallE `_arg node (mkConst ``Unit) .default,
      mkApp (mkConst ``IO) node,
      .forallE `_arg (mkConst ``Unit) (mkApp (mkConst ``Option [.zero]) node) .default,
      .forallE `_arg (mkConst ``Unit)
        (mkApp2 (mkConst ``Sum [.zero, .zero]) node string) .default] do
    let .error error ← interfaceType type context
      | throwError "recursive callback boundary must be rejected"
    expect "callback argument/effect/container owner diagnostic"
      (errorCause error == .recursiveCallback ``CallbackNode)
  let .ok (.function _ (.customInductive name _ _) .pure) ←
      interfaceType (← argumentType ``treeCallback)
    | throwError "callback returning complete recursive descriptor must stay supported"
  expect "complete callback result owner" (name == ``OrdinaryTree)
  let .error mutualError ← interfaceType (mkConst ``CallbackLeft)
    | throwError "mutual recursion through callbacks must be rejected"
  expect "mutual callback recursion reason"
    (errorCause mutualError == .mutuallyRecursive .inductive ``CallbackLeft)
  let natInstance := mkApp (mkConst ``CallbackParam [.zero]) (mkConst ``Nat)
  let stringInstance := mkApp (mkConst ``CallbackParam [.zero]) string
  let .error nonuniformError ← interfaceType
      (.forallE `_arg (mkConst ``Unit) stringInstance .default)
      #[⟨natInstance⟩]
    | throwError "nonuniform recursive callback context must be rejected"
  expect "nonuniform callback recursion reason"
    (errorCause nonuniformError == .nonUniformRecursive .inductive ``CallbackParam)

  let .ok erasedSignature ← classifyHostImportSignature (← getConstInfo ``erasedHost).type
    | throwError "erased-prefix host signature classification failed"
  expect "host erased prefix retains argument numbering"
    (erasedSignature.erasedPrefixArgs == 2 &&
      erasedSignature.args.map (·.name) == #["arg1", "arg2"])

  -- Classify real callback binders and retain their independent wire contract.
  let .ok callback ← interfaceType (← argumentType ``valueCallback)
    | throwError "value callback classification failed"
  match callback with
  | .function args .string .pure =>
      expect "named callback argument" (args == #[{ name := "value", type := .nat }])
  | result => throwError "value callback descriptor: {repr result}"
  expect "callback encoding" (callback.toJson ==
    "{\"type\":\"Function\",\"interfaceTag\":24,\"kind\":\"function\",\"effect\":\"pure\",\"args\":[{\"name\":\"value\",\"type\":{\"type\":\"Nat\",\"interfaceTag\":0}}],\"result\":{\"type\":\"String\",\"interfaceTag\":3}}")
  let .ok valueSignature ← analyzeExportInterface (← getConstInfo ``valueCallback).type
    | throwError "value callback signature failed"
  match Vir.HostValidation.validateHostImportBoundary .hostImport "test.valueCallback" valueSignature with
  | .error _ => pure ()
  | .ok _ => throwError "raw Lean callback values must not become JS host values"
  let .ok hostSignature ← analyzeExportInterface (← getConstInfo ``hostCallback).type
    | throwError "host callback signature failed"
  match Vir.HostValidation.validateHostImportBoundary .hostImport "test.hostCallback" hostSignature with
  | .ok _ => pure ()
  | .error error => throwError "JS callback boundary rejected: {repr error}"

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
  rejected "naked internal handle" (mkConst ``Lean.Vir.JsHandle)
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
