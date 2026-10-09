/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Compiler.Interface.Classify.Core
public import Vir.Compiler.InterfaceValidation
import Vir.Compiler.Interface.Classify.Basic
import Vir.Compiler.Interface.Classify.Reduce

public section

open Lean

namespace Vir.Interface

open Vir.InterfaceValidation

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

private abbrev ClassifyM := ExceptT InterfaceClassifierError CoreM

private def classifyResult (result : Lean.Expr) : ClassifyM (InterfaceType × InterfaceEffect) := do
  let effectResult ← effectResult? result
  let (effect, result) := effectResult.getD (.pure, result)
  let resultType ← ExceptT.adapt (.inContext (.signatureResult result)) (ExceptT.mk (interfaceType result))
  return (resultType, effect)

/-- Classify a marker-preflighted export signature without rescanning its binders. -/
def classifyExportSignature (signature : ExportSignature) :
    CoreM (Except InterfaceClassifierError ClassifiedSignature) := ExceptT.run do
  let mut args : Array InterfaceArg := #[]
  for binder in signature.args do
    let argType ← ExceptT.adapt (.inContext (.signatureArgument binder.type))
      (ExceptT.mk (interfaceType binder.type))
    args := args.push { name := binderArgName (args.size + 1) binder.name, type := argType }
  let (result, effect) ← classifyResult signature.result
  return { args, result, effect }

/-- Validate and classify a declaration's complete JavaScript export interface. -/
public def analyzeExportInterface (type : Lean.Expr) :
    CoreM (Except ExportInterfaceValidationError ClassifiedSignature) := ExceptT.run do
  let signature ← ExceptT.adapt .signature (ExceptT.mk (analyzeExportSignature type))
  ExceptT.adapt .classification (ExceptT.mk (classifyExportSignature signature))

private partial def classifyHostImportSignatureLoop
    (type : Lean.Expr)
    (proofBinders : Array Bool)
    (args : Array InterfaceArg)
    (erasedPrefixArgs : Nat) : ClassifyM ClassifiedSignature := do
  let type := type.consumeMData
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain || proofBinders[erasedPrefixArgs + args.size]?.getD false then
        if args.isEmpty then
          classifyHostImportSignatureLoop body proofBinders args (erasedPrefixArgs + 1)
        else
          throwThe InterfaceClassifierError (.runtimeErasedParameterAfterArguments name)
      else if binderInfo != .default then
        throwThe InterfaceClassifierError (.implicitOrInstanceArgument name)
      else
        let argType ← ExceptT.adapt (.inContext (.signatureArgument domain)) (ExceptT.mk (interfaceType domain))
        let arg := { name := binderArgName (args.size + 1) name, type := argType }
        classifyHostImportSignatureLoop body proofBinders (args.push arg) erasedPrefixArgs
  | result =>
      let (result, effect) ← classifyResult result
      return { args, result, effect, erasedPrefixArgs }

/-- Classify a JavaScript host import signature and its leading type/proof slots.
Proof classification uses the elaborated telescope, never an instance's name or
binder syntax. Data-carrying instances remain unsupported. -/
def classifyHostImportSignature (type : Lean.Expr) :
    CoreM (Except InterfaceClassifierError ClassifiedSignature) := do
  let proofs ← Meta.MetaM.run' <| Meta.forallTelescope type fun binders _ =>
    binders.mapM Meta.isProof
  (classifyHostImportSignatureLoop type proofs #[] 0).run

end Vir.Interface
