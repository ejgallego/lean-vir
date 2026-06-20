/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Interface.Classify.Core

open Lean

namespace Vir.GeneratePackage

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
        return .error s!"unsupported implicit/instance argument `{name}`"
      else
        match ← interfaceType domain with
        | .error reason => return .error s!"unsupported argument type `{domain}`: {reason}"
        | .ok argType =>
            let arg := { name := binderArgName argIndex name, type := argType }
            interfaceSignature? body (argIndex + 1) (args.push arg) erasedArgCount
  | result =>
      let effectResult ← effectResult? result
      let (effect, result) := effectResult.getD (.pure, result)
      match ← interfaceType result with
      | .error reason => return .error s!"unsupported result type `{result}`: {reason}"
      | .ok resultType => return .ok (args, resultType, effect, erasedArgCount)

end Vir.GeneratePackage
