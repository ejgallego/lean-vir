/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Interface.Classify.Core

public section

open Lean

namespace Vir.Interface

open Vir.InterfaceValidation

/-- A JavaScript-boundary signature after interface type classification. -/
public structure ClassifiedSignature where
  args : Array InterfaceArg
  result : InterfaceType
  effect : InterfaceEffect
  erasedPrefixArgs : Nat := 0

/-- A failure while validating or classifying a complete export interface. -/
public inductive ExportInterfaceValidationError where
  | signature (error : ExportSignatureError)
  | classification (error : InterfaceClassifierError)
  deriving BEq, Repr

/-- Preserve a complete export-interface failure for Lean's user-facing diagnostics. -/
public def ExportInterfaceValidationError.toMessageData :
    ExportInterfaceValidationError → Lean.MessageData
  | .signature error => error.toMessageData
  | .classification error => error.toMessageData

private def classifyResult (result : Lean.Expr) :
    CoreM (Except InterfaceClassifierError (InterfaceType × InterfaceEffect)) := do
  let effectResult ← effectResult? result
  let (effect, result) := effectResult.getD (.pure, result)
  match ← interfaceType result with
  | .error error => return .error (.inContext (.signatureResult result) error)
  | .ok resultType => return .ok (resultType, effect)

/--
Classify a marker-preflighted export signature without rescanning its binders.
-/
def classifyExportSignature (signature : ExportSignature) :
    CoreM (Except InterfaceClassifierError ClassifiedSignature) := do
  let mut args : Array InterfaceArg := #[]
  for binder in signature.args do
    match ← interfaceType binder.type with
    | .error error =>
        return .error (.inContext (.signatureArgument binder.type) error)
    | .ok argType =>
        args := args.push {
          name := binderArgName (args.size + 1) binder.name
          type := argType
        }
  match ← classifyResult signature.result with
  | .error error => return .error error
  | .ok (result, effect) => return .ok { args, result, effect }

/-- Validate and classify a declaration's complete JavaScript export interface. -/
public def analyzeExportInterface (type : Lean.Expr) :
    CoreM (Except ExportInterfaceValidationError ClassifiedSignature) := do
  match ← analyzeExportSignature type with
  | .error error => return .error (.signature error)
  | .ok signature =>
      match ← classifyExportSignature signature with
      | .error error => return .error (.classification error)
      | .ok signature => return .ok signature

private partial def classifyHostImportSignatureLoop
    (type : Lean.Expr)
    (argIndex : Nat)
    (args : Array InterfaceArg)
    (erasedPrefixArgs : Nat) :
    CoreM (Except InterfaceClassifierError ClassifiedSignature) := do
  let type := stripMData type
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain then
        if args.isEmpty then
          classifyHostImportSignatureLoop body argIndex args (erasedPrefixArgs + 1)
        else
          return .error (.runtimeErasedParameterAfterArguments name)
      else if binderInfo != .default then
        return .error (.implicitOrInstanceArgument name)
      else
        match ← interfaceType domain with
        | .error error => return .error (.inContext (.signatureArgument domain) error)
        | .ok argType =>
            let arg := { name := binderArgName argIndex name, type := argType }
            classifyHostImportSignatureLoop body (argIndex + 1) (args.push arg) erasedPrefixArgs
  | result =>
      match ← classifyResult result with
      | .error error => return .error error
      | .ok (result, effect) => return .ok { args, result, effect, erasedPrefixArgs }

/-- Classify a JavaScript host import signature and its runtime-erased prefix. -/
def classifyHostImportSignature (type : Lean.Expr) :
    CoreM (Except InterfaceClassifierError ClassifiedSignature) :=
  classifyHostImportSignatureLoop type 1 #[] 0

end Vir.Interface
