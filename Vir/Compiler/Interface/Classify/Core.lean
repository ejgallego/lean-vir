/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Compiler.Interface.Classify.Error
public import Vir.Compiler.Interface.Model
public import Vir.Compiler.Interface.LibraryAdapters
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

/-- Search a concrete parameter using only the head reductions already permitted
by classification. This does not normalize or change structural recursion keys. -/
private partial def containsReducedType (key : ExprStructEq) (parameter : Lean.Expr) : CoreM Bool := do
  if (parameter.find? (fun subterm => (⟨subterm⟩ : ExprStructEq) == key)).isSome then
    return true
  let parameter ← reduceTypeAliases parameter
  if (⟨parameter⟩ : ExprStructEq) == key then return true
  parameter.foldlM (fun found child =>
    if found then pure true else containsReducedType key child) false

private def recursiveVisit
    (seen : RecursiveSeen) (kind : InterfaceAggregateKind) (type : Lean.Expr)
    (isRec : Bool) (mutualFamily : List Name) :
    CoreM (Except InterfaceClassifierError RecursiveStep) := do
  let key : ExprStructEq := ⟨type.consumeMData⟩
  let name := key.val.getAppFn.constName
  -- Generic containers bind scopes too: Tree → Option Tree → Tree is an
  -- enclosing reference, not mutually recursive declarations. The environment's
  -- actual mutual family remains unsupported.
  if let some index := seen.findIdx? (· == key) then
    if seen.any (fun previous => previous.val.getAppFn.constName != name &&
        mutualFamily.contains previous.val.getAppFn.constName) then
      return .error (.mutuallyRecursive kind name)
    else
      return .ok (.reference (seen.size - index - 1))
  -- Descending a concrete parameter (List (List Nat) → List Nat) is finite.
  -- A recursive field that grows/changes its parameter remains nonuniform.
  else if isRec && seen.any (fun previous => previous.val.getAppFn.constName == name) then
    for previous in seen do
      for parameter in previous.val.getAppArgs do
        if ← containsReducedType key parameter then
          return .ok (.descend (seen.push key))
    return .error (.nonUniformRecursive kind name)
  else
    return .ok (.descend (seen.push key))

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

/-- Follow the compiler's registered implementation, rather than allocating from
the source constructor's layout. The pinned computed-field transform preserves
logical arguments and prepends computed storage. Retain its typed operation;
recognize only closed, scalar-cache cases until other shapes are supported. -/
private def implementationLayout (name : Name) : ClassifyM (Lean.Compiler.LCNF.CtorLayout × Option Name) := do
  let env ← getEnv
  let some implementation := Lean.Compiler.getImplementedBy? env name
    | return (← constructorLayout name (.constructorLayoutUnavailable name), none)
  let some (.ctorInfo source) := env.find? name | throwThe InterfaceClassifierError (.constructorOperationUnsupported name "missing constructor")
  if source.numParams != 0 then throwThe InterfaceClassifierError (.constructorOperationUnsupported name "parameterized constructor operation unsupported")
  let some (.defnInfo info) := env.find? implementation | throwThe InterfaceClassifierError (.constructorOperationUnsupported name "missing implementation")
  let mut body := info.value.consumeMData
  let mut binders := 0
  while let .lam _ _ next _ := body do
    body := next.consumeMData
    binders := binders + 1
  unless binders == source.numFields do throwThe InterfaceClassifierError (.constructorOperationUnsupported name "unexpected operation binders")
  let arguments := body.getAppArgs
  unless body.getAppFn.constName == ``unsafeCast && arguments.size == 3 do
    throwThe InterfaceClassifierError (.constructorOperationUnsupported name "unsupported operation body")
  let value := arguments[2]!
  let some (.ctorInfo actual) := env.find? value.getAppFn.constName
    | throwThe InterfaceClassifierError (.constructorOperationUnsupported name "operation is not a constructor application")
  unless actual.cidx == source.cidx && actual.numParams == 0 &&
      actual.numFields >= source.numFields && value.getAppArgs.size == actual.numFields do
    throwThe InterfaceClassifierError (.constructorOperationUnsupported name "operation changes constructor identity")
  let offset := actual.numFields - source.numFields
  for i in [:source.numFields] do
    unless value.getAppArgs[offset + i]? == some (.bvar (source.numFields - i - 1)) do
      throwThe InterfaceClassifierError (.constructorOperationUnsupported name "operation changes logical field")
  let layout ← constructorLayout actual.name (.constructorLayoutUnavailable name)
  for i in [:offset] do
    unless (fieldLayout? layout.fieldInfo[i]!).any (fun l => match l with | .scalar .. => true | _ => false) do
      throwThe InterfaceClassifierError (.constructorOperationUnsupported name "computed object/usize fields unsupported")
  if source.numFields == 0 && (layout.ctorInfo.size != 0 || layout.ctorInfo.usize != 0 || layout.ctorInfo.ssize != 0) then
    throwThe InterfaceClassifierError (.constructorOperationUnsupported name "computed storage on a fieldless constructor unsupported")
  return ({ layout with fieldInfo := layout.fieldInfo.extract offset layout.fieldInfo.size },
    if source.numFields == 0 then none else some implementation)

