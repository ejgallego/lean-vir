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

private def interfaceResult? (result : Lean.Expr) :
    CoreM (Except String (InterfaceType × InterfaceEffect)) := do
  let effectResult ← effectResult? result
  let (effect, result) := effectResult.getD (.pure, result)
  match ← interfaceType result with
  | .error reason => return .error s!"unsupported result type `{result}`: {reason}"
  | .ok resultType => return .ok (resultType, effect)

/--
Classify a marker-preflighted export signature without rescanning its binders.
Runtime layout and supported JavaScript types remain package-time concerns.
-/
def interfaceExportSignature? (signature : ExportSignature) :
    CoreM (Except String (Array InterfaceArg × InterfaceType × InterfaceEffect)) := do
  let mut args : Array InterfaceArg := #[]
  for binder in signature.args do
    match ← interfaceType binder.type with
    | .error reason =>
        return .error s!"unsupported argument type `{binder.type}`: {reason}"
    | .ok argType =>
        args := args.push {
          name := binderArgName (args.size + 1) binder.name
          type := argType
        }
  match ← interfaceResult? signature.result with
  | .error reason => return .error reason
  | .ok (result, effect) => return .ok (args, result, effect)

partial def interfaceSignature?
    (type : Lean.Expr)
    (argIndex : Nat := 1)
    (args : Array InterfaceArg := #[])
    (erasedArgCount : Nat := 0) :
    CoreM (Except String (Array InterfaceArg × InterfaceType × InterfaceEffect × Nat)) := do
  let type := stripMData type
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain then
        if args.isEmpty then
          interfaceSignature? body argIndex args (erasedArgCount + 1)
        else
          return .error s!"unsupported runtime-erased type parameter `{name}` after runtime arguments"
      else if binderInfo != .default then
        return .error s!"VIR exports cannot have implicit or instance arguments (`{name}`); \
          export a wrapper with only explicit arguments"
      else
        match ← interfaceType domain with
        | .error reason => return .error s!"unsupported argument type `{domain}`: {reason}"
        | .ok argType =>
            let arg := { name := binderArgName argIndex name, type := argType }
            interfaceSignature? body (argIndex + 1) (args.push arg) erasedArgCount
  | result =>
      match ← interfaceResult? result with
      | .error reason => return .error reason
      | .ok (result, effect) => return .ok (args, result, effect, erasedArgCount)

end Vir.GeneratePackage
