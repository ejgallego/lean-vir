/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Compiler.Interface.Classify.Basic

public section

open Lean

namespace Vir.Interface

open Lean.IR
open Vir.InterfaceValidation

private def constructorStorage (layout : Lean.Compiler.LCNF.CtorLayout) : ConstructorStorage := {
  objectFieldCount := layout.ctorInfo.size
  usizeFieldCount := layout.ctorInfo.usize
  scalarByteSize := layout.ctorInfo.ssize }

/-- A closure invocation cannot carry an enclosing aggregate's recursive owner.
Complete structures/inductives establish their own owner when marshalled. -/
private partial def enclosingRecursiveOwner? : InterfaceType → Option Name
  | .recursiveSelf name _ => some name
  | .array element | .list element | .option element => enclosingRecursiveOwner? element
  | .prod fst snd => enclosingRecursiveOwner? fst <|> enclosingRecursiveOwner? snd
  | .taggedUnion _ _ constructors =>
      constructors.findSome? fun constructor => enclosingRecursiveOwner? constructor.payloadType
  | .function args result _ =>
      args.findSome? (fun arg => enclosingRecursiveOwner? arg.type) <|> enclosingRecursiveOwner? result
  | _ => none

mutual

partial def functionType (type : Lean.Expr) (seenTypes : RecursiveSeen := #[])
    (args : Array InterfaceArg := #[]) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let type := type.consumeMData
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain then
        return .error (.polymorphicCallbackParameter name)
      else if binderInfo != .default then
        return .error (.implicitCallbackArgument name)
      else
        match ← interfaceType domain seenTypes with
        | .error error => return .error (.inContext (.callbackArgument domain) error)
        | .ok argType =>
            if let some owner := enclosingRecursiveOwner? argType then
              return .error (.inContext (.callbackArgument domain) (.recursiveCallback owner))
            functionType body seenTypes (args.push {
              name := binderArgName (args.size + 1) name, type := argType })
  | result =>
      let effectResult ← effectResult? result
      let (effect, result) := effectResult.getD (.pure, result)
      match ← interfaceType result seenTypes with
      | .error error => return .error (.inContext (.callbackResult result) error)
      | .ok resultType =>
          if let some owner := enclosingRecursiveOwner? resultType then
            return .error (.inContext (.callbackResult result) (.recursiveCallback owner))
          return .ok (.function args resultType effect)

partial def taggedUnionType (seenTypes : RecursiveSeen) (name : Name) (label : String)
    (constructors : Array (Name × Lean.Expr)) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let mut variants : Array TaggedUnionVariant := #[]
  for (ctorName, fieldExpr) in constructors do
    let layout ←
      try
        Lean.Compiler.LCNF.getCtorLayout ctorName
      catch _ =>
        return .error (.constructorLayoutUnavailable ctorName)
    if layout.fieldInfo.size != 1 then
      return .error (.constructorRuntimeFieldCount ctorName layout.fieldInfo.size)
    let some fieldLayout := fieldLayout? layout.fieldInfo[0]!
      | return .error (.constructorErasedRuntimeLayout ctorName)
    match ← interfaceType fieldExpr seenTypes with
    | .ok fieldType =>
        variants := variants.push {
          constructorName := ctorName
          payloadType := fieldType, payloadLayout := fieldLayout
          storage := constructorStorage layout }
    | .error error =>
        return .error (.inContext (.constructorPayload ctorName fieldExpr) error)
  return .ok (.taggedUnion name label variants)

partial def constructorFieldTypes? (type : Lean.Expr) : Option (Array (String × Lean.Expr)) :=
  let rec go (type : Lean.Expr) (fields : Array (String × Lean.Expr)) : Option (Array (String × Lean.Expr)) :=
    match type.consumeMData with
    | .forallE name domain body binderInfo =>
        if binderInfo != .default then
          none
        else
          go body (fields.push (binderArgName (fields.size + 1) name, domain))
    | _ => some fields
  go type #[]

partial def inductiveType (seenTypes : RecursiveSeen) (e : Lean.Expr) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let e := e.consumeMData
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error (.unsupportedType e)
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | return .error (.unsupportedType e)
  match recursiveVisit seenTypes .inductive e indInfo.isRec with
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
      let mut constructors : Array InductiveConstructor := #[]
      for ctorName in indInfo.ctors do
        let some (.ctorInfo ctorInfo) := env.find? ctorName
          | return .error (.constructorMissingDeclaration ctorName)
        if ctorInfo.induct != name then
          return .error (.constructorOwnerMismatch ctorName name ctorInfo.induct)
        -- Recursive fields must use the applied aggregate's universe instance.
        let ctorType := ctorInfo.toConstantVal.instantiateTypeLevelParams e.getAppFn.constLevels!
        let some instantiated := instantiateForallPrefix? ctorType args
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
        let mut fields : Array InductiveField := #[]
        for h : idx in *...fieldExprs.size do
          let (fieldName, fieldExpr) := fieldExprs[idx]
          let some fieldLayout := fieldLayout? layout.fieldInfo[idx]!
            | return .error (.constructorFieldErasedRuntimeLayout fieldName ctorName)
          match ← interfaceType fieldExpr nextSeen with
          | .ok fieldType =>
              fields := fields.push { name := fieldName, type := fieldType, layout := fieldLayout }
          | .error error =>
              return .error (.inContext (.constructorField fieldName ctorName fieldExpr) error)
        constructors := constructors.push {
          constructorName := ctorName
          storage := constructorStorage layout
          fields }
      return .ok (.customInductive name (exprTypeLabel e) constructors)

partial def structureType (seenTypes : RecursiveSeen) (e : Lean.Expr) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let e := e.consumeMData
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error (.unsupportedType e)
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | return .error (.unsupportedType e)
  let some structInfo := getStructureInfo? env name
    | return .error (.unsupportedType e)
  match recursiveVisit seenTypes .structure e indInfo.isRec with
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
      let mut fields : Array StructureField := #[]
      for h : idx in *...structInfo.fieldNames.size do
        let fieldName := structInfo.fieldNames[idx]
        let isSubobject := (isSubobjectField? env name fieldName).isSome
        let some fieldLayout := fieldLayout? layout.fieldInfo[idx]!
          | return .error (.structureFieldErasedRuntimeLayout fieldName name)
        let some projName := structInfo.getProjFn? idx
          | return .error (.structureFieldMissingProjection fieldName name)
        let some info := env.find? projName
          | return .error (.structureFieldMissingProjectionDeclaration fieldName name)
        let projType := info.instantiateTypeLevelParams e.getAppFn.constLevels!
        let some fieldExpr := projectionFieldType? indInfo.numParams args projType
          | return .error (.structureFieldInvalidProjectionType fieldName name info.type)
        match ← interfaceType fieldExpr nextSeen with
        | .ok fieldType =>
            fields := fields.push {
              name := fieldName.toString, type := fieldType, layout := fieldLayout, isSubobject }
        | .error error =>
            return .error (.inContext (.structureField fieldName name fieldExpr) error)
      return .ok (.structure name (exprTypeLabel e) {
        trivialField?
        storage := constructorStorage layout
        fields })

partial def interfaceType (e : Lean.Expr) (seenTypes : RecursiveSeen := #[]) :
    CoreM (Except InterfaceClassifierError InterfaceType) := do
  let e := e.consumeMData
  if let some e := optParamType? e then
    interfaceType e seenTypes
  else match e with
  | .forallE .. =>
      functionType e seenTypes
  | .bvar _ =>
      return .ok .leanObject
  | _ =>
      let env ← getEnv
      match simpleInterfaceType? e <|> resourceInterfaceType? e with
      | some ty => return .ok ty
      | none =>
          let rawResult ←
            if (← effectResult? e).isSome then
              functionType e seenTypes
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
                    (`Sum.inl, lhs),
                    (`Sum.inr, rhs)
                  ]
              | `Except, [err, ok] =>
                  taggedUnionType seenTypes `Except (exprTypeLabel e) #[
                    (`Except.error, err),
                    (`Except.ok, ok)
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

end Vir.Interface
