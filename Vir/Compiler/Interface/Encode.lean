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

private def ConstructorStorage.toJson (storage : ConstructorStorage) : String :=
  jsonObject #[
    ("objectFieldCount", jsonNat storage.objectFieldCount),
    ("usizeFieldCount", jsonNat storage.usizeFieldCount),
    ("scalarByteSize", jsonNat storage.scalarByteSize)
  ]

/-- Convert compiler field layout to the independent native field buffers.
LCNF usize indices include the preceding object-field prefix; the descriptor
indexes the usize buffer itself. -/
private def FieldLayout.toLocationJson (storage : ConstructorStorage) : FieldLayout → String
  | .object index =>
      jsonObject #[
        ("tag", jsonString "object"),
        ("index", jsonNat index)
      ]
  | .usize index =>
      jsonObject #[
        ("tag", jsonString "usize"),
        ("index", jsonNat (index - storage.objectFieldCount))
      ]
  | .scalar size offset =>
      jsonObject #[
        ("tag", jsonString "scalar"),
        ("size", jsonNat size),
        ("offset", jsonNat offset)
      ]

private def nativeTypeJson (type : InterfaceType) : String :=
  match type with
  | .nat => jsonObject #[("tag", jsonString "nat")]
  | .int => jsonObject #[("tag", jsonString "int")]
  | .string => jsonObject #[("tag", jsonString "string")]
  | .byteArray => jsonObject #[("tag", jsonString "byteArray")]
  | .uint8 => jsonObject #[("tag", jsonString "unsigned"), ("width", jsonNat 8)]
  | .uint16 => jsonObject #[("tag", jsonString "unsigned"), ("width", jsonNat 16)]
  | .uint32 => jsonObject #[("tag", jsonString "unsigned"), ("width", jsonNat 32)]
  | .uint64 => jsonObject #[("tag", jsonString "unsigned"), ("width", jsonNat 64)]
  | .usize => jsonObject #[("tag", jsonString "unsigned"), ("width", jsonString "usize")]
  | .float => jsonObject #[("tag", jsonString "float"), ("width", jsonNat 64)]
  | .float32 => jsonObject #[("tag", jsonString "float"), ("width", jsonNat 32)]
  | .resource .. => jsonObject #[("tag", jsonString "resource")]
  | _ => jsonObject #[("tag", jsonString "leanObject")]

private def immediateConstructorJson (name : Name) : String :=
  jsonObject #[
    ("name", jsonName name),
    ("representation", jsonString "immediate"),
    ("fields", jsonArray #[])
  ]

mutual

private partial def nativeDescriptorJson (type : InterfaceType) : String :=
  let metadata := nativeMetadataFields type
  let fields := #[("type", nativeTypeJson type)] ++
    (if metadata.isEmpty then #[] else #[("metadata", jsonObject metadata)])
  jsonObject fields

private partial def descriptorRefJson (type : InterfaceType) : String :=
  match type with
  | .recursiveRef _ _ depth => jsonObject #[("ref", jsonNat depth)]
  | _ => nativeDescriptorJson type

private partial def nativeMetadataFields (type : InterfaceType) : Array (String × String) :=
  match type with
  | .array element => #[("arrayElement", descriptorRefJson element)]
  | .unit => #[
      ("declaration", jsonName `Unit),
      ("constructors", jsonArray #[immediateConstructorJson `Unit.unit])
    ]
  | .bool => #[
      ("declaration", jsonName `Bool),
      ("constructors", jsonArray #[
        immediateConstructorJson `Bool.false,
        immediateConstructorJson `Bool.true
      ])
    ]
  | .simpleEnum name constructors =>
      let encoded := constructors.map immediateConstructorJson
      #[("declaration", jsonName name), ("constructors", jsonArray encoded)]
  | .customInductive name _ constructors =>
      let encoded := constructors.map inductiveConstructorJson
      #[("declaration", jsonName name), ("constructors", jsonArray encoded)]
  | .structure name _ descriptor =>
      #[
        ("declaration", jsonName name),
        ("constructors", jsonArray #[structureConstructorJson descriptor])
      ]
  | .resource name _ => #[("declaration", jsonName name)]
  | .function args result effect =>
      let signature := jsonObject #[
        ("args", jsonArray (args.map fun arg => descriptorRefJson arg.type)),
        ("result", descriptorRefJson result),
        ("effect", jsonString effect.label)
      ]
      #[("signature", signature)]
  | .expr => #[("declaration", jsonName `Lean.Expr)]
  | _ => #[]

