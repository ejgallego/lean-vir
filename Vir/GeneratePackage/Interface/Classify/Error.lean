/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean

public section

namespace Vir.GeneratePackage

/-- The declaration family involved in recursive and parameter-shape errors. -/
public inductive InterfaceAggregateKind where
  | inductive
  | structure
  deriving BEq, Repr

private def InterfaceAggregateKind.label : InterfaceAggregateKind → String
  | .inductive => "inductive"
  | .structure => "structure"

/-- A nested type-classification site that adds user-facing error context. -/
public inductive InterfaceClassifierContext where
  | callbackArgument (type : Lean.Expr)
  | callbackResult (type : Lean.Expr)
  | constructorPayload (constructor : Lean.Name) (type : Lean.Expr)
  | constructorField (field : String) (constructor : Lean.Name) (type : Lean.Expr)
  | structureField (field structureName : Lean.Name) (type : Lean.Expr)
  | arrayElement
  | listElement
  | optionElement
  | prodFst
  | prodSnd
  | signatureArgument (type : Lean.Expr)
  | signatureResult (type : Lean.Expr)
  deriving BEq, Repr

/-- A semantic failure from interface type or signature classification. -/
public inductive InterfaceClassifierError where
  | unsupportedType (type : Lean.Expr)
  | inContext (context : InterfaceClassifierContext) (cause : InterfaceClassifierError)
  | polymorphicCallbackParameter (name : Lean.Name)
  | implicitCallbackArgument (name : Lean.Name)
  | mutuallyRecursive (kind : InterfaceAggregateKind) (name : Lean.Name)
  | nonUniformRecursive (kind : InterfaceAggregateKind) (name : Lean.Name)
  | indexedInductive (name : Lean.Name)
  | indexedStructure (name : Lean.Name)
  | parameterCountMismatch (kind : InterfaceAggregateKind) (name : Lean.Name)
      (expected actual : Nat)
  | inductiveWithoutConstructors (name : Lean.Name)
  | constructorMissingDeclaration (constructor : Lean.Name)
  | constructorOwnerMismatch (constructor expectedOwner actualOwner : Lean.Name)
  | constructorInvalidType (constructor : Lean.Name) (type : Lean.Expr)
  | constructorImplicitFields (constructor : Lean.Name)
  | constructorLayoutUnavailable (constructor : Lean.Name)
  | constructorRuntimeFieldCount (constructor : Lean.Name) (actual : Nat)
  | constructorLayoutFieldCountMismatch (constructor : Lean.Name)
      (expected actual : Nat)
  | constructorErasedRuntimeLayout (constructor : Lean.Name)
  | constructorFieldErasedRuntimeLayout (field : String) (constructor : Lean.Name)
  | structureConstructorCount (name : Lean.Name) (actual : Nat)
  | emptyStructure (name : Lean.Name)
  | recursiveInheritedStructure (name : Lean.Name)
  | structureLayoutUnavailable (name : Lean.Name)
  | structureLayoutFieldCountMismatch (name : Lean.Name) (expected actual : Nat)
  | structureFieldErasedRuntimeLayout (field structureName : Lean.Name)
  | structureFieldMissingProjection (field structureName : Lean.Name)
  | structureFieldMissingProjectionDeclaration (field structureName : Lean.Name)
  | structureFieldInvalidProjectionType (field structureName : Lean.Name) (type : Lean.Expr)
  | jsMarkerOutsideResource (marker : Lean.Name)
  | runtimeErasedParameterAfterArguments (name : Lean.Name)
  | implicitOrInstanceArgument (name : Lean.Name)
  deriving BEq, Repr

private def InterfaceClassifierContext.wrap
    (context : InterfaceClassifierContext) (reason : String) : String :=
  match context with
  | .callbackArgument type =>
      s!"unsupported callback argument type `{type}`: {reason}"
  | .callbackResult type =>
      s!"unsupported callback result type `{type}`: {reason}"
  | .constructorPayload constructor type =>
      s!"constructor `{constructor}` has unsupported payload type `{type}`: {reason}"
  | .constructorField field constructor type =>
      s!"field `{field}` of constructor `{constructor}` has unsupported type `{type}`: {reason}"
  | .structureField field structureName type =>
      s!"field `{field}` of structure `{structureName}` has unsupported type `{type}`: {reason}"
  | .arrayElement => s!"unsupported Array element type: {reason}"
  | .listElement => s!"unsupported List element type: {reason}"
  | .optionElement => s!"unsupported Option element type: {reason}"
  | .prodFst => s!"unsupported Prod fst type: {reason}"
  | .prodSnd => s!"unsupported Prod snd type: {reason}"
  | .signatureArgument type => s!"unsupported argument type `{type}`: {reason}"
  | .signatureResult type => s!"unsupported result type `{type}`: {reason}"

