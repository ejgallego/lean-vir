/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Interface.Classify.Basic

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR
open Vir.InterfaceValidation

mutual

partial def functionType (type : Lean.Expr) (argIndex : Nat := 1) (args : Array (String × InterfaceType) := #[]) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let type := stripMData type
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain then
        return .error (.polymorphicCallbackParameter name)
      else if binderInfo != .default then
        return .error (.implicitCallbackArgument name)
      else
        match ← interfaceType domain with
        | .error error => return .error (.inContext (.callbackArgument domain) error)
        | .ok argType =>
            functionType body (argIndex + 1) (args.push (binderArgName argIndex name, argType))
  | result =>
      let effectResult ← effectResult? result
      let (effect, result) := effectResult.getD (.pure, result)
      match ← interfaceType result with
      | .error error => return .error (.inContext (.callbackResult result) error)
      | .ok resultType => return .ok (.function args resultType effect)

partial def taggedUnionType (seenTypes : RecursiveSeen) (name : Name) (label : String)
    (constructors : Array (Name × String × Lean.Expr)) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let mut variants := #[]
  for (ctorName, jsName, fieldExpr) in constructors do
    let layout ←
      try
        Lean.Compiler.LCNF.getCtorLayout ctorName
      catch _ =>
        return .error (.constructorLayoutUnavailable ctorName)
    if layout.fieldInfo.size != 1 then
      return .error (.constructorRuntimeFieldCount ctorName layout.fieldInfo.size)
    let some fieldLayout := structureFieldLayout? layout.fieldInfo[0]!
      | return .error (.constructorErasedRuntimeLayout ctorName)
    match ← interfaceType fieldExpr seenTypes with
    | .ok fieldType =>
        variants := variants.push (
          ctorName,
          jsName,
          fieldType,
          fieldLayout,
          layout.ctorInfo.size,
          layout.ctorInfo.usize,
          layout.ctorInfo.ssize)
    | .error error =>
        return .error (.inContext (.constructorPayload ctorName fieldExpr) error)
  return .ok (.taggedUnion name label variants)

partial def constructorFieldTypes? (type : Lean.Expr) (startIndex : Nat := 1) : Option (Array (String × Lean.Expr)) :=
  let rec go (idx : Nat) (type : Lean.Expr) (fields : Array (String × Lean.Expr)) : Option (Array (String × Lean.Expr)) :=
    match stripMData type with
    | .forallE name domain body binderInfo =>
        if binderInfo != .default then
          none
        else
          go (idx + 1) body (fields.push (binderArgName idx name, domain))
    | _ => some fields
  go startIndex type #[]

partial def inductiveType (seenTypes : RecursiveSeen) (e : Lean.Expr) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let e := stripMData e
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error (.unsupportedType e)
  let seenKey := toString e
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | return .error (.unsupportedType e)
  match recursiveVisit seenTypes .inductive name seenKey indInfo.isRec with
  | .selfReference =>
      return .ok (.recursiveSelf name (exprTypeLabel e))
  | .error error =>
      return .error error
  | .descend nextSeen =>
    if indInfo.numIndices != 0 then
      return .error (.indexedInductive name)
    else if args.size != indInfo.numParams then
      return .error (.parameterCountMismatch .inductive name indInfo.numParams args.size)
    else if indInfo.ctors.isEmpty then
      return .error (.inductiveWithoutConstructors name)
    else
      let mut constructors := #[]
      for ctorName in indInfo.ctors do
        let some (.ctorInfo ctorInfo) := env.find? ctorName
          | return .error (.constructorMissingDeclaration ctorName)
        if ctorInfo.induct != name then
          return .error (.constructorOwnerMismatch ctorName name ctorInfo.induct)
        let some instantiated := instantiateForallPrefix? ctorInfo.type args
          | return .error (.constructorInvalidType ctorName ctorInfo.type)
        let some fieldExprs := constructorFieldTypes? instantiated
          | return .error (.constructorImplicitFields ctorName)
        let layout ←
          try
            Lean.Compiler.LCNF.getCtorLayout ctorName
          catch _ =>
            return .error (.constructorLayoutUnavailable ctorName)
        if layout.fieldInfo.size != fieldExprs.size then
          return .error (
            .constructorLayoutFieldCountMismatch ctorName fieldExprs.size layout.fieldInfo.size)
        let mut fields := #[]
        for h : idx in *...fieldExprs.size do
          let (fieldName, fieldExpr) := fieldExprs[idx]
          let some fieldLayout := structureFieldLayout? layout.fieldInfo[idx]!
            | return .error (.constructorFieldErasedRuntimeLayout fieldName ctorName)
          match ← interfaceType fieldExpr nextSeen with
          | .ok fieldType =>
              fields := fields.push (fieldName, fieldType, fieldLayout)
          | .error error =>
              return .error (.inContext (.constructorField fieldName ctorName fieldExpr) error)
        constructors := constructors.push (
          ctorName,
          ctorShortName name ctorName,
          layout.ctorInfo.size,
          layout.ctorInfo.usize,
          layout.ctorInfo.ssize,
          fields)
      return .ok (.customInductive name (exprTypeLabel e) constructors)

partial def structureType (seenTypes : RecursiveSeen) (e : Lean.Expr) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let e := stripMData e
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error (.unsupportedType e)
  let seenKey := toString e
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | return .error (.unsupportedType e)
  let some structInfo := getStructureInfo? env name
    | return .error (.unsupportedType e)
  match recursiveVisit seenTypes .structure name seenKey indInfo.isRec with
  | .selfReference =>
      return .ok (.recursiveSelf name (exprTypeLabel e))
  | .error error =>
      return .error error
  | .descend nextSeen =>
    if indInfo.numIndices != 0 then
      return .error (.indexedStructure name)
    else if args.size != indInfo.numParams then
      return .error (.parameterCountMismatch .structure name indInfo.numParams args.size)
    else if indInfo.ctors.length != 1 then
      return .error (.structureConstructorCount name indInfo.ctors.length)
    else if structInfo.fieldNames.isEmpty then
      return .error (.emptyStructure name)
    else if indInfo.isRec && structInfo.fieldNames.any (fun fieldName => (isSubobjectField? env name fieldName).isSome) then
      return .error (.recursiveInheritedStructure name)
    else
      let ctorName := indInfo.ctors.head!
      let layout ←
        try
          Lean.Compiler.LCNF.getCtorLayout ctorName
        catch _ =>
          return .error (.structureLayoutUnavailable name)
      let trivialField? :=
        (← Lean.Compiler.LCNF.hasTrivialImpureStructure? name).map (·.fieldIdx)
      if layout.fieldInfo.size != structInfo.fieldNames.size then
        return .error (
          .structureLayoutFieldCountMismatch name structInfo.fieldNames.size layout.fieldInfo.size)
      let mut fields := #[]
      for h : idx in *...structInfo.fieldNames.size do
        let fieldName := structInfo.fieldNames[idx]
        let isSubobject := (isSubobjectField? env name fieldName).isSome
        let some fieldLayout := structureFieldLayout? layout.fieldInfo[idx]!
          | return .error (.structureFieldErasedRuntimeLayout fieldName name)
        let some projName := structInfo.getProjFn? idx
          | return .error (.structureFieldMissingProjection fieldName name)
        let some info := env.find? projName
          | return .error (.structureFieldMissingProjectionDeclaration fieldName name)
        let some fieldExpr := projectionFieldType? indInfo.numParams args info.type
          | return .error (.structureFieldInvalidProjectionType fieldName name info.type)
        match ← interfaceType fieldExpr nextSeen with
        | .ok fieldType =>
            fields := fields.push (fieldName.toString, fieldType, fieldLayout, isSubobject)
        | .error error =>
            return .error (.inContext (.structureField fieldName name fieldExpr) error)
      return .ok (.structure name (exprTypeLabel e) trivialField? layout.ctorInfo.size layout.ctorInfo.usize layout.ctorInfo.ssize fields)

partial def interfaceType (e : Lean.Expr) (seenTypes : RecursiveSeen := #[]) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let e := stripMData e
  if let some e := optParamType? e then
    interfaceType e seenTypes
  else match e with
  | .forallE .. =>
      functionType e
  | .bvar _ =>
      return .ok .leanObject
  | _ =>
      let env ← getEnv
      match simpleInterfaceType? e <|> resourceInterfaceType? e with
      | some ty => return .ok ty
      | none =>
          let rawResult ←
            if (← effectResult? e).isSome then
              functionType e
            else
              let (fn, args) := e.getAppFnArgs
              match fn, Array.toList args with
              | `Array, [arg] =>
                  match ← interfaceType arg seenTypes with
                  | .ok ty => return .ok (.array ty)
                  | .error error => return .error (.inContext .arrayElement error)
              | `List, [arg] =>
                  match ← interfaceType arg seenTypes with
                  | .ok ty => return .ok (.list ty)
                  | .error error => return .error (.inContext .listElement error)
              | `Option, [arg] =>
                  match ← interfaceType arg seenTypes with
                  | .ok ty => return .ok (.option ty)
                  | .error error => return .error (.inContext .optionElement error)
              | `Prod, [lhs, rhs] =>
                  match ← interfaceType lhs seenTypes with
                  | .error error => return .error (.inContext .prodFst error)
                  | .ok lhsTy =>
                      match ← interfaceType rhs seenTypes with
                      | .error error => return .error (.inContext .prodSnd error)
                      | .ok rhsTy => return .ok (.prod lhsTy rhsTy)
              | `Sum, [lhs, rhs] =>
                  taggedUnionType seenTypes `Sum (exprTypeLabel e) #[
                    (`Sum.inl, "inl", lhs),
                    (`Sum.inr, "inr", rhs)
                  ]
              | `Except, [err, ok] =>
                  taggedUnionType seenTypes `Except (exprTypeLabel e) #[
                    (`Except.error, "error", err),
                    (`Except.ok, "ok", ok)
                  ]
              | _, _ =>
                  match simpleEnumType? env e with
                  | some ty => return .ok ty
                  | none =>
                      if let some (markerName, _) := jsResourceMarker? e then
                        return .error (.jsMarkerOutsideResource markerName)
                      else if (getStructureInfo? env fn).isSome then
                        structureType seenTypes e
                      else
                        inductiveType seenTypes e
          match rawResult with
          | .ok ty => return .ok ty
          | .error error =>
              let reduced ← reduceTypeAliases e
              if reduced == e then
                return .error error
              else
                interfaceType reduced seenTypes

end

end Vir.GeneratePackage
