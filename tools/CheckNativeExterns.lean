/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.NativeExterns

open Lean
open Lean.IR
open Vir.GeneratePackage

def formatIRType : IRType → String
  | .float => "float"
  | .uint8 => "u8"
  | .uint16 => "u16"
  | .uint32 => "u32"
  | .uint64 => "u64"
  | .usize => "usize"
  | .erased => "erased"
  | .object => "object"
  | .tobject => "tobject"
  | .float32 => "float32"
  | .struct name _ => s!"struct {name}"
  | .union name _ => s!"union {name}"
  | .tagged => "tagged"
  | .void => "void"

def formatParam (param : Param) : String :=
  let borrow := if param.borrow then "@& " else ""
  s!"x_{param.x.idx} : {borrow}{formatIRType param.ty}"

def formatSignature (params : Array Param) (result : IRType) : String :=
  let args := ", ".intercalate (params.map formatParam).toList
  s!"({args}) -> {formatIRType result}"

def sameParam (expected actual : Param) : Bool :=
  expected.x.idx == actual.x.idx &&
    expected.borrow == actual.borrow &&
    expected.ty == actual.ty

def sameParams (expected actual : Array Param) : Bool :=
  expected.size == actual.size &&
    (expected.zip actual).all fun (expected, actual) => sameParam expected actual

def checkNativeExtern (env : Environment) (ext : NativeExtern) : Option String :=
  match Lean.IR.findEnvDecl env ext.name with
  | none =>
      some s!"{ext.name}: no Lean IR declaration found"
  | some decl =>
      let expected := formatSignature ext.params ext.resultType
      let actual := formatSignature decl.params decl.resultType
      if sameParams ext.params decl.params && ext.resultType == decl.resultType then
        none
      else
        some s!"{ext.name}: native extern ABI mismatch; table {expected}; Lean IR {actual}"

def checkNativeExterns (env : Environment) : Array String :=
  nativeExterns.filterMap (checkNativeExtern env)

def duplicateNativeExternNames : Array String := Id.run do
  let mut seen : NameSet := {}
  let mut duplicates : Array String := #[]
  for ext in nativeExterns do
    if seen.contains ext.name then
      duplicates := duplicates.push s!"{ext.name}: duplicate native extern registration"
    else
      seen := seen.insert ext.name
  return duplicates

def runNativeExternCheck : CoreM Unit := do
  let failures := duplicateNativeExternNames ++ checkNativeExterns (← getEnv)
  if failures.isEmpty then
    logInfo s!"native extern ABI ok: {nativeExterns.size} unique entries match Lean IR"
  else
    for failure in failures do
      logError failure
    throwError "native extern ABI check failed"

#eval runNativeExternCheck
