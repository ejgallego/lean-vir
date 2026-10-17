/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Std.Data.TreeMap
public import Vir.Js
public import Vir.Package.JsonSafeWriter
public meta import Vir.Attributes
meta import Vir.Compiler.Interface.JsonSafeWriter
meta import Vir.Compiler.Interface.LibraryAdapters
public section
open Lean.Vir
namespace JsonSafeWriterValues

abbrev Store := Std.TreeMap Nat String compare
def decodeStore (entries : Array (Nat × String)) : Except String Store :=
  .ok (Std.TreeMap.ofArray entries)
abbrev StoreEncoder := Store → Array (Nat × String)
def encodeStore : StoreEncoder := fun store => store.toArray
run_meta do
  let .forallE _ wire outcome _ := (← Lean.getConstInfo ``decodeStore).type
    | Lean.throwError "unexpected helper type"
  let #[_, source] := outcome.getAppArgs | Lean.throwError "unexpected helper result"
  (Vir.Interface.registerClosedLibraryAdapter source wire ``decodeStore ``encodeStore).run'

inductive Tree where
  | leaf (value : Nat)
  | branch (children : List (Option Tree))
  | fork (left right : Tree)
  deriving BEq

structure Hidden where
  private mk ::
  private value : Nat

-- The first binder's synthetic arg1 name must not capture the real arg1 field.
structure FieldNames where
  foo_bar : Nat
  arg1 : Nat

run_elab Vir.Interface.JsonSafeWriter.generate `JsonSafeWriterValues.encodeFieldNames (Lean.mkConst ``FieldNames)
#guard encodeFieldNames ⟨9, 17⟩ == "{\"foo_bar\":\"9\",\"arg1\":\"17\"}"
#guard encodeFieldNames ⟨9, 99⟩ == "{\"foo_bar\":\"9\",\"arg1\":\"99\"}"

structure ConstantField (β : Nat → Type) where
  key : Nat
  value : β key
inductive ConstantCtor (β : Nat → Type) where
  | mk (key : Nat) (value : β key)
abbrev ClosedRecord := ConstantField (fun _ => String)
abbrev ClosedCtor := ConstantCtor (fun _ => String)
run_elab Vir.Interface.JsonSafeWriter.generate `JsonSafeWriterValues.encodeClosedRecord (Lean.mkConst ``ClosedRecord)
run_elab Vir.Interface.JsonSafeWriter.generate `JsonSafeWriterValues.encodeClosedCtor (Lean.mkConst ``ClosedCtor)
#guard encodeClosedRecord ⟨3, "record"⟩ == "{\"key\":\"3\",\"value\":\"record\"}"
#guard encodeClosedCtor (.mk 4 "ctor") == "{\"kind\":\"mk\",\"fields\":{\"key\":\"4\",\"value\":\"ctor\"}}"

structure Numbers where
  natural : Nat
  integer : Int
  large : UInt64
  small8 : UInt8
  small16 : UInt16
  small32 : UInt32

section
local instance : ToString Nat := ⟨fun _ => "custom Nat"⟩
local instance : ToString Int := ⟨fun _ => "custom Int"⟩
local instance : ToString UInt64 := ⟨fun _ => "custom UInt64"⟩
run_elab Vir.Interface.JsonSafeWriter.generate `JsonSafeWriterValues.encodeNumbers (Lean.mkConst ``Numbers)
#guard encodeNumbers ⟨3, -4, 18446744073709551615, 255, 65535, 4294967295⟩ ==
  "{\"natural\":\"3\",\"integer\":\"-4\",\"large\":\"18446744073709551615\",\"small8\":255,\"small16\":65535,\"small32\":4294967295}"
end

structure Document where
  text : String
  natural : Nat
  integer : Int
  unsigned : UInt64
  bytes : ByteArray
  unit : Unit
  hidden : Hidden
  names : FieldNames
  letter : Char
  priority : Fin 100
  constantRecord : ClosedRecord
  constantCtor : ClosedCtor
  foo_bar : String
  tree : Tree
  store : Store

run_elab Vir.Interface.JsonSafeWriter.generate `JsonSafeWriterValues.encode (Lean.mkConst ``Document)

private def fixture : Document := {
  text := "λ\n🦀\"\\"
  natural := 900719925474099312345
  integer := -12345678901234567890123456789000
  unsigned := 18446744073709551615
  bytes := ⟨#[0, 127, 255]⟩
  unit := ()
  hidden := ⟨42⟩
  names := ⟨9, 17⟩
  letter := '🦀'
  priority := ⟨99, by decide⟩
  constantRecord := ⟨3, "record"⟩
  constantCtor := .mk 4 "ctor"
  foo_bar := "preserved"
  tree := .branch [none, some (.leaf 900719925474099312345), some (.fork (.leaf 7) (.branch []))]
  store := Std.TreeMap.ofArray #[(900719925474099312345, "first"), (1, "α"),
    (900719925474099312345, "last")]
}

@[vir_export] def fixtureText : String := encode fixture
@[vir_export] def numericText : String := encodeNumbers ⟨3, -4, 18446744073709551615, 255, 65535, 4294967295⟩
@[vir_export] def retain (value : Document) : RuntimeM (JSL Document) := LeanRef.toJSL value
@[vir_export] def retainedNatural (value : JSL Document) : RuntimeM Nat := do
  return (← LeanRef.fromJSL value).natural
@[vir_export] def write (value : Document) : String := encode value
@[vir_export] def agrees (value : Document) : Bool :=
  value.text == fixture.text && value.natural == fixture.natural &&
  value.integer == fixture.integer && value.unsigned == fixture.unsigned &&
  value.bytes.size == 3 && value.bytes[0]! == 0 &&
  value.bytes[1]! == 127 && value.bytes[2]! == 255 && value.foo_bar == fixture.foo_bar &&
  value.names.foo_bar == 9 && value.names.arg1 == 17 &&
  value.letter.toNat == 0x1f980 && value.priority.val == 99 &&
  value.constantRecord.key == 3 && value.constantRecord.value == "record" &&
  (match value.constantCtor with | .mk key text => key == 4 && text == "ctor") &&
  (match value.hidden with | ⟨n⟩ => n == 42) && value.tree == fixture.tree &&
  value.store.size == 2 && value.store.get? 900719925474099312345 == some "last"

-- Generation failures remain local and precise, before any output declaration.
run_elab do
  let name := `JsonSafeWriterValues.unclosed
  let failed ← try
    Vir.Interface.JsonSafeWriter.generate name (Lean.mkBVar 0)
    pure false
  catch error =>
    unless ((← error.toMessageData.toString).splitOn "closed helper type").length > 1 do
      Lean.throwError "unexpected dependency diagnostic: {error.toMessageData}"
    pure true
  unless failed && !(← Lean.getEnv).contains name do
    Lean.throwError "unclosed type produced a writer"

run_elab do
  for (name, type) in #[(`JsonSafeWriterValues.unsupportedFloat, Lean.mkConst ``Float),
      (`JsonSafeWriterValues.unsupportedUSize, Lean.mkConst ``USize)] do
    let failed ← try
      Vir.Interface.JsonSafeWriter.generate name type
      pure false
    catch error =>
      let message ← error.toMessageData.toString
      unless (message.splitOn "unsupported JSON-safe writer domain").length > 1 do
        Lean.throwError "unexpected writer diagnostic: {message}"
      pure true
    unless failed && !(← Lean.getEnv).contains name do
      Lean.throwError "unsupported domain produced a writer"

end JsonSafeWriterValues
