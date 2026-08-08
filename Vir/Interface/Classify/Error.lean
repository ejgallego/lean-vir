/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean

public section

namespace Vir.Interface

/-- The declaration family involved in recursive and parameter-shape errors. -/
public inductive InterfaceAggregateKind where
  | inductive
  | structure
  deriving BEq, Repr

private def InterfaceAggregateKind.label : InterfaceAggregateKind → String
  | .inductive => "inductive"
  | .structure => "structure"

private def forceInlineFormat : Lean.Format → Lean.Format
  | .nil => .nil
  | .line => .text " "
  | .align _ => .nil
  | .text value => .text value
  | .nest _ format => forceInlineFormat format
  | .append left right => .append (forceInlineFormat left) (forceInlineFormat right)
  | .group format _ => forceInlineFormat format
  | .tag tag format => .tag tag (forceInlineFormat format)

/-- Pretty-print an expression as an inline diagnostic fragment while retaining term info. -/
private def inlineExprMessage (type : Lean.Expr) : Lean.MessageData :=
  Lean.MessageData.lazy
    (fun context => do
      let formatted ← Lean.ppExprWithInfos context type
      return .ofFormatWithInfos { formatted with fmt := forceInlineFormat formatted.fmt })
    (hasSyntheticSorry := fun mctx =>
      (Lean.instantiateMVarsCore mctx type).1.hasSyntheticSorry)
    (onMissingContext := fun _ => pure (.ofFormat (.text (toString type))))

private def quotedExpr (type : Lean.Expr) : Lean.MessageData :=
  m!"`{inlineExprMessage type}`"

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
    (context : InterfaceClassifierContext) (reason : Lean.MessageData) : Lean.MessageData :=
  match context with
  | .callbackArgument type =>
      m!"unsupported callback argument type {quotedExpr type}: {reason}"
  | .callbackResult type =>
      m!"unsupported callback result type {quotedExpr type}: {reason}"
  | .constructorPayload constructor type =>
      m!"constructor `{constructor}` has unsupported payload type {quotedExpr type}: {reason}"
  | .constructorField field constructor type =>
      m!"field `{field}` of constructor `{constructor}` has unsupported type {quotedExpr type}: {reason}"
  | .structureField field structureName type =>
      m!"field `{field}` of structure `{structureName}` has unsupported type {quotedExpr type}: {reason}"
  | .arrayElement => m!"unsupported Array element type: {reason}"
  | .listElement => m!"unsupported List element type: {reason}"
  | .optionElement => m!"unsupported Option element type: {reason}"
  | .prodFst => m!"unsupported Prod fst type: {reason}"
  | .prodSnd => m!"unsupported Prod snd type: {reason}"
  | .signatureArgument type => m!"unsupported argument type {quotedExpr type}: {reason}"
  | .signatureResult type => m!"unsupported result type {quotedExpr type}: {reason}"

/-- Preserve a typed classifier failure for Lean's user-facing pretty printer. -/
public def InterfaceClassifierError.toMessageData : InterfaceClassifierError → Lean.MessageData
  | .unsupportedType type => m!"unsupported type {quotedExpr type}"
  | .inContext context cause => context.wrap cause.toMessageData
  | .polymorphicCallbackParameter name =>
      m!"unsupported polymorphic callback type parameter `{name}`"
  | .implicitCallbackArgument name =>
      m!"unsupported implicit/instance callback argument `{name}`"
  | .mutuallyRecursive kind name =>
      m!"mutually recursive {kind.label} `{name}` is not supported"
  | .nonUniformRecursive kind name =>
      m!"non-uniform recursive {kind.label} `{name}` is not supported"
  | .indexedInductive name => m!"indexed inductive `{name}` is not supported"
  | .indexedStructure name => m!"indexed structure `{name}` is not supported"
  | .parameterCountMismatch kind name expected actual =>
      m!"{kind.label} `{name}` expects {expected} parameter(s), got {actual}"
  | .inductiveWithoutConstructors name => m!"inductive `{name}` has no constructors"
  | .constructorMissingDeclaration constructor =>
      m!"constructor `{constructor}` has no declaration"
  | .constructorOwnerMismatch constructor expectedOwner _ =>
      m!"constructor `{constructor}` does not belong to `{expectedOwner}`"
  | .constructorInvalidType constructor type =>
      m!"constructor `{constructor}` has invalid type {quotedExpr type}"
  | .constructorImplicitFields constructor =>
      m!"constructor `{constructor}` has unsupported implicit/instance fields"
  | .constructorLayoutUnavailable constructor =>
      m!"could not compute runtime layout for constructor `{constructor}`"
  | .constructorRuntimeFieldCount constructor _ =>
      m!"constructor `{constructor}` must have exactly one runtime field"
  | .constructorLayoutFieldCountMismatch constructor _ _ =>
      m!"runtime layout for constructor `{constructor}` does not match its field count"
  | .constructorErasedRuntimeLayout constructor =>
      m!"constructor `{constructor}` has erased or void runtime layout"
  | .constructorFieldErasedRuntimeLayout field constructor =>
      m!"field `{field}` of constructor `{constructor}` has erased or void runtime layout"
  | .structureConstructorCount name _ =>
      m!"structure `{name}` must have exactly one constructor"
  | .emptyStructure name => m!"empty structure `{name}` is not supported"
  | .recursiveInheritedStructure name =>
      m!"recursive inherited structure `{name}` is not supported"
  | .structureLayoutUnavailable name =>
      m!"could not compute runtime layout for structure `{name}`"
  | .structureLayoutFieldCountMismatch name _ _ =>
      m!"runtime layout for structure `{name}` does not match its field count"
  | .structureFieldErasedRuntimeLayout field structureName =>
      m!"field `{field}` of structure `{structureName}` has erased or void runtime layout"
  | .structureFieldMissingProjection field structureName =>
      m!"field `{field}` of structure `{structureName}` is missing a projection function"
  | .structureFieldMissingProjectionDeclaration field structureName =>
      m!"field `{field}` of structure `{structureName}` has no projection declaration"
  | .structureFieldInvalidProjectionType field structureName type =>
      m!"field `{field}` of structure `{structureName}` has invalid projection type {quotedExpr type}"
  | .jsMarkerOutsideResource marker =>
      m!"JavaScript object marker `{marker}` must appear under `Lean.Vir.Js`; use `Lean.Vir.Js {marker}` at the boundary"
  | .runtimeErasedParameterAfterArguments name =>
      m!"unsupported runtime-erased type parameter `{name}` after runtime arguments"
  | .implicitOrInstanceArgument name =>
      m!"implicit or instance argument `{name}` is not supported; \
        declare a wrapper with only explicit arguments"

end Vir.Interface