private partial def storedFieldJson
    (storage : ConstructorStorage) (name : String) (type : InterfaceType) (layout : FieldLayout) : String :=
  jsonObject #[
    ("name", jsonString name),
    ("type", descriptorRefJson type),
    ("location", layout.toLocationJson storage)
  ]

private partial def nativeFieldJson (name : String) (type : InterfaceType) : String :=
  jsonObject #[
    ("name", jsonString name),
    ("type", descriptorRefJson type)
  ]

private partial def inductiveConstructorJson (constructor : InductiveConstructor) : String :=
  if constructor.fields.isEmpty then
    immediateConstructorJson constructor.constructorName
  else
    let fields := constructor.fields.map fun field =>
      storedFieldJson constructor.storage field.name field.type field.layout
    jsonObject #[
      ("name", jsonName constructor.constructorName),
      ("representation", jsonString "object"),
      ("storage", constructor.storage.toJson),
      ("fields", jsonArray fields)
    ]

private partial def structureConstructorJson (descriptor : StructureDescriptor) : String :=
  match descriptor.trivialField?, descriptor.fields.toList with
  | some _, [field] =>
      jsonObject #[
        ("name", jsonName descriptor.constructorName),
        ("representation", jsonString "identity"),
        ("fields", jsonArray #[nativeFieldJson field.name field.type])
      ]
  | _, _ =>
      let fields := descriptor.fields.map fun field =>
        storedFieldJson descriptor.storage field.name field.type field.layout
      jsonObject #[
        ("name", jsonName descriptor.constructorName),
        ("representation", jsonString "object"),
        ("storage", descriptor.storage.toJson),
        ("fields", jsonArray fields)
      ]

private partial def recordFieldJson
    (key : String) (path : Array Nat) (type : InterfaceType) : String :=
  jsonObject #[
    ("key", jsonString key),
    ("path", jsonArray (path.map jsonNat)),
    ("value", valueInterfaceJson type)
  ]

private partial def inductiveRecordFieldsJson (fields : Array InductiveField) : Array String :=
  fields.mapIdx fun index field => recordFieldJson field.name #[index] field.type

private partial def variantCaseJson
    (kind : String) (fields : Array (String × InterfaceType)) : String :=
  match fields.toList with
  | [] => jsonObject #[
      ("kind", jsonString kind),
      ("payload", jsonString "none")
    ]
  | [(_, valueType)] => jsonObject #[
      ("kind", jsonString kind),
      ("payload", jsonString "value"),
      ("value", valueInterfaceJson valueType)
    ]
  | _ =>
      let encodedFields := fields.mapIdx fun index field =>
        recordFieldJson field.1 #[index] field.2
      jsonObject #[
        ("kind", jsonString kind),
        ("payload", jsonString "fields"),
        ("fields", jsonArray encodedFields)
      ]

private partial def inductiveVariantValueJson
    (name : Name) (constructors : Array InductiveConstructor) : String :=
  let cases := constructors.map fun constructor =>
    let fields := constructor.fields.map fun field => (field.name, field.type)
    variantCaseJson (constructorLabel name constructor.constructorName) fields
  jsonObject #[
    ("tag", jsonString "variant"),
    ("cases", jsonArray cases)
  ]

