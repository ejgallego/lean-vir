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
-- Policy controls intentionally inspect private traversal without exporting it.
meta import all Vir.Compiler.Interface.Classify.Core
meta import Vir.Compiler.Interface.Classify.Reduce

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

abbrev Nats := List Nat
abbrev MoreNats := List Nats
@[vir_export] def nestedAlias (xs : List Nats) : List Nats := xs
@[vir_export] def deeperAlias (xs : List MoreNats) : List MoreNats := xs

-- The nightly compiler spills fields beyond its inline object-slot limit.
inductive WideRecord where
  | mk
      (f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 : String)
      (f12 f13 f14 f15 f16 f17 f18 f19 f20 f21 f22 f23 : String)
      (f24 f25 f26 f27 f28 f29 f30 f31 f32 f33 f34 f35 : String)
      (f36 f37 f38 f39 f40 f41 f42 f43 f44 f45 f46 f47 : String)
      (f48 f49 f50 f51 f52 f53 f54 f55 f56 f57 f58 f59 : String)
      (f60 f61 f62 f63 f64 f65 f66 f67 f68 f69 f70 f71 : String)
      (f72 f73 f74 f75 f76 f77 f78 f79 f80 f81 f82 f83 : String)
      (f84 f85 f86 f87 f88 f89 f90 f91 f92 f93 f94 f95 : String)
      (f96 f97 f98 f99 f100 f101 f102 f103 f104 f105 f106 f107 : String)
      (f108 f109 f110 f111 f112 f113 f114 f115 f116 f117 f118 f119 : String)
      (f120 f121 f122 f123 f124 f125 f126 f127 f128 f129 f130 f131 : String)
      (f132 f133 f134 f135 f136 f137 f138 f139 f140 f141 f142 f143 : String)
      (f144 f145 f146 f147 f148 f149 f150 f151 f152 f153 f154 f155 : String)
      (f156 f157 f158 f159 f160 f161 f162 f163 f164 f165 f166 f167 : String)
      (f168 f169 f170 f171 f172 f173 f174 f175 f176 f177 f178 f179 : String)
      (f180 f181 f182 f183 f184 f185 f186 f187 f188 f189 f190 f191 : String)
      (f192 f193 f194 f195 f196 f197 f198 f199 f200 f201 f202 f203 : String)
      (f204 f205 f206 f207 f208 f209 f210 f211 f212 f213 f214 f215 : String)
      (f216 f217 f218 f219 f220 f221 f222 f223 f224 f225 f226 f227 : String)
      (f228 f229 f230 f231 f232 f233 f234 f235 f236 f237 f238 f239 : String)
      (f240 f241 f242 f243 f244 f245 f246 f247 f248 f249 f250 f251 : String)
      (f252 f253 f254 f255 : String)

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
  let .ok native := encoded.getObjVal? "native"
    | throwError "native descriptor missing"
  let .ok metadata := native.getObjVal? "metadata"
    | throwError "native metadata missing"
  let .ok constructors := (metadata.getObjVal? "constructors").bind Json.getArr?
    | throwError "constructor-name array missing"
  let .ok value := encoded.getObjVal? "value"
    | throwError "JavaScript value mapping missing"
  let .ok valueTag := value.getObjValAs? String "tag"
    | throwError "JavaScript value mapping tag missing"
  let labels ← if valueTag == "enum" then do
    let .ok labels := (value.getObjVal? "cases").bind Json.getArr?
      | throwError "enum case spellings missing"
    labels.mapM fun item =>
      match item.getStr? with
      | .ok label => pure label
      | .error _ => throwError "enum case spelling must be a string"
  else if valueTag == "variant" then do
    let .ok cases := (value.getObjVal? "cases").bind Json.getArr?
      | throwError "variant cases missing"
    cases.mapM fun item => do
      let .ok label := item.getObjValAs? String "kind"
        | throwError "variant spelling missing"
      pure label
  else throwError "constructor spelling mappings must use enum or variant values"
  expect "constructor count" (constructors.size == expected.size)
  expect "case spelling count" (labels.size == expected.size)
  for h : index in *...expected.size do
    let some constructor := constructors[index]?
      | throwError "constructor missing"
    let .ok name := constructor.getObjValAs? String "name"
      | throwError "constructor Name missing"
    let some label := labels[index]?
      | throwError "constructor spelling missing"
    expect "canonical constructor Name" (name == expected[index].1.toString)
    expect "relative constructor label" (label == expected[index].2)
    match constructor.getObjVal? "tag" with
    | .error _ => pure ()
    | .ok _ => throwError "constructor ordinal must come from table position"
    match constructor.getObjVal? "jsName" with
    | .error _ => pure ()
    | .ok _ => throwError "JavaScript spelling must live in the value mapping"

