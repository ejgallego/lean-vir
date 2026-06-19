/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Closure

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def DeclIndex.envForSource? (index : DeclIndex) (source : String) : Option Environment :=
  index.envs.findSome? fun (candidate, env) =>
    if candidate == source then some env else none

def InterfaceType.label : InterfaceType → String
  | .unit => "Unit"
  | .nat => "Nat"
  | .int => "Int"
  | .bool => "Bool"
  | .string => "String"
  | .float => "Float"
  | .float32 => "Float32"
  | .uint8 => "UInt8"
  | .uint16 => "UInt16"
  | .uint32 => "UInt32"
  | .uint64 => "UInt64"
  | .usize => "USize"
  | .byteArray => "ByteArray"
  | .array element => s!"Array {element.label}"
  | .list element => s!"List {element.label}"
  | .option element => s!"Option {element.label}"
  | .prod fst snd => s!"{fst.label} × {snd.label}"
  | .simpleEnum name _ => name.toString
  | .taggedUnion _ label _ => label
  | .recursiveSelf _ label => label
  | .customInductive _ label _ => label
  | .structure _ label .. => label
  | .resource _ label => label
  | .function .. => "Function"
  | .expr => "Lean.Expr"

def InterfaceType.wireTag : InterfaceType → Nat
  | .unit => 22
  | .nat => 0
  | .int => 1
  | .bool => 2
  | .string => 3
  | .float => 10
  | .float32 => 11
  | .uint8 => 4
  | .uint16 => 5
  | .uint32 => 6
  | .uint64 => 7
  | .usize => 8
  | .byteArray => 9
  | .array .. => 16
  | .list .. => 17
  | .option .. => 18
  | .prod .. => 19
  | .simpleEnum .. => 14
  | .taggedUnion .. => 21
  | .customInductive .. => 25
  | .recursiveSelf .. => 26
  | .structure .. => 20
  | .resource .. => 23
  | .function .. => 24
  | .expr => 15

partial def InterfaceType.needsBoxedCallBoundary : InterfaceType → Bool
  | .float | .float32 | .uint64 => true
  | .structure _ _ (some idx) _ _ _ fields =>
      match fields[idx]? with
      | some (_, fieldType, _, _) => fieldType.needsBoxedCallBoundary
      | none => false
  | _ => false

def jsonEscape (text : String) : String :=
  text.foldl (fun out c =>
    match c with
    | '"' => out ++ "\\\""
    | '\\' => out ++ "\\\\"
    | '\n' => out ++ "\\n"
    | '\r' => out ++ "\\r"
    | '\t' => out ++ "\\t"
    | _ => out.push c) ""

def jsonString (text : String) : String :=
  "\"" ++ jsonEscape text ++ "\""

def jsonArray (items : Array String) : String :=
  "[" ++ ",".intercalate items.toList ++ "]"

def jsonObject (fields : Array (String × String)) : String :=
  let entries := fields.map fun (name, value) => jsonString name ++ ":" ++ value
  "{" ++ ",".intercalate entries.toList ++ "}"

def jsonBool (value : Bool) : String :=
  if value then "true" else "false"

def jsonNat (value : Nat) : String :=
  toString value

def jsonName (name : Name) : String :=
  jsonString name.toString

def ctorShortName (inductiveName ctorName : Name) : String :=
  let prefixText := inductiveName.toString ++ "."
  let text := ctorName.toString
  if text.startsWith prefixText then
    (text.drop prefixText.length).toString
  else
    text

def StructureFieldLayout.toJson : StructureFieldLayout → String
  | .object index =>
      jsonObject #[
        ("kind", jsonString "object"),
        ("index", jsonNat index)
      ]
  | .usize index =>
      jsonObject #[
        ("kind", jsonString "usize"),
        ("index", jsonNat index)
      ]
  | .scalar size offset =>
      jsonObject #[
        ("kind", jsonString "scalar"),
        ("size", jsonNat size),
        ("offset", jsonNat offset)
      ]

