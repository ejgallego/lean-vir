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

/-- Storage kind and location of a field in Lean's compiled representation.
Object and usize indices select their respective slot arrays; scalar sizes and
offsets count bytes in the constructor's scalar storage. -/
inductive FieldLayout where
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

/-- Runtime storage counts from Lean's compiled constructor layout. These count
object and usize slots and scalar bytes, not source-level constructor arguments;
FieldLayout separately identifies each field's location. -/
structure ConstructorStorage where
  objectFieldCount : Nat
  usizeFieldCount : Nat
  scalarByteSize : Nat
  deriving BEq, Repr

mutual

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
  | simpleEnum (name : Name) (constructors : Array Name)
  | taggedUnion (name : Name) (label : String)
      (constructors : Array TaggedUnionVariant)
  | recursiveRef (name : Name) (label : String) (depth : Nat)
  | customInductive (name : Name) (label : String)
      (constructors : Array InductiveConstructor)
  | structure (name : Name) (label : String) (descriptor : StructureDescriptor)
  | resource (name : Name) (label : String)
  | function (args : Array InterfaceArg) (result : InterfaceType) (effect : InterfaceEffect)
  | expr
  | leanObject
  deriving BEq, Repr

structure TaggedUnionVariant where
  constructorName : Name
  fieldName : String
  payloadType : InterfaceType
  payloadLayout : FieldLayout
  storage : ConstructorStorage
  deriving BEq, Repr

structure InductiveField where
  name : String
  type : InterfaceType
  layout : FieldLayout
  deriving BEq, Repr

structure InductiveConstructor where
  constructorName : Name
  storage : ConstructorStorage
  fields : Array InductiveField
  deriving BEq, Repr

structure StructureField where
  name : String
  type : InterfaceType
  layout : FieldLayout
  /-- An inherited parent retains its own layout; host object keys are flattened. -/
  isSubobject : Bool
  deriving BEq, Repr

structure StructureDescriptor where
  constructorName : Name
  /-- Index into fields of the value representing Lean's trivial wrapper.
  This is a declaration/projection-order index, not a runtime storage slot. -/
  trivialField? : Option Nat
  storage : ConstructorStorage
  fields : Array StructureField
  deriving BEq, Repr

/-- One named JavaScript-visible argument, shared by callbacks and exports. -/
structure InterfaceArg where
  name : String
  type : InterfaceType
  deriving BEq, Repr

end

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
  | .simpleEnum name _ => name.toString
  | .taggedUnion _ label _ => label
  | .recursiveRef _ label _ => label
  | .customInductive _ label _ => label
  | .structure _ label .. => label
  | .resource _ label => label
  | .function .. => "Function"
  | .expr => "Lean.Expr"
  | .leanObject => "LeanObject"

/-- The JavaScript-facing constructor name relative to its inductive type. -/
def constructorLabel (inductiveName ctorName : Name) : String :=
  if ctorName == inductiveName then
    ctorName.toString
  else
    (ctorName.replacePrefix inductiveName .anonymous).toString

/-- A JavaScript-boundary signature after interface type classification. -/
structure ClassifiedSignature where
  args : Array InterfaceArg
  result : InterfaceType
  effect : InterfaceEffect
  erasedPrefixArgs : Nat := 0

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
