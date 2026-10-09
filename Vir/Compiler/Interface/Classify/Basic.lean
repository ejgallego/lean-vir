/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Compiler.LCNF.Main
public import Lean.Compiler.LCNF.ToImpureType
public import Vir.Compiler.Interface.Classify.Error
public import Vir.Compiler.Interface.Model
public import Vir.Compiler.InterfaceValidation

public section

open Lean

namespace Vir.Interface

open Lean.IR
open Vir.InterfaceValidation

/-- Aggregate applications already visited while classifying recursive interface types. -/
abbrev RecursiveSeen := Array (Name × String)

def InterfaceEffect.ofEffectKind : Vir.InterfaceValidation.EffectKind → InterfaceEffect
  | .runtime => .runtime
  | .io => .io
  | .dom => .dom
  | .react => .react

def InterfaceEffect.ofStartupEffect : Vir.InterfaceValidation.StartupEffect → InterfaceEffect
  | .pure => .pure
  | .effect kind => .ofEffectKind kind

def effectHead? (name : Name) : Option InterfaceEffect :=
  Vir.InterfaceValidation.effectKind? name |>.map InterfaceEffect.ofEffectKind

private def primitiveInterfaceType? : Name → Option InterfaceType
  | `Unit => some .unit
  | `Nat => some .nat
  | `Int => some .int
  | `Bool => some .bool
  | `String => some .string
  | `Float => some .float
  | `Float32 => some .float32
  | `UInt8 => some .uint8
  | `UInt16 => some .uint16
  | `UInt32 => some .uint32
  | `UInt64 => some .uint64
  | `USize => some .usize
  | `ByteArray => some .byteArray
  | `Lean.Expr => some .expr
  | _ => none

def preserveInterfaceHead (name : Name) : Bool :=
  if (effectHead? name).isSome || (primitiveInterfaceType? name).isSome then
    true
  else
    match name with
    | `Array
    | `List
    | `Option
    | `Prod
    | `Sum
    | `Except
    | `Lean.Vir.Js => true
    | _ => false

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

def simpleInterfaceType? (e : Lean.Expr) : Option InterfaceType :=
  e.consumeMData.constName?.bind primitiveInterfaceType?

def optParamType? (e : Lean.Expr) : Option Lean.Expr := do
  let (fn, args) := e.consumeMData.getAppFnArgs
  if fn == `optParam then
    args[0]?
  else
    none

def jsResourceMarker? (e : Lean.Expr) : Option (Name × String) := do
  let name ← e.consumeMData.constName?
  match name with
  | `Lean.Vir.Browser.CSSStyleDeclaration => some (name, "CSSStyleDeclaration")
  | `Lean.Vir.Browser.Element => some (name, "Element")
  | `Lean.Vir.Browser.DOMTokenList => some (name, "DOMTokenList")
  | `Lean.Vir.Browser.ElementCSSInlineStyle => some (name, "ElementCSSInlineStyle")
  | `Lean.Vir.Browser.Event => some (name, "Event")
  | `Lean.Vir.Browser.KeyboardEvent => some (name, "KeyboardEvent")
  | `Lean.Vir.Browser.EventListener => some (name, "EventListener")
  | `Lean.Vir.Browser.HTMLInputElement => some (name, "HTMLInputElement")
  | `Lean.Vir.Browser.HTMLCanvasElement => some (name, "HTMLCanvasElement")
  | `Lean.Vir.Browser.CanvasRenderingContext2D => some (name, "CanvasRenderingContext2D")
  | `Lean.Vir.Browser.TextMetrics => some (name, "TextMetrics")
  | `Lean.Vir.Browser.CanvasStyle => some (name, "CanvasStyle")
  | `Lean.Vir.Browser.Timeout => some (name, "Timeout")
  | `Lean.Vir.Browser.Interval => some (name, "Interval")
  | `Lean.Vir.Browser.AnimationFrame => some (name, "AnimationFrame")
  | `Lean.Vir.React.Root => some (name, "ReactRoot")
  | _ => none

def resourceInterfaceType? (e : Lean.Expr) : Option InterfaceType :=
  let (fn, args) := e.consumeMData.getAppFnArgs
  match fn with
  | `Lean.Vir.Js =>
      match args[0]? >>= jsResourceMarker? with
      | some (name, label) => some (.resource name label)
      | none => some (.resource `Lean.Vir.Js "Js")
  | _ => none

def simpleEnumType? (env : Environment) (e : Lean.Expr) : Option InterfaceType := do
  let name <- e.consumeMData.constName?
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
      let e := e.consumeMData
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

/-- Instantiate only syntactically present binders; do not reduce to expose more. -/
def instantiateForallPrefix? (type : Lean.Expr) (args : Array Lean.Expr) : Option Lean.Expr :=
  args.foldlM (init := type) fun type arg => do
    let .forallE _ _ body _ := type.consumeMData | none
    some (body.instantiate1 arg)

def projectionFieldType? (numParams : Nat) (params : Array Lean.Expr) (projType : Lean.Expr) : Option Lean.Expr := do
  if params.size != numParams then
    none
  let instantiated ← instantiateForallPrefix? projType params
  match instantiated.consumeMData with
  | .forallE _ _ body _ => some body
  | _ => none

def fieldLayout? : Lean.Compiler.LCNF.CtorFieldInfo → Option FieldLayout
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
  | error (error : InterfaceClassifierError)

def recursiveVisit
    (seen : RecursiveSeen) (kind : InterfaceAggregateKind) (name : Name) (key : String)
    (isRec : Bool) :
    RecursiveVisit :=
  if recursiveSeenContains seen name key then
    if recursiveSeenLastMatches seen name key then
      .selfReference
    else
      .error (.mutuallyRecursive kind name)
  else if isRec && recursiveSeenContainsName seen name then
    .error (.nonUniformRecursive kind name)
  else
    .descend (seen.push (name, key))

def binderArgName (fallback : Nat) (name : Name) : String :=
  let candidate := name.toString
  if name.isAnonymous || candidate.startsWith "_" || candidate.contains '_' then
    s!"arg{fallback}"
  else
    candidate

def effectResultRaw? (e : Lean.Expr) : Option (InterfaceEffect × Lean.Expr) :=
  let e := e.consumeMData
  let (fn, args) := e.getAppFnArgs
  match effectHead? fn, Array.toList args with
  | some effect, [result] => some (effect, result)
  | _, _ => none

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

def isRuntimeErasedTypeBinder (domain : Lean.Expr) : Bool :=
  domain.consumeMData.isSort

end Vir.Interface