private def libraryAdapterOutcome : ClassifyM InterfaceType := do
  let constructors ← #[(`Except.error, InterfaceType.string), (`Except.ok, InterfaceType.leanObject)].mapM fun (name, type) => do
    let layout ← constructorLayout name (.constructorLayoutUnavailable name)
    let some location := fieldLayout? layout.fieldInfo[0]!
      | throwThe InterfaceClassifierError (.constructorLayoutUnavailable name)
    pure ({
      constructorName := name
      storage := constructorStorage layout
      fields := #[{ name := "a", type, layout := location }]
    } : InductiveConstructor)
  pure (.customInductive `Except "Except String opaque" constructors)

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

/-- Classification rejects implicit inductive fields; records explicitly opt in.
Proof erasure remains a separate checked policy in structure classification. -/
private def constructorFields (type : Lean.Expr) (ctorName : Name)
    (allowImplicitFields : Bool := false) : ClassifyM (Array (String × Lean.Expr)) := do
  let fields ← ExceptT.mk (pure (instantiateConstructorFields (← getEnv) type ctorName))
  unless allowImplicitFields || fields.all (·.binderInfo == .default) do
    throwThe InterfaceClassifierError (.constructorImplicitFields ctorName)
  return fields.mapIdx fun index field => (binderArgName (index + 1) field.name, field.type)

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
  match ← ExceptT.mk (recursiveVisit seenTypes .inductive e indInfo.isRec indInfo.all) with
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
        let fieldExprs ← constructorFields e ctorName
        let (layout, operation?) ← implementationLayout ctorName
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
          operation?
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
  match ← ExceptT.mk (recursiveVisit seenTypes .structure e indInfo.isRec indInfo.all) with
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
      -- Record fields may be implicit constructor binders; their object keys
      -- are still explicit and required by the record value interface.
      let fieldExprs ← constructorFields e ctorName (allowImplicitFields := true)
      let (layout, operation?) ← implementationLayout ctorName
      let trivialField? ←
        if operation?.isSome then pure none
        else do
          pure ((← Lean.Compiler.LCNF.hasTrivialImpureStructure? name).map (·.fieldIdx))
      if layout.fieldInfo.size != structInfo.fieldNames.size then
        throwThe InterfaceClassifierError (
          .structureLayoutFieldCountMismatch name structInfo.fieldNames.size layout.fieldInfo.size)
      if fieldExprs.size != structInfo.fieldNames.size then
        throwThe InterfaceClassifierError (.constructorInvalidType ctorName e)
      let check? ← if name == ``Char then
        pure (some FieldCheck.unicodeScalar)
      else if name == ``Fin then do
        let bound ← reduceTypeAliases args[0]!
        let .lit (.natVal bound) := bound
          | throwThe InterfaceClassifierError (.nonLiteralFinBound bound)
        pure (some (FieldCheck.natLt bound))
      else pure none
      -- Only the pinned Char/Fin declarations have a selected validating rule.
      -- Never skip proof fields merely because the compiler erased their storage.
      if check?.isSome && (structInfo.fieldNames.size != 2 || structInfo.fieldNames[0]! != `val ||
          structInfo.fieldNames[1]! != (if name == ``Char then `valid else `isLt)) then
        throwThe InterfaceClassifierError (.constructorInvalidType ctorName e)
      let mut fields : Array StructureField := #[]
      for h : idx in *...structInfo.fieldNames.size do
        let fieldName := structInfo.fieldNames[idx]
        let isSubobject := (isSubobjectField? env name fieldName).isSome
        let fieldLayout ← match fieldLayout? layout.fieldInfo[idx]! with
          | some layout => pure layout
          | none =>
              if check?.isSome && idx == 1 then continue
              else throwThe InterfaceClassifierError (.structureFieldErasedRuntimeLayout fieldName name)
        let fieldExpr := fieldExprs[idx]!.2
        let fieldType ← withContext (.structureField fieldName name fieldExpr) (classifyType fieldExpr nextSeen)
        fields := fields.push {
          name := fieldName.toString, type := fieldType, layout := fieldLayout, isSubobject
          check? := if idx == 0 then check? else none }
      return (.structure name (exprTypeLabel e) {
        constructorName := ctorName
        operation?
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
      let adapter? ← match closedLibraryAdapter? env e with
        | .ok adapter => pure adapter
        | .error reason => throwThe InterfaceClassifierError (.libraryAdapterUnsupported e reason)
      if let some adapter := adapter? then
        let key : ExprStructEq := ⟨e⟩
        if seenTypes.contains key then
          throwThe InterfaceClassifierError (.libraryAdapterUnsupported e "recursive adapter wire domains are not supported")
        -- Wire domains are closed: they cannot borrow an enclosing descriptor's
        -- recursive owner or use a package-local fragment as their type identity.
        let wire ← classifyType adapter.wireType #[key]
        return .libraryAdapter e.getAppFn.constName (exprTypeLabel e) {
          wire, decode := adapter.decode, encode := adapter.encode,
          outcome := ← libraryAdapterOutcome }
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
