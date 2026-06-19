/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Json

open Lean

namespace Vir.GeneratePackage

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

end Vir.GeneratePackage