partial def InterfaceType.toJson (ty : InterfaceType) : String :=
  match ty with
  | .array element =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "array"),
        ("element", element.toJson)
      ]
  | .list element =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "list"),
        ("element", element.toJson)
      ]
  | .option element =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "option"),
        ("element", element.toJson)
      ]
  | .prod fst snd =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "prod"),
        ("fst", fst.toJson),
        ("snd", snd.toJson)
      ]
  | .simpleEnum name constructors =>
      let ctorJson := constructors.mapIdx fun idx ctor =>
        jsonObject #[
          ("name", jsonName ctor),
          ("jsName", jsonString (ctorShortName name ctor)),
          ("tag", jsonNat idx)
        ]
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "simpleEnum"),
        ("constructors", jsonArray ctorJson)
      ]
  | .taggedUnion name _ constructors =>
      let ctorJson := constructors.mapIdx fun idx (ctorName, jsName, fieldType, fieldLayout, objectFields, usizeFields, scalarBytes) =>
        jsonObject #[
          ("name", jsonName ctorName),
          ("jsName", jsonString jsName),
          ("tag", jsonNat idx),
          ("type", fieldType.toJson),
          ("layout", fieldLayout.toJson),
          ("objectFieldCount", jsonNat objectFields),
          ("usizeFieldCount", jsonNat usizeFields),
          ("scalarByteSize", jsonNat scalarBytes)
        ]
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "taggedUnion"),
        ("name", jsonName name),
        ("constructors", jsonArray ctorJson)
      ]
  | .recursiveSelf name _ =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "recursiveSelf"),
        ("name", jsonName name)
      ]
  | .customInductive name _ constructors =>
      let ctorJson := constructors.mapIdx fun idx (ctorName, jsName, objectFields, usizeFields, scalarBytes, fields) =>
        let fieldJson := fields.map fun (fieldName, fieldType, fieldLayout) =>
          jsonObject #[
            ("name", jsonString fieldName),
            ("type", fieldType.toJson),
            ("layout", fieldLayout.toJson)
          ]
        jsonObject #[
          ("name", jsonName ctorName),
          ("jsName", jsonString jsName),
          ("tag", jsonNat idx),
          ("objectFieldCount", jsonNat objectFields),
          ("usizeFieldCount", jsonNat usizeFields),
          ("scalarByteSize", jsonNat scalarBytes),
          ("fields", jsonArray fieldJson)
        ]
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "customInductive"),
        ("name", jsonName name),
        ("constructors", jsonArray ctorJson)
      ]
  | .structure name _ trivialField? objectFields usizeFields scalarBytes fields =>
      let fieldJson := fields.map fun (fieldName, fieldType, fieldLayout, isSubobject) =>
        let fieldFields := #[
          ("name", jsonString fieldName),
          ("type", fieldType.toJson),
          ("layout", fieldLayout.toJson)
        ]
        let fieldFields :=
          if isSubobject then fieldFields.push ("subobject", jsonBool true) else fieldFields
        jsonObject fieldFields
      let structureFields := #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "structure"),
        ("name", jsonName name),
        ("objectFieldCount", jsonNat objectFields),
        ("usizeFieldCount", jsonNat usizeFields),
        ("scalarByteSize", jsonNat scalarBytes)
      ]
      let structureFields :=
        match trivialField? with
        | some idx => structureFields.push ("trivialFieldIndex", jsonNat idx)
        | none => structureFields
      jsonObject (structureFields.push ("fields", jsonArray fieldJson))
  | .resource name _ =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "resource"),
        ("name", jsonName name)
      ]
  | .function args result effect =>
      let argJson := args.map fun (argName, argType) =>
        jsonObject #[
          ("name", jsonString argName),
          ("type", argType.toJson)
        ]
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag),
        ("kind", jsonString "function"),
        ("effect", jsonString effect.label),
        ("args", jsonArray argJson),
        ("result", result.toJson)
      ]
  | _ =>
      jsonObject #[
        ("type", jsonString ty.label),
        ("wireTag", jsonNat ty.wireTag)
      ]

