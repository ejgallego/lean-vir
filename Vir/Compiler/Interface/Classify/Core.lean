/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Compiler.Interface.Classify.Error
public import Vir.Compiler.Interface.Model
import Vir.Compiler.Interface.Classify.Basic
import Vir.Compiler.Interface.Classify.Reduce

public section

open Lean

namespace Vir.Interface

open Lean.IR
open Vir.InterfaceValidation

/-- Fully applied aggregate types visited during classification, after stripping
outer metadata. Lean's structural equality includes binder names/annotations,
nested metadata and universe levels; no alpha or definitional reduction is used. -/
private abbrev RecursiveSeen := Array ExprStructEq

private inductive RecursiveStep where
  | reference (depth : Nat)
  | descend (nextSeen : RecursiveSeen)

private def recursiveVisit
    (seen : RecursiveSeen) (kind : InterfaceAggregateKind) (type : Lean.Expr)
    (isRec : Bool) (mutualFamily : List Name) :
    Except InterfaceClassifierError RecursiveStep :=
  let key : ExprStructEq := ⟨type.consumeMData⟩
  let name := key.val.getAppFn.constName
  -- Generic containers bind scopes too: Tree → Option Tree → Tree is an
  -- enclosing reference, not mutually recursive declarations. The environment's
  -- actual mutual family remains unsupported.
  if let some index := seen.findIdx? (· == key) then
    if seen.any (fun previous => previous.val.getAppFn.constName != name &&
        mutualFamily.contains previous.val.getAppFn.constName) then
      .error (.mutuallyRecursive kind name)
    else
      .ok (.reference (seen.size - index - 1))
  -- Descending a concrete parameter (List (List Nat) → List Nat) is finite.
  -- A recursive field that grows/changes its parameter remains nonuniform.
  else if isRec && seen.any (fun previous => previous.val.getAppFn.constName == name) &&
      !(seen.any fun previous => previous.val.getAppArgs.any fun parameter =>
        (Lean.Expr.find? (fun subterm => (⟨subterm⟩ : ExprStructEq) == key) parameter).isSome) then
    .error (.nonUniformRecursive kind name)
  else
    .ok (.descend (seen.push key))

private abbrev ClassifyM := ExceptT InterfaceClassifierError CoreM

private def withContext (context : InterfaceClassifierContext) (action : ClassifyM α) : ClassifyM α :=
  ExceptT.adapt (.inContext context) action

-- Compiler exceptions and unsupported interfaces have distinct error channels.
private def constructorLayout (name : Name) (error : InterfaceClassifierError) :
    ClassifyM Lean.Compiler.LCNF.CtorLayout :=
  tryCatchThe Lean.Exception (liftM (Lean.Compiler.LCNF.getCtorLayout name))
    (fun _ => throwThe InterfaceClassifierError error)

private def constructorStorage (layout : Lean.Compiler.LCNF.CtorLayout) : ConstructorStorage := {
  objectFieldCount := layout.ctorInfo.size
  usizeFieldCount := layout.ctorInfo.usize
  scalarByteSize := layout.ctorInfo.ssize }

/-- A closure invocation cannot carry an enclosing aggregate's recursive owner.
Complete structures/inductives establish their own owner when marshalled. -/
private partial def enclosingRecursiveOwner? (bound : Nat := 0) : InterfaceType → Option Name
  | .recursiveRef name _ depth => if depth < bound then none else some name
  | .array element => enclosingRecursiveOwner? bound element
  | .customInductive _ _ constructors =>
      constructors.findSome? fun constructor =>
        constructor.fields.findSome? fun field => enclosingRecursiveOwner? (bound + 1) field.type
  | .structure _ _ descriptor =>
      descriptor.fields.findSome? fun field => enclosingRecursiveOwner? (bound + 1) field.type
  | .function args result _ =>
      args.findSome? (fun arg => enclosingRecursiveOwner? bound arg.type) <|> enclosingRecursiveOwner? bound result
  | _ => none

private def constructorFieldTypes? (type : Lean.Expr) : Option (Array (String × Lean.Expr)) :=
  let rec go (type : Lean.Expr) (fields : Array (String × Lean.Expr)) : Option (Array (String × Lean.Expr)) :=
    match type with
    | .mdata _ body => go body fields
    | .forallE name domain body binderInfo =>
        if binderInfo != .default then
          none
        else
          go body (fields.push (binderArgName (fields.size + 1) name, domain))
    | _ => some fields
  go type #[]

