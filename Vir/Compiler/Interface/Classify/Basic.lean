/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Compiler.LCNF.ToImpureType
public import Vir.Compiler.Interface.Model
public import Vir.Compiler.InterfaceValidation

public section

open Lean

namespace Vir.Interface

open Lean.IR
open Vir.InterfaceValidation

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

def isRuntimeErasedTypeBinder (domain : Lean.Expr) : Bool :=
  domain.consumeMData.isSort

end Vir.Interface
