/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Interface.Classify.Signature

public section

open Lean

namespace Vir.HostValidation

open Vir.GeneratePackage

/-- The VIR attribute that selected a JavaScript host-import boundary. -/
public inductive HostImportMarker where
  | hostImport
  | explicitConversion
  deriving BEq, Repr

/-- The attribute name used to select a host-import boundary. -/
public def HostImportMarker.attributeName : HostImportMarker → Lean.Name
  | .hostImport => `vir_js
  | .explicitConversion => `vir_js_explicit_conversion

/-- A semantic failure from JavaScript host-boundary policy. -/
public inductive HostImportBoundaryError where
  | unsupportedArgument (name : String) (type : InterfaceType)
  | unsupportedResult (type : InterfaceType)
  | invalidExplicitConversion (target : String)
  deriving BEq, Repr

private def hostBoundaryKind : InterfaceType → String
  | .unit
  | .nat
  | .int
  | .bool
  | .string
  | .float
  | .float32
  | .uint8
  | .uint16
  | .uint32
  | .uint64
  | .usize
  | .byteArray
  | .expr => "raw Lean type"
  | .simpleEnum .. => "enum"
  | .taggedUnion .. => "tagged union"
  | .customInductive .. => "inductive"
  | .structure .. => "structure"
  | .recursiveSelf .. => "recursive type"
  | .array .. => "array"
  | .list .. => "list"
  | .option .. => "option"
  | .prod .. => "product"
  | .resource .. => "resource"
  | .function .. => "callback"
  | .leanObject => "opaque Lean object"

private def hostBoundaryTypeDiagnostic (type : InterfaceType) : String :=
  s!"{hostBoundaryKind type} `{type.label}` is not a JavaScript boundary type; \
    use `Unit`, `Lean.Vir.Js ...`, `Lean.Vir.Js.Nullable ...`, top-level callback arguments, \
    or explicit conversion calls"

/-- Render a host-boundary policy failure at an attribute or package boundary. -/
public def HostImportBoundaryError.message : HostImportBoundaryError → String
  | .unsupportedArgument name type =>
      s!"unsupported JavaScript import argument `{name}`: {hostBoundaryTypeDiagnostic type}"
  | .unsupportedResult type =>
      s!"unsupported JavaScript import result: {hostBoundaryTypeDiagnostic type}"
  | .invalidExplicitConversion target =>
      s!"declaration is marked with `@[vir_js_explicit_conversion]`, but `{target}` does not \
        convert between exactly one `Lean.Vir.Js ...` resource and one Lean value"

/-- A semantic failure from host-import signature analysis or boundary policy. -/
public inductive HostImportValidationError where
  | signature (error : InterfaceClassifierError)
  | boundary (error : HostImportBoundaryError)
  deriving BEq, Repr

/-- Render a host-import validation failure for a user-facing diagnostic. -/
public def HostImportValidationError.message : HostImportValidationError → String
  | .signature error => s!"unsupported JavaScript import signature: {error.message}"
  | .boundary error => error.message

/-- A host-import signature together with its validated runtime boundary. -/
public structure HostImportAnalysis where
  signature : ClassifiedSignature
  boundary : HostImportBoundary

private def isGenericJsResource : InterfaceType → Bool
  | .resource name label => name == `Lean.Vir.Js && label == "Js"
  | _ => false

private def isLeanObjectHandle : InterfaceType → Bool
  | .leanObject => true
  | _ => false

private def isExplicitConversionValue : InterfaceType → Bool
  | .resource ..
  | .function ..
  | .leanObject => false
  | _ => true

private def isHostResourceValueType : InterfaceType → Bool
  | .unit => true
  | .resource .. => true
  | _ => false

private def isHostResourceArgType : InterfaceType → Bool
  | .function args result _ =>
      args.all (fun (_, type) => isHostResourceValueType type) && isHostResourceValueType result
  | type => isHostResourceValueType type

private def isJsValueConversionSignature (signature : ClassifiedSignature) : Bool :=
  if signature.effect != .runtime then
    false
  else
    match signature.args[0]? with
    | some arg =>
        signature.args.size == 1 &&
          ((isGenericJsResource arg.type && isExplicitConversionValue signature.result) ||
            (isExplicitConversionValue arg.type && isGenericJsResource signature.result))
    | none => false

private def isLeanObjectHandleSignature
    (target : String) (signature : ClassifiedSignature) : Bool :=
  if signature.effect != .runtime then
    false
  else
    match target, signature.args[0]? with
    | "js.leanRef", some arg =>
        signature.args.size == 1 && isLeanObjectHandle arg.type &&
          isGenericJsResource signature.result
    | "js.leanRef.value", some arg =>
        signature.args.size == 1 && isGenericJsResource arg.type &&
          isLeanObjectHandle signature.result
    | "js.leanRef.retain", some arg =>
        signature.args.size == 1 && isGenericJsResource arg.type &&
          isGenericJsResource signature.result
    | "js.leanRef.release", some arg =>
        signature.args.size == 1 && isGenericJsResource arg.type && signature.result == .unit
    | _, _ => false

/-- Apply VIR's JavaScript host-boundary policy to a classified signature. -/
public def validateHostImportBoundary
    (marker : HostImportMarker) (target : String) (signature : ClassifiedSignature) :
    Except HostImportBoundaryError HostImportBoundary :=
  match marker with
  | .explicitConversion =>
      if isJsValueConversionSignature signature then
        .ok .explicitConversion
      else
        .error (.invalidExplicitConversion target)
  | .hostImport =>
      if isLeanObjectHandleSignature target signature then
        .ok .objectHandle
      else
        match signature.args.findSome? fun arg =>
            if isHostResourceArgType arg.type then
              none
            else
              some (.unsupportedArgument arg.name arg.type) with
        | some error => .error error
        | none =>
            if isHostResourceValueType signature.result then
              .ok .hostResource
            else
              .error (.unsupportedResult signature.result)

/-- Analyze a host-import signature and validate its JavaScript boundary. -/
public def analyzeHostImport
    (marker : HostImportMarker) (target : String) (type : Lean.Expr) :
    CoreM (Except HostImportValidationError HostImportAnalysis) := do
  match ← classifyHostImportSignature type with
  | .error error => return .error (.signature error)
  | .ok signature =>
      match validateHostImportBoundary marker target signature with
      | .error error => return .error (.boundary error)
      | .ok boundary => return .ok { signature, boundary }

end Vir.HostValidation
