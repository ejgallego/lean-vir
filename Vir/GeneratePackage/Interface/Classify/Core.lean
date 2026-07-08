/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Interface.Classify.Basic

open Lean

namespace Vir.GeneratePackage

open Lean.IR

mutual

partial def functionType (type : Lean.Expr) (argIndex : Nat := 1) (args : Array (String × InterfaceType) := #[]) :
    CoreM (Except String InterfaceType) := do
  let type := stripMData type
  match type with
  | .forallE name domain body binderInfo =>
      if isRuntimeErasedTypeBinder domain then
        return .error s!"unsupported polymorphic callback type parameter `{name}`"
      else if binderInfo != .default then
        return .error s!"unsupported implicit/instance callback argument `{name}`"
      else
        match ← interfaceType domain with
        | .error reason => return .error s!"unsupported callback argument type `{domain}`: {reason}"
        | .ok argType =>
            functionType body (argIndex + 1) (args.push (binderArgName argIndex name, argType))
  | result =>
      let effectResult ← effectResult? result
      let (effect, result) := effectResult.getD (.pure, result)
      match ← interfaceType result with
      | .error reason => return .error s!"unsupported callback result type `{result}`: {reason}"
      | .ok resultType => return .ok (.function args resultType effect)

partial def taggedUnionType (seenTypes : RecursiveSeen) (name : Name) (label : String)
    (constructors : Array (Name × String × Lean.Expr)) : CoreM (Except String InterfaceType) := do
  let mut variants := #[]
  for (ctorName, jsName, fieldExpr) in constructors do
    let layout ←
      try
        Lean.Compiler.LCNF.getCtorLayout ctorName
      catch _ =>
        return .error s!"could not compute runtime layout for constructor `{ctorName}`"
    if layout.fieldInfo.size != 1 then
      return .error s!"constructor `{ctorName}` must have exactly one runtime field"
    let some fieldLayout := structureFieldLayout? layout.fieldInfo[0]!
      | return .error s!"constructor `{ctorName}` has erased or void runtime layout"
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
    | .error reason =>
        return .error s!"constructor `{ctorName}` has unsupported payload type `{fieldExpr}`: {reason}"
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

partial def inductiveType (seenTypes : RecursiveSeen) (e : Lean.Expr) : CoreM (Except String InterfaceType) := do
  let e := stripMData e
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error s!"unsupported type `{e}`"
  let seenKey := toString e
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | return .error s!"unsupported type `{e}`"
  match recursiveVisit seenTypes "inductive" name seenKey indInfo.isRec with
  | .selfReference =>
      return .ok (.recursiveSelf name (exprTypeLabel e))
  | .error reason =>
      return .error reason
  | .descend nextSeen =>
    if indInfo.numIndices != 0 then
      return .error s!"indexed inductive `{name}` is not supported"
    else if args.size != indInfo.numParams then
      return .error s!"inductive `{name}` expects {indInfo.numParams} parameter(s), got {args.size}"
    else if indInfo.ctors.isEmpty then
      return .error s!"inductive `{name}` has no constructors"
    else
      let mut constructors := #[]
      for ctorName in indInfo.ctors do
        let some (.ctorInfo ctorInfo) := env.find? ctorName
          | return .error s!"constructor `{ctorName}` has no declaration"
        if ctorInfo.induct != name then
          return .error s!"constructor `{ctorName}` does not belong to `{name}`"
        let some instantiated := instantiateForallPrefix? ctorInfo.type args
          | return .error s!"constructor `{ctorName}` has invalid type `{ctorInfo.type}`"
        let some fieldExprs := constructorFieldTypes? instantiated
          | return .error s!"constructor `{ctorName}` has unsupported implicit/instance fields"
        let layout ←
          try
            Lean.Compiler.LCNF.getCtorLayout ctorName
          catch _ =>
            return .error s!"could not compute runtime layout for constructor `{ctorName}`"
        if layout.fieldInfo.size != fieldExprs.size then
          return .error s!"runtime layout for constructor `{ctorName}` does not match its field count"
        let mut fields := #[]
        for h : idx in *...fieldExprs.size do
          let (fieldName, fieldExpr) := fieldExprs[idx]
          let some fieldLayout := structureFieldLayout? layout.fieldInfo[idx]!
            | return .error s!"field `{fieldName}` of constructor `{ctorName}` has erased or void runtime layout"
          match ← interfaceType fieldExpr nextSeen with
          | .ok fieldType =>
              fields := fields.push (fieldName, fieldType, fieldLayout)
          | .error reason =>
              return .error s!"field `{fieldName}` of constructor `{ctorName}` has unsupported type `{fieldExpr}`: {reason}"
        constructors := constructors.push (
          ctorName,
          ctorShortName name ctorName,
          layout.ctorInfo.size,
          layout.ctorInfo.usize,
          layout.ctorInfo.ssize,
          fields)
      return .ok (.customInductive name (exprTypeLabel e) constructors)

partial def structureType (seenTypes : RecursiveSeen) (e : Lean.Expr) : CoreM (Except String InterfaceType) := do
  let e := stripMData e
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error s!"unsupported type `{e}`"
  let seenKey := toString e
  let env ← getEnv
  let some (.inductInfo indInfo) := env.find? name
    | return .error s!"unsupported type `{e}`"
  let some structInfo := getStructureInfo? env name
    | return .error s!"unsupported type `{e}`"
  match recursiveVisit seenTypes "structure" name seenKey indInfo.isRec with
  | .selfReference =>
      return .ok (.recursiveSelf name (exprTypeLabel e))
  | .error reason =>
      return .error reason
  | .descend nextSeen =>
    if indInfo.numIndices != 0 then
      return .error s!"indexed structure `{name}` is not supported"
    else if args.size != indInfo.numParams then
      return .error s!"structure `{name}` expects {indInfo.numParams} parameter(s), got {args.size}"
    else if indInfo.ctors.length != 1 then
      return .error s!"structure `{name}` must have exactly one constructor"
    else if structInfo.fieldNames.isEmpty then
      return .error s!"empty structure `{name}` is not supported"
    else if indInfo.isRec && structInfo.fieldNames.any (fun fieldName => (isSubobjectField? env name fieldName).isSome) then
      return .error s!"recursive inherited structure `{name}` is not supported"
    else
      let ctorName := indInfo.ctors.head!
      let layout ←
        try
          Lean.Compiler.LCNF.getCtorLayout ctorName
        catch _ =>
          return .error s!"could not compute runtime layout for structure `{name}`"
      let trivialField? :=
        (← Lean.Compiler.LCNF.hasTrivialImpureStructure? name).map (·.fieldIdx)
      if layout.fieldInfo.size != structInfo.fieldNames.size then
        return .error s!"runtime layout for structure `{name}` does not match its field count"
      let mut fields := #[]
      for h : idx in *...structInfo.fieldNames.size do
        let fieldName := structInfo.fieldNames[idx]
        let isSubobject := (isSubobjectField? env name fieldName).isSome
        let some fieldLayout := structureFieldLayout? layout.fieldInfo[idx]!
          | return .error s!"field `{fieldName}` of structure `{name}` has erased or void runtime layout"
        let some projName := structInfo.getProjFn? idx
          | return .error s!"field `{fieldName}` of structure `{name}` is missing a projection function"
        let some info := env.find? projName
          | return .error s!"field `{fieldName}` of structure `{name}` has no projection declaration"
        let some fieldExpr := projectionFieldType? indInfo.numParams args info.type
          | return .error s!"field `{fieldName}` of structure `{name}` has invalid projection type `{info.type}`"
        match ← interfaceType fieldExpr nextSeen with
        | .ok fieldType =>
            fields := fields.push (fieldName.toString, fieldType, fieldLayout, isSubobject)
        | .error reason =>
            return .error s!"field `{fieldName}` of structure `{name}` has unsupported type `{fieldExpr}`: {reason}"
      return .ok (.structure name (exprTypeLabel e) trivialField? layout.ctorInfo.size layout.ctorInfo.usize layout.ctorInfo.ssize fields)

partial def interfaceType (e : Lean.Expr) (seenTypes : RecursiveSeen := #[]) : CoreM (Except String InterfaceType) := do
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
                  | .error reason => return .error s!"unsupported Array element type: {reason}"
              | `List, [arg] =>
                  match ← interfaceType arg seenTypes with
                  | .ok ty => return .ok (.list ty)
                  | .error reason => return .error s!"unsupported List element type: {reason}"
              | `Option, [arg] =>
                  match ← interfaceType arg seenTypes with
                  | .ok ty => return .ok (.option ty)
                  | .error reason => return .error s!"unsupported Option element type: {reason}"
              | `Prod, [lhs, rhs] =>
                  match ← interfaceType lhs seenTypes with
                  | .error reason => return .error s!"unsupported Prod fst type: {reason}"
                  | .ok lhsTy =>
                      match ← interfaceType rhs seenTypes with
                      | .error reason => return .error s!"unsupported Prod snd type: {reason}"
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
                        return .error s!"JavaScript object marker `{markerName}` must appear under `Lean.Vir.Js`; use `Lean.Vir.Js {markerName}` at the boundary"
                      else if (getStructureInfo? env fn).isSome then
                        structureType seenTypes e
                      else
                        inductiveType seenTypes e
          match rawResult with
          | .ok ty => return .ok ty
          | .error reason =>
              let reduced ← reduceTypeAliases e
              if reduced == e then
                return .error reason
              else
                interfaceType reduced seenTypes

end

end Vir.GeneratePackage
