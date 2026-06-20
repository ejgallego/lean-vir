/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Interface.Encode

open Lean

namespace Vir.GeneratePackage

open Lean.IR

partial def InterfaceType.needsBoxedCallBoundary : InterfaceType → Bool
  | .float | .float32 | .uint64 => true
  | .structure _ _ (some idx) _ _ _ fields =>
      match fields[idx]? with
      | some (_, fieldType, _, _) => fieldType.needsBoxedCallBoundary
      | none => false
  | _ => false

partial def stripMData : Lean.Expr → Lean.Expr
  | .mdata _ e => stripMData e
  | e => e

def effectHead? : Name → Option InterfaceEffect
  | `Lean.Vir.RuntimeM => some .runtime
  | `IO => some .io
  | `Lean.Vir.Browser.DomM => some .dom
  | `Lean.Vir.React.ReactM => some .react
  | _ => none

def preserveInterfaceHead (name : Name) : Bool :=
  if (effectHead? name).isSome then
    true
  else
    match name with
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

def resourceInterfaceType? (e : Lean.Expr) : Option InterfaceType :=
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
  match effectHead? fn, Array.toList args with
  | some effect, [result] => some (effect, result)
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

end Vir.GeneratePackage