/-- Render a typed classifier failure at a user-facing package boundary. -/
public def InterfaceClassifierError.message : InterfaceClassifierError → String
  | .unsupportedType type => s!"unsupported type `{type}`"
  | .inContext context cause => context.wrap cause.message
  | .polymorphicCallbackParameter name =>
      s!"unsupported polymorphic callback type parameter `{name}`"
  | .implicitCallbackArgument name =>
      s!"unsupported implicit/instance callback argument `{name}`"
  | .mutuallyRecursive kind name =>
      s!"mutually recursive {kind.label} `{name}` is not supported"
  | .nonUniformRecursive kind name =>
      s!"non-uniform recursive {kind.label} `{name}` is not supported"
  | .indexedInductive name => s!"indexed inductive `{name}` is not supported"
  | .indexedStructure name => s!"indexed structure `{name}` is not supported"
  | .parameterCountMismatch kind name expected actual =>
      s!"{kind.label} `{name}` expects {expected} parameter(s), got {actual}"
  | .inductiveWithoutConstructors name => s!"inductive `{name}` has no constructors"
  | .constructorMissingDeclaration constructor =>
      s!"constructor `{constructor}` has no declaration"
  | .constructorOwnerMismatch constructor expectedOwner _ =>
      s!"constructor `{constructor}` does not belong to `{expectedOwner}`"
  | .constructorInvalidType constructor type =>
      s!"constructor `{constructor}` has invalid type `{type}`"
  | .constructorImplicitFields constructor =>
      s!"constructor `{constructor}` has unsupported implicit/instance fields"
  | .constructorLayoutUnavailable constructor =>
      s!"could not compute runtime layout for constructor `{constructor}`"
  | .constructorRuntimeFieldCount constructor _ =>
      s!"constructor `{constructor}` must have exactly one runtime field"
  | .constructorLayoutFieldCountMismatch constructor _ _ =>
      s!"runtime layout for constructor `{constructor}` does not match its field count"
  | .constructorErasedRuntimeLayout constructor =>
      s!"constructor `{constructor}` has erased or void runtime layout"
  | .constructorFieldErasedRuntimeLayout field constructor =>
      s!"field `{field}` of constructor `{constructor}` has erased or void runtime layout"
  | .structureConstructorCount name _ =>
      s!"structure `{name}` must have exactly one constructor"
  | .emptyStructure name => s!"empty structure `{name}` is not supported"
  | .recursiveInheritedStructure name =>
      s!"recursive inherited structure `{name}` is not supported"
  | .structureLayoutUnavailable name =>
      s!"could not compute runtime layout for structure `{name}`"
  | .structureLayoutFieldCountMismatch name _ _ =>
      s!"runtime layout for structure `{name}` does not match its field count"
  | .structureFieldErasedRuntimeLayout field structureName =>
      s!"field `{field}` of structure `{structureName}` has erased or void runtime layout"
  | .structureFieldMissingProjection field structureName =>
      s!"field `{field}` of structure `{structureName}` is missing a projection function"
  | .structureFieldMissingProjectionDeclaration field structureName =>
      s!"field `{field}` of structure `{structureName}` has no projection declaration"
  | .structureFieldInvalidProjectionType field structureName type =>
      s!"field `{field}` of structure `{structureName}` has invalid projection type `{type}`"
  | .jsMarkerOutsideResource marker =>
      s!"JavaScript object marker `{marker}` must appear under `Lean.Vir.Js`; use `Lean.Vir.Js {marker}` at the boundary"
  | .runtimeErasedParameterAfterArguments name =>
      s!"unsupported runtime-erased type parameter `{name}` after runtime arguments"
  | .implicitOrInstanceArgument name =>
      s!"implicit or instance argument `{name}` is not supported; \
        declare a wrapper with only explicit arguments"

end Vir.GeneratePackage
