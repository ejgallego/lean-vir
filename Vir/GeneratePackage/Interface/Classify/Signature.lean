/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Interface.Classify.Core

public section

open Lean

namespace Vir.GeneratePackage

open Vir.InterfaceValidation

/-- A JavaScript-boundary signature after interface type classification. -/
public structure ClassifiedSignature where
  args : Array InterfaceArg
  result : InterfaceType
  effect : InterfaceEffect
  erasedPrefixArgs : Nat := 0

private def classifyResult (result : Lean.Expr) :
    CoreM (Except InterfaceClassifierError (InterfaceType × InterfaceEffect)) := do
  let effectResult ← effectResult? result
  let (effect, result) := effectResult.getD (.pure, result)
  match ← interfaceType result with
  | .error error => return .error (.inContext (.signatureResult result) error)
  | .ok resultType => return .ok (resultType, effect)

/--
Classify a marker-preflighted export signature without rescanning its binders.
Runtime layout and supported JavaScript types remain package-time concerns.
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

end Vir.GeneratePackage
