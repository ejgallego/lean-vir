/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.NativeExterns

open Lean
open Lean.IR
open Vir.GeneratePackage

def checkNativeExternSpec (env : Environment) (spec : NativeExternSpec) : Option String :=
  match spec.resolve env with
  | .error error => some error
  | .ok _ =>
      match spec.symbolOverride?, getExternNameFor env `c spec.name with
      | some override, some symbol =>
          if override == symbol then
            some s!"{spec.name}: redundant VIR symbol override `{override}` matches Lean"
          else
            none
      | _, _ => none

def checkNativeExternSpecs (env : Environment) : Array String :=
  nativeExternSpecs.filterMap (checkNativeExternSpec env)

def duplicateNativeExternNames : Array String := Id.run do
  let mut seen : NameSet := {}
  let mut duplicates : Array String := #[]
  for spec in nativeExternSpecs do
    if seen.contains spec.name then
      duplicates := duplicates.push s!"{spec.name}: duplicate native extern registration"
    else
      seen := seen.insert spec.name
  return duplicates

def dottedNameParserFailures : Array String :=
  let valid := match Vir.parseDottedName "Lean.Expr.eqv" with
    | .ok name => if name == `Lean.Expr.eqv then #[] else #["dotted-name parser changed a valid name"]
    | .error error => #[s!"dotted-name parser rejected a valid name: {error}"]
  let empty := match Vir.parseDottedName "" with
    | .error _ => #[]
    | .ok _ => #["dotted-name parser accepted an empty name"]
  let emptyComponent := match Vir.parseDottedName "Lean..Expr" with
    | .error _ => #[]
    | .ok _ => #["dotted-name parser accepted an empty component"]
  let escapedDot := match Vir.parseDottedName "«Lean.Expr».eqv" with
    | .ok name =>
        if name == .str (.str .anonymous "Lean.Expr") "eqv" then #[]
        else #["dotted-name parser changed an escaped dot component"]
    | .error error => #[s!"dotted-name parser rejected an escaped dot component: {error}"]
  let escapedSpace := match Vir.parseDottedName "Lean.«Expr value»" with
    | .ok name =>
        if name == .str (.str .anonymous "Lean") "Expr value" then #[]
        else #["dotted-name parser changed an escaped space component"]
    | .error error => #[s!"dotted-name parser rejected an escaped space component: {error}"]
  let numeric := match Vir.parseDottedName "Lean.1" with
    | .ok name =>
        if name == .num (.str .anonymous "Lean") 1 then #[]
        else #["dotted-name parser changed a numeric component"]
    | .error error => #[s!"dotted-name parser rejected a numeric component: {error}"]
  valid ++ empty ++ emptyComponent ++ escapedDot ++ escapedSpace ++ numeric

def runNativeExternCheck : CoreM Unit := do
  let failures := dottedNameParserFailures ++ duplicateNativeExternNames ++
    checkNativeExternSpecs (← getEnv)
  if failures.isEmpty then
    let overrides := nativeExternSpecs.filter (·.symbolOverride?.isSome) |>.size
    logInfo s!"native extern metadata ok: {nativeExternSpecs.size} unique entries; \
      {nativeExternSpecs.size - overrides} Lean-derived symbols; {overrides} VIR overrides"
  else
    for failure in failures do
      logError failure
    throwError "native extern metadata check failed"

#eval runNativeExternCheck
