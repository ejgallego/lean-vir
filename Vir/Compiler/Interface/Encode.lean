/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Compiler.Interface.Model
import Vir.Package.Json

public section

open Lean

namespace Vir.Interface

open Vir.GeneratePackage

def InterfaceType.interfaceTag : InterfaceType → Nat
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
  | .leanObject => 27

def FieldLayout.toJson : FieldLayout → String
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

private def ConstructorStorage.jsonFields (storage : ConstructorStorage) : Array (String × String) := #[
  ("objectFieldCount", jsonNat storage.objectFieldCount),
  ("usizeFieldCount", jsonNat storage.usizeFieldCount),
  ("scalarByteSize", jsonNat storage.scalarByteSize)
]

mutual

partial def InterfaceType.toJson (ty : InterfaceType) : String :=
  let encode (fields : Array (String × String)) :=
    jsonObject (#[
      ("type", jsonString ty.label),
      ("interfaceTag", jsonNat ty.interfaceTag)
    ] ++ fields)
  match ty with
  | .array element =>
      encode #[
        ("kind", jsonString "array"),
        ("element", element.toJson)
      ]
  | .list element =>
      encode #[
        ("kind", jsonString "list"),
        ("element", element.toJson)
      ]
  | .option element =>
      encode #[
        ("kind", jsonString "option"),
        ("element", element.toJson)
      ]
  | .prod fst snd =>
      encode #[
        ("kind", jsonString "prod"),
        ("fst", fst.toJson),
        ("snd", snd.toJson)
      ]
  | .simpleEnum name constructors =>
      let ctorJson := constructors.mapIdx fun idx ctor =>
        jsonObject #[
          ("name", jsonName ctor),
          ("jsName", jsonString (constructorLabel name ctor)),
          ("tag", jsonNat idx)
        ]
      encode #[
        ("kind", jsonString "simpleEnum"),
        ("constructors", jsonArray ctorJson)
      ]
  | .taggedUnion name _ constructors =>
      let ctorJson := constructors.mapIdx fun idx constructor =>
        jsonObject (#[
          ("name", jsonName constructor.constructorName),
          ("jsName", jsonString (constructorLabel name constructor.constructorName)),
          ("tag", jsonNat idx),
          ("type", constructor.payloadType.toJson),
          ("layout", constructor.payloadLayout.toJson)
        ] ++ constructor.storage.jsonFields)
      encode #[
        ("kind", jsonString "taggedUnion"),
        ("name", jsonName name),
        ("constructors", jsonArray ctorJson)
      ]
  | .recursiveSelf name _ =>
      encode #[
        ("kind", jsonString "recursiveSelf"),
        ("name", jsonName name)
      ]
  | .customInductive name _ constructors =>
      let ctorJson := constructors.mapIdx fun idx constructor =>
        let fieldJson := constructor.fields.map fun field =>
          jsonObject #[
            ("name", jsonString field.name),
            ("type", field.type.toJson),
            ("layout", field.layout.toJson)
          ]
        jsonObject (#[
          ("name", jsonName constructor.constructorName),
          ("jsName", jsonString (constructorLabel name constructor.constructorName)),
          ("tag", jsonNat idx)
        ] ++ constructor.storage.jsonFields ++ #[
          ("fields", jsonArray fieldJson)
        ])
      encode #[
        ("kind", jsonString "customInductive"),
        ("name", jsonName name),
        ("constructors", jsonArray ctorJson)
      ]
  | .structure name _ descriptor =>
      let fieldJson := descriptor.fields.map fun field =>
        let fieldFields := #[
          ("name", jsonString field.name),
          ("type", field.type.toJson),
          ("layout", field.layout.toJson)
        ]
        let fieldFields :=
          if field.isSubobject then fieldFields.push ("subobject", jsonBool true) else fieldFields
        jsonObject fieldFields
      let structureFields := #[
        ("kind", jsonString "structure"),
        ("name", jsonName name)
      ] ++ descriptor.storage.jsonFields
      let structureFields :=
        match descriptor.trivialField? with
        | some idx => structureFields.push ("trivialFieldIndex", jsonNat idx)
        | none => structureFields
      encode (structureFields.push ("fields", jsonArray fieldJson))
  | .resource name _ =>
      encode #[
        ("kind", jsonString "resource"),
        ("name", jsonName name)
      ]
  | .function args result effect =>
      let argJson := args.map InterfaceArg.toJson
      encode #[
        ("kind", jsonString "function"),
        ("effect", jsonString effect.label),
        ("args", jsonArray argJson),
        ("result", result.toJson)
      ]
  | .leanObject =>
      encode #[
        ("kind", jsonString "leanObject")
      ]
  | _ =>
      encode #[]

/-- Encode a named argument without depending on generator metadata. -/
partial def InterfaceArg.toJson (arg : InterfaceArg) : String :=
  jsonObject #[
    ("name", jsonString arg.name),
    ("type", arg.type.toJson)
  ]

end

def InterfaceEffect.toJson (effect : InterfaceEffect) : String :=
  jsonString effect.label

/-- Independent callable expectation for createProgram's expectedExports.
Only argument types, result and effect participate: parameter display names and
erased implementation slots are not the caller's JavaScript value interface. -/
def ClassifiedSignature.toExpectedSignatureJson (signature : ClassifiedSignature) : String :=
  jsonObject #[
    ("args", jsonArray (signature.args.map (·.type.toJson))),
    ("result", signature.result.toJson),
    ("effect", signature.effect.toJson)
  ]

end Vir.Interface
