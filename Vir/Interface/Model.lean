/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Data.Name

public section

open Lean

namespace Vir.Interface

/-- The runtime storage class of a field in Lean's compiled representation. -/
inductive StructureFieldLayout where
  | object (index : Nat)
  | usize (index : Nat)
  | scalar (size offset : Nat)
  deriving BEq, Repr

/-- The effect through which an interface function executes. -/
inductive InterfaceEffect where
  | pure
  | runtime
  | io
  | dom
  | react
  deriving BEq, Repr

def InterfaceEffect.label : InterfaceEffect → String
  | .pure => "pure"
  | .runtime => "runtime"
  | .io => "io"
  | .dom => "dom"
  | .react => "react"

def InterfaceEffect.isEffectful : InterfaceEffect → Bool
  | .pure => false
  | _ => true

def InterfaceEffect.display : InterfaceEffect → String
  | .pure => ""
  | .runtime => "RuntimeM"
  | .io => "IO"
  | .dom => "DomM"
  | .react => "ReactM"

/-- A Lean type classified for VIR's JavaScript interface. -/
inductive InterfaceType where
  | unit
  | nat
  | int
  | bool
  | string
  | float
  | float32
  | uint8
  | uint16
  | uint32
  | uint64
  | usize
  | byteArray
  | array (element : InterfaceType)
  | list (element : InterfaceType)
  | option (element : InterfaceType)
  | prod (fst snd : InterfaceType)
  | simpleEnum (name : Name) (constructors : Array Name)
  | taggedUnion (name : Name) (label : String)
      (constructors : Array (Name × String × InterfaceType × StructureFieldLayout × Nat × Nat × Nat))
  | recursiveSelf (name : Name) (label : String)
  | customInductive (name : Name) (label : String)
      (constructors : Array (Name × String × Nat × Nat × Nat × Array (String × InterfaceType × StructureFieldLayout)))
  | structure (name : Name) (label : String) (trivialField? : Option Nat)
      (objectFields usizeFields scalarBytes : Nat)
      (fields : Array (String × InterfaceType × StructureFieldLayout × Bool))
  | resource (name : Name) (label : String)
  | function (args : Array (String × InterfaceType)) (result : InterfaceType) (effect : InterfaceEffect)
  | expr
  | leanObject
  deriving BEq, Repr

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
  | .leanObject => "LeanObject"

/-- The JavaScript-facing constructor name relative to its inductive type. -/
def constructorLabel (inductiveName ctorName : Name) : String :=
  let prefixText := inductiveName.toString ++ "."
  let text := ctorName.toString
  if text.startsWith prefixText then
    (text.drop prefixText.length).toString
  else
    text

/-- One named JavaScript-visible function argument. -/
structure InterfaceArg where
  name : String
  type : InterfaceType

/-- The runtime policy applied to a JavaScript host import. -/
inductive HostImportBoundary where
  | hostResource
  | explicitConversion
  | objectHandle
  deriving BEq, Inhabited

def HostImportBoundary.label : HostImportBoundary → String
  | .hostResource => "hostResource"
  | .explicitConversion => "explicitConversion"
  | .objectHandle => "objectHandle"

end Vir.Interface
