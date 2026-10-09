/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean
public import Vir.Compiler.Interface.Model
import Vir.Compiler.Interface.Classify.Basic
import Vir.Compiler.InterfaceValidation

public section

open Lean

namespace Vir.Interface

/-- Whether a reduced type can be classified without a term-local context. -/
private def isClosedTypeExpr (e : Lean.Expr) : Bool :=
  !e.hasLooseBVars && !e.hasFVar && !e.hasMVar

/--
Small head-only reduction, not `whnf`: beta, abbreviations, and projections of
closed constructor values. Ordinary definitions may unfold only while exposing
a projection's receiver. No match/recursor, let, opaque or irreducible reduction.
The budget bounds definition chains and nested projections; exhaustion discards
the attempt rather than accepting a partially reduced type.
-/
private def reduceScopedHead (fuel : Nat) (recordReceiver : Bool) (e : Lean.Expr) :
    CoreM (Option (Lean.Expr × Nat)) := do
  let fuel + 1 := fuel | return none
  let e := e.consumeMData
  if preserveInterfaceHead e.getAppFn.constName then return some (e, fuel)
  let beta := e.headBeta
  if beta != e then return ← reduceScopedHead fuel recordReceiver beta
  let env ← getEnv
  match e.getAppFn with
  | .proj typeName index receiver =>
      if !isClosedTypeExpr receiver then return some (e, fuel)
      let some (receiver, remaining) ← reduceScopedHead fuel true receiver | return none
      let remaining := min fuel remaining
      let some (.ctorInfo ctor) := env.find? receiver.getAppFn.constName
        | return some (e, remaining)
      -- Select only a fully applied constructor of the named structure.
      if ctor.induct != typeName || (getStructureInfo? env typeName).isNone ||
          receiver.getAppNumArgs != ctor.numParams + ctor.numFields ||
          index >= ctor.numFields then return some (e, remaining)
      let field := receiver.getArg! (ctor.numParams + index)
      reduceScopedHead remaining recordReceiver (mkAppN field e.getAppArgs)
  | .const name levels =>
      match env.find? name with
      | some (.defnInfo info) =>
          if getReducibilityStatusCore env name == .irreducible ||
              !(info.hints.isAbbrev || recordReceiver) then return some (e, fuel)
          let value := (ConstantInfo.defnInfo info).instantiateValueLevelParams! levels
          reduceScopedHead fuel recordReceiver (value.beta e.getAppArgs)
      | _ => return some (e, fuel)
  | _ => return some (e, fuel)
termination_by fuel
decreasing_by all_goals omega

def reduceTypeAliases (e : Lean.Expr) : CoreM Lean.Expr := do
  let aliased ← Vir.InterfaceValidation.reduceTypeAliases preserveInterfaceHead e
  let some (reduced, _) ← reduceScopedHead 32 false aliased | return aliased
  -- In particular, beta may discard a constructor-field bvar in a constant
  -- family, but may not turn a dependent field into the generic bvar ABI lane.
  return if isClosedTypeExpr reduced then reduced else aliased

def effectResult? (e : Lean.Expr) : CoreM (Option (InterfaceEffect × Lean.Expr)) := do
  match effectResultRaw? e with
  | some result => return some result
  | none =>
      let e := e.consumeMData
      let reduced ← reduceTypeAliases e
      if reduced == e then
        return none
      else
        return effectResultRaw? reduced

end Vir.Interface