run_elab do
  let wide := mkConst ``WideRecord
  let .error wideError ← interfaceType wide
    | throwError "a spilled constructor must be rejected before encoding an interface"
  expect "spilled constructor reason"
    (errorCause wideError == .spilledRuntimeLayout "f254" ``WideRecord.mk)
  expect "spilled fields never alias inline slots"
    ((fieldLayout? (.spilled 1 0 (mkConst ``String))).isNone)
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
  let lists := mkApp (mkConst ``List [.zero])
  let .ok explicitNested ← interfaceType (lists (lists nat))
    | throwError "explicit nested Lists must be supported"
  let .ok aliasNested ← interfaceType (← argumentType ``nestedAlias)
    | throwError "abbreviated nested Lists must be supported"
  expect "abbreviated finite List descent" (aliasNested.toJson == explicitNested.toJson)
  let .ok explicitDeeper ← interfaceType (lists (lists (lists nat)))
    | throwError "explicit deeper Lists must be supported"
  let .ok aliasDeeper ← interfaceType (← argumentType ``deeperAlias)
    | throwError "deeper abbreviated Lists must be supported"
  expect "nested abbreviations preserve finite descent" (aliasDeeper.toJson == explicitDeeper.toJson)
  let .error growingError ← (classifyType (lists (lists nat)) #[⟨lists nat⟩]).run
    | throwError "a growing applied recursion context must stay rejected"
  expect "growing applied recursion reason"
    (errorCause growingError == .nonUniformRecursive .inductive ``List)
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
  let .customInductive `Option _ optionCtors := child.type
    | throwError "polymorphic tree Option must use generic constructors"
  let some optionSome := optionCtors[1]? | throwError "missing Option.some"
  let some optionValue := optionSome.fields[0]? | throwError "missing Option.some payload"
  expect "polymorphic tree self field"
    (optionValue.type == .recursiveRef ``PolyTree "InterfaceReduction.PolyTree Nat" 1)
  let polyCell := mkApp (mkConst ``PolyCell [.zero]) nat
  let .ok (.structure name _ descriptor) ← interfaceType polyCell
    | throwError "universe-polymorphic structure classification failed"
  expect "polymorphic structure owner" (name == ``PolyCell)
  let some next := descriptor.fields[1]? | throwError "polymorphic structure next field missing"
  let .customInductive `Option _ optionCtors := next.type
    | throwError "polymorphic projection Option must use generic constructors"
  let some optionSome := optionCtors[1]? | throwError "missing Option.some"
  let some optionValue := optionSome.fields[0]? | throwError "missing Option.some payload"
  expect "polymorphic projection self field"
    (optionValue.type == .recursiveRef ``PolyCell "InterfaceReduction.PolyCell Nat" 1)
  let universeTree := mkConst ``UniverseTree [.zero]
  let .ok (.customInductive _ _ _) ← interfaceType universeTree
    | throwError "universe-polymorphic parameter-free recursion failed"
  let .ok (.recursiveRef _ _ 0) ← (classifyType (.mdata {} universeTree) #[⟨universeTree⟩]).run
    | throwError "outer metadata must not alter recursion identity"
  let .error universeError ← (classifyType (mkConst ``UniverseTree [.succ .zero]) #[⟨universeTree⟩]).run
    | throwError "different universe instances must not share recursion identity"
  expect "universe identity reason" (errorCause universeError == .nonUniformRecursive .inductive ``UniverseTree)
  -- Existing metadata values, rather than their debug spelling, determine identity.
  let annotated (id : Nat) := mkApp (mkConst ``PolyTree [.zero])
    (.mdata (({} : MData).setNat `origin id) nat)
  let .error metadataError ← (classifyType (annotated 2) #[⟨annotated 1⟩]).run
    | throwError "distinct nested metadata must have distinct recursion keys"
  expect "nested metadata identity reason" (errorCause metadataError == .nonUniformRecursive .inductive ``PolyTree)
  let family (name : Name) (binder : BinderInfo) :=
    mkApp (mkConst ``FamilyTree) (.lam name nat string binder)
  for (original, changed) in #[
      (family `left .default, family `right .default),
      (family `left .default, family `left .implicit)] do
    expect "alpha equality is broader than recursion identity" (original == changed)
    let .error binderError ← (classifyType changed #[⟨original⟩]).run
      | throwError "binder syntax must remain part of structural identity"
    expect "binder identity reason" (errorCause binderError == .nonUniformRecursive .inductive ``FamilyTree)

  -- Declaration resolution precedes layout lookup in the selected producer path.
  let missingInductive := mkConst `MissingInductive
  let .error missingInductiveError ← (inductiveType #[] missingInductive).run
    | throwError "an absent inductive declaration must fail before layout lookup"
  expect "missing inductive declaration reason"
    (errorCause missingInductiveError == .unsupportedType missingInductive)
  let compilerErrorEscaped ← try
    let _ ← (withContext .arrayElement
      (liftM (throwError "compiler-exception-control" : CoreM InterfaceType) : ClassifyM InterfaceType)).run
    pure false
  catch _ => pure true
  expect "context adaptation must not catch compiler exceptions" compilerErrorEscaped

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
    let .error error ← (classifyType type context).run
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
  let .error nonuniformError ← (classifyType (.forallE `_arg (mkConst ``Unit) stringInstance .default)
      #[⟨natInstance⟩]).run
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
    "{\"native\":{\"type\":{\"tag\":\"leanObject\"},\"metadata\":{\"signature\":{\"args\":[{\"type\":{\"tag\":\"nat\"}}],\"result\":{\"type\":{\"tag\":\"string\"}},\"effect\":\"pure\"}}},\"value\":{\"tag\":\"function\",\"args\":[{\"tag\":\"bigint\"}],\"result\":{\"tag\":\"string\"}}}")
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