private partial def inheritedRecordFieldsJson
    (fields : Array StructureField) (pathPrefix : Array Nat := #[]) : Array String := Id.run do
  let mut result : Array String := #[]
  for h : index in *...fields.size do
    let field := fields[index]
    let path := pathPrefix.push index
    if field.isSubobject then
      match field.type with
      | .structure _ _ parent =>
          result := result ++ inheritedRecordFieldsJson parent.fields path
      | _ =>
          result := result.push (recordFieldJson field.name path field.type)
    else
      result := result.push (recordFieldJson field.name path field.type)
  return result

private partial def customInductiveValueJson
    (name : Name) (constructors : Array InductiveConstructor) : String :=
  if name == `List then
    let nilIndex := constructors.findIdx? fun constructor =>
      constructorLabel name constructor.constructorName == "nil" && constructor.fields.isEmpty
    let consIndex := constructors.findIdx? fun constructor =>
      constructorLabel name constructor.constructorName == "cons" && constructor.fields.size == 2
    match nilIndex, consIndex with
    | some nilIndex, some consIndex =>
        match constructors[consIndex]? with
        | none => inductiveVariantValueJson name constructors
        | some cons =>
            let headIndex := cons.fields.findIdx? (·.name == "head")
            let tailIndex := cons.fields.findIdx? (·.name == "tail")
            match headIndex, tailIndex with
            | some headIndex, some tailIndex =>
                match cons.fields[headIndex]? with
                | some head => jsonObject #[
                    ("tag", jsonString "sequence"),
                    ("element", valueInterfaceJson head.type),
                    ("chain", jsonObject #[
                      ("nil", jsonNat nilIndex),
                      ("cons", jsonNat consIndex),
                      ("head", jsonNat headIndex),
                      ("tail", jsonNat tailIndex)
                    ])
                  ]
                | none => inductiveVariantValueJson name constructors
            | _, _ => inductiveVariantValueJson name constructors
    | _, _ => inductiveVariantValueJson name constructors
  else if name == `Prod then
    match constructors.toList with
    | [constructor] => jsonObject #[
        ("tag", jsonString "record"),
        ("fields", jsonArray (inductiveRecordFieldsJson constructor.fields))
      ]
    | _ => inductiveVariantValueJson name constructors
  else
    inductiveVariantValueJson name constructors

private partial def valueInterfaceJson (type : InterfaceType) : String :=
  match type with
  | .unit => jsonObject #[("tag", jsonString "unit")]
  | .nat | .int | .uint64 => jsonObject #[("tag", jsonString "bigint")]
  | .uint8 | .uint16 | .uint32 | .usize | .float | .float32 =>
      jsonObject #[("tag", jsonString "number")]
  | .string => jsonObject #[("tag", jsonString "string")]
  | .byteArray => jsonObject #[("tag", jsonString "bytes")]
  | .bool => jsonObject #[
      ("tag", jsonString "boolean"),
      ("false", jsonNat 0),
      ("true", jsonNat 1)
    ]
  | .array element => jsonObject #[
      ("tag", jsonString "sequence"),
      ("element", valueInterfaceJson element)
    ]
  | .simpleEnum name constructors =>
      let cases := constructors.map fun constructor => jsonString (constructorLabel name constructor)
      jsonObject #[("tag", jsonString "enum"), ("cases", jsonArray cases)]
  | .recursiveRef .. => jsonObject #[("tag", jsonString "recursive")]
  | .customInductive name _ constructors => customInductiveValueJson name constructors
  | .structure _ _ descriptor => jsonObject #[
      ("tag", jsonString "record"),
      ("fields", jsonArray (inheritedRecordFieldsJson descriptor.fields))
    ]
  | .resource .. => jsonObject #[("tag", jsonString "jsReference")]
  | .function args result _ =>
      jsonObject #[
        ("tag", jsonString "function"),
        ("args", jsonArray (args.map fun arg => valueInterfaceJson arg.type)),
        ("result", valueInterfaceJson result)
      ]
  | .expr => jsonObject #[("tag", jsonString "expr")]
  | .leanObject => jsonObject #[("tag", jsonString "leanReference")]

partial def InterfaceType.toJson (ty : InterfaceType) : String :=
  jsonObject #[
    ("native", descriptorRefJson ty),
    ("value", valueInterfaceJson ty)
  ]

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