partial def stripMData : Lean.Expr → Lean.Expr
  | .mdata _ e => stripMData e
  | e => e

def preserveInterfaceHead : Name → Bool
  | `Unit
  | `Nat
  | `Int
  | `Bool
  | `String
  | `Float
  | `Float32
  | `UInt8
  | `UInt16
  | `UInt32
  | `UInt64
  | `USize
  | `ByteArray
  | `Lean.Expr
  | `Array
  | `List
  | `Option
  | `Prod
  | `Sum
  | `Except
  | `IO
  | `Lean.Vir.Browser.DomM
  | `Lean.Vir.React.ReactM
  | `Lean.Vir.Js => true
  | _ => false

def unfoldAbbrevHead? (e : Lean.Expr) : CoreM (Option Lean.Expr) := do
  let e := stripMData e
  let (_, args) := e.getAppFnArgs
  match e.getAppFn with
  | .const name levels =>
      if preserveInterfaceHead name then
        return none
      else
        let env ← getEnv
        match env.find? name with
        | some (.defnInfo info) =>
            if info.hints == .abbrev then
              let value := (ConstantInfo.defnInfo info).instantiateValueLevelParams! levels
              let unfolded := stripMData (value.beta args)
              if unfolded == e then return none else return some unfolded
            else
              return none
        | _ => return none
  | _ => return none

partial def reduceTypeAliases (e : Lean.Expr) : CoreM Lean.Expr := do
  match ← unfoldAbbrevHead? e with
  | some unfolded => reduceTypeAliases unfolded
  | none => return stripMData e

def constName? (e : Lean.Expr) : Option Name :=
  match stripMData e with
  | .const n _ => some n
  | _ => none

def headConstName? (e : Lean.Expr) : Option Name :=
  match (stripMData e).getAppFn with
  | .const n _ => some n
  | _ => none

def simpleInterfaceType? (e : Lean.Expr) : Option InterfaceType :=
  match constName? e with
  | some `Unit => some .unit
  | some `Nat => some .nat
  | some `Int => some .int
  | some `Bool => some .bool
  | some `String => some .string
  | some `Float => some .float
  | some `Float32 => some .float32
  | some `UInt8 => some .uint8
  | some `UInt16 => some .uint16
  | some `UInt32 => some .uint32
  | some `UInt64 => some .uint64
  | some `USize => some .usize
  | some `ByteArray => some .byteArray
  | some `Lean.Expr => some .expr
  | _ => none