mutual

private partial def functionType (type : Lean.Expr) (seenTypes : RecursiveSeen)
    (args : Array InterfaceArg := #[]) :
    ClassifyM InterfaceType := do
  let type := type.consumeMData
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain then
        throwThe InterfaceClassifierError (.polymorphicCallbackParameter name)
      else if binderInfo != .default then
        throwThe InterfaceClassifierError (.implicitCallbackArgument name)
      else
        let argType ← withContext (.callbackArgument domain) do
          let argType ← classifyType domain seenTypes
          if let some owner := enclosingRecursiveOwner? 0 argType then
            throwThe InterfaceClassifierError (.recursiveCallback owner)
          return argType
        functionType body seenTypes (args.push {
          name := binderArgName (args.size + 1) name, type := argType })
  | result =>
      let effectResult ← effectResult? result
      let (effect, result) := effectResult.getD (.pure, result)
      let resultType ← withContext (.callbackResult result) do
        let resultType ← classifyType result seenTypes
        if let some owner := enclosingRecursiveOwner? 0 resultType then
          throwThe InterfaceClassifierError (.recursiveCallback owner)
        return resultType
      return (.function args resultType effect)

private partial def inductiveType (seenTypes : RecursiveSeen) (e : Lean.Expr) :
    ClassifyM InterfaceType := do
  let e := e.consumeMData
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    throwThe InterfaceClassifierError (.unsupportedType e)
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | throwThe InterfaceClassifierError (.unsupportedType e)
  match ← liftM (recursiveVisit seenTypes .inductive e indInfo.isRec indInfo.all) with
  | .reference depth =>
      return (.recursiveRef name (exprTypeLabel e) depth)
  | .descend nextSeen =>
    if indInfo.numIndices != 0 then
      throwThe InterfaceClassifierError (.indexedInductive name)
    else if args.size != indInfo.numParams then
      throwThe InterfaceClassifierError (.parameterCountMismatch .inductive name indInfo.numParams args.size)
    else if indInfo.ctors.isEmpty then
      throwThe InterfaceClassifierError (.inductiveWithoutConstructors name)
    else
      let mut constructors : Array InductiveConstructor := #[]
      for ctorName in indInfo.ctors do
        let some (.ctorInfo ctorInfo) := env.find? ctorName
          | throwThe InterfaceClassifierError (.constructorMissingDeclaration ctorName)
        if ctorInfo.induct != name then
          throwThe InterfaceClassifierError (.constructorOwnerMismatch ctorName name ctorInfo.induct)
        -- Recursive fields must use the applied aggregate's universe instance.
        let ctorType := ctorInfo.toConstantVal.instantiateTypeLevelParams e.getAppFn.constLevels!
        let some instantiated := instantiateForallPrefix? ctorType args
          | throwThe InterfaceClassifierError (.constructorInvalidType ctorName ctorInfo.type)
        let some fieldExprs := constructorFieldTypes? instantiated
          | throwThe InterfaceClassifierError (.constructorImplicitFields ctorName)
        let layout ← constructorLayout ctorName (.constructorLayoutUnavailable ctorName)
        if layout.fieldInfo.size != fieldExprs.size then
          throwThe InterfaceClassifierError (
            .constructorLayoutFieldCountMismatch ctorName fieldExprs.size layout.fieldInfo.size)
        let mut fields : Array InductiveField := #[]
        for h : idx in *...fieldExprs.size do
          let (fieldName, fieldExpr) := fieldExprs[idx]
          let some fieldLayout := fieldLayout? layout.fieldInfo[idx]!
            | throwThe InterfaceClassifierError (.constructorFieldErasedRuntimeLayout fieldName ctorName)
          let fieldType ← withContext (.constructorField fieldName ctorName fieldExpr)
            (classifyType fieldExpr nextSeen)
          fields := fields.push { name := fieldName, type := fieldType, layout := fieldLayout }
        constructors := constructors.push {
          constructorName := ctorName
          storage := constructorStorage layout
          fields }
      return (.customInductive name (exprTypeLabel e) constructors)

private partial def structureType (seenTypes : RecursiveSeen) (e : Lean.Expr) :
    ClassifyM InterfaceType := do
  let e := e.consumeMData
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    throwThe InterfaceClassifierError (.unsupportedType e)
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | throwThe InterfaceClassifierError (.unsupportedType e)
  let some structInfo := getStructureInfo? env name
    | throwThe InterfaceClassifierError (.unsupportedType e)
  match ← liftM (recursiveVisit seenTypes .structure e indInfo.isRec indInfo.all) with
  | .reference depth =>
      return (.recursiveRef name (exprTypeLabel e) depth)
  | .descend nextSeen =>
    if indInfo.numIndices != 0 then
      throwThe InterfaceClassifierError (.indexedStructure name)
    else if args.size != indInfo.numParams then
      throwThe InterfaceClassifierError (.parameterCountMismatch .structure name indInfo.numParams args.size)
    else if indInfo.ctors.length != 1 then
      throwThe InterfaceClassifierError (.structureConstructorCount name indInfo.ctors.length)
    else if structInfo.fieldNames.isEmpty then
      throwThe InterfaceClassifierError (.emptyStructure name)
    else if indInfo.isRec && structInfo.fieldNames.any (fun fieldName => (isSubobjectField? env name fieldName).isSome) then
      throwThe InterfaceClassifierError (.recursiveInheritedStructure name)
    else
      let ctorName := indInfo.ctors.head!
      let layout ← constructorLayout ctorName (.structureLayoutUnavailable name)
      let trivialField? :=
        (← Lean.Compiler.LCNF.hasTrivialImpureStructure? name).map (·.fieldIdx)
      if layout.fieldInfo.size != structInfo.fieldNames.size then
        throwThe InterfaceClassifierError (
          .structureLayoutFieldCountMismatch name structInfo.fieldNames.size layout.fieldInfo.size)
      let mut fields : Array StructureField := #[]
      for h : idx in *...structInfo.fieldNames.size do
        let fieldName := structInfo.fieldNames[idx]
        let isSubobject := (isSubobjectField? env name fieldName).isSome
        let some fieldLayout := fieldLayout? layout.fieldInfo[idx]!
          | throwThe InterfaceClassifierError (.structureFieldErasedRuntimeLayout fieldName name)
        let some projName := structInfo.getProjFn? idx
          | throwThe InterfaceClassifierError (.structureFieldMissingProjection fieldName name)
        let some info := env.find? projName
          | throwThe InterfaceClassifierError (.structureFieldMissingProjectionDeclaration fieldName name)
        let projType := info.instantiateTypeLevelParams e.getAppFn.constLevels!
        let some fieldExpr := projectionFieldType? indInfo.numParams args projType
          | throwThe InterfaceClassifierError (.structureFieldInvalidProjectionType fieldName name info.type)
        let fieldType ← withContext (.structureField fieldName name fieldExpr) (classifyType fieldExpr nextSeen)
        fields := fields.push {
          name := fieldName.toString, type := fieldType, layout := fieldLayout, isSubobject }
      return (.structure name (exprTypeLabel e) {
        constructorName := ctorName
        trivialField?
        storage := constructorStorage layout
        fields })

private partial def classifyType (e : Lean.Expr) (seenTypes : RecursiveSeen) :
    ClassifyM InterfaceType := do
  let e := e.consumeMData
  if let some e := optParamType? e then
    classifyType e seenTypes
  else match e with
  | .forallE .. =>
      functionType e seenTypes
  | .bvar _ =>
      return .leanObject
  | _ =>
      let env ← getEnv
      match simpleInterfaceType? e <|> resourceInterfaceType? e with
      | some ty => return ty
      | none =>
          tryCatchThe InterfaceClassifierError (do
            if (← effectResult? e).isSome then
              functionType e seenTypes
            else
              let (fn, args) := e.getAppFnArgs
              match fn, Array.toList args with
              | `Array, [arg] =>
                  return .array (← withContext .arrayElement (classifyType arg seenTypes))
              | _, _ =>
                  match simpleEnumType? env e with
                  | some ty => return ty
                  | none =>
                      if let some (markerName, _) := jsResourceMarker? e then
                        throwThe InterfaceClassifierError (.jsMarkerOutsideResource markerName)
                      else if (getStructureInfo? env fn).isSome then
                        structureType seenTypes e
                      else
                        inductiveType seenTypes e
          ) fun error => do
            let reduced ← reduceTypeAliases e
            if reduced == e then
              throwThe InterfaceClassifierError error
            else
              classifyType reduced seenTypes

end

/-- Classify a complete Lean type with a fresh, branch-local recursion context. -/
def interfaceType (type : Lean.Expr) : CoreM (Except InterfaceClassifierError InterfaceType) :=
  (classifyType type #[]).run

end Vir.Interface