def jsResourceMarker? (e : Lean.Expr) : Option (Name × String) := do
  let name ← constName? e
  match name with
  | `Lean.Vir.Browser.Element => some (name, "Element")
  | `Lean.Vir.Browser.Event => some (name, "Event")
  | `Lean.Vir.Browser.EventListener => some (name, "EventListener")
  | `Lean.Vir.Browser.HTMLInputElement => some (name, "HTMLInputElement")
  | `Lean.Vir.Browser.Timeout => some (name, "Timeout")
  | `Lean.Vir.Browser.AnimationFrame => some (name, "AnimationFrame")
  | `Lean.Vir.React.Root => some (name, "ReactRoot")
  | _ => none

def resourceInterfaceType? (_env : Environment) (e : Lean.Expr) : Option InterfaceType :=
  let (fn, args) := (stripMData e).getAppFnArgs
  match fn with
  | `Lean.Vir.Js =>
      match args[0]? >>= jsResourceMarker? with
      | some (name, label) => some (.resource name label)
      | none => some (.resource `Lean.Vir.Js "Js")
  | _ => none

def simpleEnumType? (env : Environment) (e : Lean.Expr) : Option InterfaceType := do
  let name <- constName? e
  let .inductInfo info <- env.find? name | none
  if info.numParams != 0 || info.numIndices != 0 || info.isRec || info.ctors.isEmpty then
    none
  else
    let ctors := info.ctors.toArray
    let allNullary := ctors.all fun ctor =>
      match env.find? ctor with
      | some (.ctorInfo ctorInfo) => ctorInfo.induct == name && ctorInfo.numFields == 0
      | _ => false
    if allNullary then some (.simpleEnum name ctors) else none

partial def exprTypeLabel (e : Lean.Expr) : String :=
  match simpleInterfaceType? e with
  | some ty => ty.label
  | none =>
      let e := stripMData e
      let (fn, args) := e.getAppFnArgs
      match fn, Array.toList args with
      | `Array, [arg] => s!"Array {typeArgLabel arg}"
      | `List, [arg] => s!"List {typeArgLabel arg}"
      | `Option, [arg] => s!"Option {typeArgLabel arg}"
      | `Prod, [lhs, rhs] => s!"{exprTypeLabel lhs} × {exprTypeLabel rhs}"
      | _, [] =>
          if fn.isAnonymous then toString e else fn.toString
      | _, args =>
          if fn.isAnonymous then
            toString e
          else
            fn.toString ++ " " ++ " ".intercalate (args.map typeArgLabel)
where
  typeArgLabel (e : Lean.Expr) : String :=
    let label := exprTypeLabel e
    if label.contains ' ' || label.contains '×' then
      "(" ++ label ++ ")"
    else
      label

partial def instantiateForallPrefix? (type : Lean.Expr) (args : Array Lean.Expr) : Option Lean.Expr :=
  let rec go (idx : Nat) (type : Lean.Expr) : Option Lean.Expr :=
    if h : idx < args.size then
      match stripMData type with
      | .forallE _ _ body _ => go (idx + 1) (body.instantiate1 args[idx])
      | _ => none
    else
      some type
  go 0 type

def projectionFieldType? (numParams : Nat) (params : Array Lean.Expr) (projType : Lean.Expr) : Option Lean.Expr := do
  if params.size != numParams then
    none
  let instantiated ← instantiateForallPrefix? projType params
  match stripMData instantiated with
  | .forallE _ _ body _ => some body
  | _ => none

def structureFieldLayout? : Lean.Compiler.LCNF.CtorFieldInfo → Option StructureFieldLayout
  | .object index _ => some (.object index)
  | .usize index => some (.usize index)
  | .scalar size offset _ => some (.scalar size offset)
  | .erased | .void => none

def recursiveSeenContains (seen : RecursiveSeen) (name : Name) (key : String) : Bool :=
  seen.any fun (seenName, seenKey) => seenName == name && seenKey == key

def recursiveSeenContainsName (seen : RecursiveSeen) (name : Name) : Bool :=
  seen.any fun (seenName, _) => seenName == name

def recursiveSeenLastMatches (seen : RecursiveSeen) (name : Name) (key : String) : Bool :=
  match seen[seen.size - 1]? with
  | some (seenName, seenKey) => seenName == name && seenKey == key
  | none => false

inductive RecursiveVisit where
  | selfReference
  | descend (nextSeen : RecursiveSeen)
  | error (reason : String)

def recursiveVisit (seen : RecursiveSeen) (kind : String) (name : Name) (key : String) (isRec : Bool) :
    RecursiveVisit :=
  if recursiveSeenContains seen name key then
    if recursiveSeenLastMatches seen name key then
      .selfReference
    else
      .error s!"mutually recursive {kind} `{name}` is not supported"
  else if isRec && recursiveSeenContainsName seen name then
    .error s!"non-uniform recursive {kind} `{name}` is not supported"
  else
    .descend (seen.push (name, key))

def binderArgName (fallback : Nat) (name : Name) : String :=
  let candidate := name.toString
  if name.isAnonymous || candidate.startsWith "_" || candidate.contains '_' then
    s!"arg{fallback}"
  else
    candidate

def effectResultRaw? (e : Lean.Expr) : Option (InterfaceEffect × Lean.Expr) :=
  let e := stripMData e
  let (fn, args) := e.getAppFnArgs
  match fn, Array.toList args with
  | `IO, [result] => some (.io, result)
  | `Lean.Vir.Browser.DomM, [result] => some (.dom, result)
  | `Lean.Vir.React.ReactM, [result] => some (.react, result)
  | _, _ => none

def effectResult? (e : Lean.Expr) : CoreM (Option (InterfaceEffect × Lean.Expr)) := do
  match effectResultRaw? e with
  | some result => return some result
  | none =>
      let e := stripMData e
      let reduced ← reduceTypeAliases e
      if reduced == e then
        return none
      else
        return effectResultRaw? reduced

def isRuntimeErasedTypeBinder (domain : Lean.Expr) : Bool :=
  match stripMData domain with
  | .sort _ => true
  | _ => false

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
  match e with
  | .forallE .. => functionType e
  | _ =>
      let env ← getEnv
      match simpleInterfaceType? e <|> resourceInterfaceType? env e with
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

def isInterfaceDeclInfo : ConstantInfo → Bool
  | .defnInfo _ => true
  | .opaqueInfo _ => true
  | _ => false

def isGeneratedAuxName (n : Name) : Bool :=
  match boxedBaseName? n with
  | some _ => true
  | none =>
      let text := n.toString
      (text.splitOn "._").length > 1 ||
        text.endsWith ".elim" ||
        text.endsWith ".ctorElim" ||
        text.endsWith ".rec" ||
        text.endsWith ".casesOn" ||
        text.endsWith ".ctorIdx" ||
        text.endsWith ".toCtorIdx" ||
        text.endsWith ".noConfusion" ||
        text.endsWith ".noConfusionType"

def sourceDeclNamesFor (index : DeclIndex) (target : Target) : Array Name :=
  index.sourceDecls.findSome? (fun (source, names) =>
    if source == target.source.toString then some names else none) |>.getD #[]

def publicSourceDeclsFor (index : DeclIndex) (target : Target) : Array Name :=
  match index.envForSource? target.source.toString with
  | none => #[]
  | some env =>
      sourceDeclNamesFor index target |>.filter fun n =>
        !isPrivateName n &&
        !isGeneratedAuxName n &&
        match env.find? n with
        | some info => isInterfaceDeclInfo info
        | none => false

def exportCandidatesFor (index : DeclIndex) (target : Target) : Array Name :=
  if target.packageOnly then
    #[]
  else if target.includeAll then
    publicSourceDeclsFor index target
  else
    target.roots.foldl (fun acc root =>
      let n := (boxedBaseName? root).getD root
      if acc.contains n then acc else acc.push n) #[]

def sanitizeJsNameChar (c : Char) : Char :=
  if c.isAlphanum || c == '_' then c else '_'

def jsNameFor (n : Name) : String :=
  let text := n.toString
  let sanitized := text.map sanitizeJsNameChar
  if sanitized.isEmpty then "entry" else sanitized

def interfaceNeedsBoxedCallBoundary (args : Array InterfaceArg) (result : InterfaceType) : Bool :=
  args.any (fun arg => arg.type.needsBoxedCallBoundary) || result.needsBoxedCallBoundary

def boxedBoundaryDiagnostic (name : Name) : String :=
  s!"top-level Float, Float32, UInt64, and trivial wrappers over them require generated boxed declaration `{boxedName name}` at the wasm32 interpreter boundary"

def interfaceExportFor (index : DeclIndex) (source : String) (name : Name) :
    CoreM (Except InterfaceDiagnostic InterfaceExport) := do
  if isPrivateName name then
    return .error { name, source, reason := "private declarations are not exported" }
  else
    let env ← getEnv
    match env.find? name with
    | none => return .error { name, source, reason := "missing elaborated Lean declaration" }
    | some info =>
        if !isInterfaceDeclInfo info then
          return .error { name, source, reason := "declaration is not a compiled definition" }
        else
          match ← interfaceSignature? info.type with
          | .ok (args, result, effect, erasedArgCount) =>
              if erasedArgCount != 0 then
                return .error {
                  name,
                  source,
                  reason := "polymorphic exported entrypoints with erased type parameters are not supported; export a concrete wrapper"
                }
              else if interfaceNeedsBoxedCallBoundary args result && (index.find? (boxedName name)).isNone then
                return .error { name, source, reason := boxedBoundaryDiagnostic name }
              else
                let jsName := jsNameFor name
                return .ok { id := jsName, jsName, entry := name, source, args, result, effect }
          | .error reason =>
              return .error { name, source, reason }

def DeclIndex.constInfo? (index : DeclIndex) (name : Name) : Option (String × Environment × ConstantInfo) :=
  index.envs.findSome? fun (source, env) =>
    match env.find? name with
    | some info => some (source, env, info)
    | none => none

def hostImportSymbol (slot arity : Nat) : String :=
  s!"vir_js_import_{slot}_{arity}"

def declParamCount : Decl → Nat
  | .fdecl _ params _ _ _ => params.size
  | .extern _ params _ _ => params.size

def hostImportFor (slot : Nat) (loaded : LoadedDecl) :
    CoreM (Except InterfaceDiagnostic HostImport) := do
  let some target := virJsTargetFromDecl? loaded.decl
    | return .error { name := loaded.decl.name, source := loaded.source, reason := "declaration is not a Vir JavaScript import" }
  if slot >= maxHostImportSlots then
    return .error { name := loaded.decl.name, source := loaded.source, reason := s!"too many JavaScript imports; v1 supports at most {maxHostImportSlots}" }
  let arity := declParamCount loaded.decl
  if arity > maxHostImportArity then
    return .error { name := loaded.decl.name, source := loaded.source, reason := s!"JavaScript import arity {arity} exceeds v1 limit {maxHostImportArity}" }
  let env ← getEnv
  let some info := env.find? loaded.decl.name
    | return .error { name := loaded.decl.name, source := loaded.source, reason := "missing elaborated Lean declaration for JavaScript import" }
  match ← interfaceSignature? info.type with
  | .error reason =>
      return .error { name := loaded.decl.name, source := loaded.source, reason := s!"unsupported JavaScript import signature: {reason}" }
  | .ok (args, result, effect, erasedArgCount) =>
    let expectedArity := erasedArgCount + args.size + if effect.isEffectful then 1 else 0
    if arity != expectedArity then
      return .error {
        name := loaded.decl.name,
        source := loaded.source,
        reason := s!"JavaScript import IR arity mismatch: expected {expectedArity}, got {arity}"
      }
    return .ok {
      slot,
      name := loaded.decl.name,
      source := loaded.source,
      target,
      symbol := hostImportSymbol slot arity,
      arity,
      erasedPrefixArgs := erasedArgCount,
      args,
      result,
      effect
    }

def runCoreForSource (source : String) (env : Environment) (x : CoreM α) : IO α :=
  x.toIO'
    { fileName := source, fileMap := default }
    { env := env }

def collectHostImports (index : DeclIndex) (closure : Closure) : IO (Array HostImport × Array InterfaceDiagnostic) := do
  let mut seen : NameSet := {}
  let mut imports : Array HostImport := #[]
  let mut diagnostics : Array InterfaceDiagnostic := #[]
  for loaded in closure.decls do
    if isVirJsDecl loaded.decl && !seen.contains loaded.decl.name then
      seen := seen.insert loaded.decl.name
      match index.constInfo? loaded.decl.name with
      | none =>
          diagnostics := diagnostics.push {
            name := loaded.decl.name,
            source := loaded.source,
            reason := "source environment was not loaded"
          }
      | some (source, env, _) =>
          match ← runCoreForSource source env (hostImportFor imports.size loaded) with
          | .ok hostImport => imports := imports.push hostImport
          | .error diagnostic => diagnostics := diagnostics.push diagnostic
  return (imports, diagnostics)

end Vir.GeneratePackage
