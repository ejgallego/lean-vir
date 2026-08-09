/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Compiler.IR.CompilerM

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

structure NativeExternSpec where
  name : Name
  symbolOverride? : Option String := none
  generateBoxedWrapper : Bool := false
  deps : Array Name := #[]

structure NativeExtern extends NativeExternSpec where
  params : Array Param
  resultType : IRType
  symbol : String

def nativeIRTypeLabel : IRType → String
  | .float => "float"
  | .uint8 => "uint8"
  | .uint16 => "uint16"
  | .uint32 => "uint32"
  | .uint64 => "uint64"
  | .usize => "usize"
  | .erased => "erased"
  | .object => "object"
  | .tobject => "tobject"
  | .float32 => "float32"
  | .struct name _ => s!"struct:{name}"
  | .union name _ => s!"union:{name}"
  | .tagged => "tagged"
  | .void => "void"

def NativeExternSpec.resolve (env : Environment) (spec : NativeExternSpec) : Except String NativeExtern := do
  let some decl := findEnvDecl env spec.name |
    throw s!"{spec.name}: no Lean IR declaration found"
  let some symbol := spec.symbolOverride? <|> getExternNameFor env `c spec.name |
    throw s!"{spec.name}: no standard C extern symbol found and no VIR override was provided"
  return {
    toNativeExternSpec := spec
    params := decl.params
    resultType := decl.resultType
    symbol
  }

def privateEnvironmentName (part : String) : Name :=
  let root := .str (.str (.str .anonymous "_private") "Lean") "Environment"
  let pre := .str (.str (.num root 0) "Lean") "Environment"
  .str pre part

def nativeExternSpecs : Array NativeExternSpec := #[
  {
    name := `Nat.add,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.sub,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.ble,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.mul,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.div,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.mod,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.land,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.lor,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.pow,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.log2,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.shiftLeft,
    generateBoxedWrapper := true
  },
  {
    name := `Nat.shiftRight,
    generateBoxedWrapper := true
  },
  {
    name := `Int.ofNat,
    generateBoxedWrapper := true
  },
  {
    name := `Int.negSucc,
    generateBoxedWrapper := true
  },
  {
    name := `Int.add,
    generateBoxedWrapper := true
  },
  {
    name := `Int.sub,
    generateBoxedWrapper := true
  },
  {
    name := `Int.mul,
    generateBoxedWrapper := true
  },
  {
    name := `Int.ediv,
    generateBoxedWrapper := true
  },
  {
    name := `Int.tdiv,
    generateBoxedWrapper := true
  },
  {
    name := `Int.emod,
    generateBoxedWrapper := true
  },
  {
    name := `Int.tmod,
    generateBoxedWrapper := true
  },
  {
    name := `Int.neg,
    generateBoxedWrapper := true
  },
  {
    name := `Int.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `Int.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `Int.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `Int.natAbs,
    generateBoxedWrapper := true
  },
  {
    name := `System.Platform.getNumBits,
    generateBoxedWrapper := true
  },
  {
    name := `System.Platform.getIsWindows,
    generateBoxedWrapper := true
  },
  {
    name := `panicCore,
    generateBoxedWrapper := true
  },
  {
    name := `ptrAddrUnsafe,
    generateBoxedWrapper := true
  },
  {
    name := `IO.initializing,
    generateBoxedWrapper := true
  },
  {
    name := `ST.Prim.mkRef,
    generateBoxedWrapper := true
  },
  {
    name := `ST.Prim.Ref.get,
    generateBoxedWrapper := true
  },
  {
    name := `ST.Prim.Ref.set,
    generateBoxedWrapper := true
  },
  {
    name := `ST.Prim.Ref.take,
    generateBoxedWrapper := true
  },
  {
    name := privateEnvironmentName "isReservedName",
    generateBoxedWrapper := true,
    deps := #[`Lean.isReservedName]
  },
  {
    name := privateEnvironmentName "evalConstCore",
    generateBoxedWrapper := true
  },
  {
    name := privateEnvironmentName "evalCheckMeta",
    generateBoxedWrapper := true
  },
  {
    name := `Task.pure,
    generateBoxedWrapper := true
  },
  {
    name := `Task.get,
    generateBoxedWrapper := true
  },
  {
    name := `Task.map,
    generateBoxedWrapper := true
  },
  {
    name := `Array.mkEmpty,
    symbolOverride? := some "lean_array_mk_empty",
    generateBoxedWrapper := true
  },
  {
    name := `Array.emptyWithCapacity,
    symbolOverride? := some "lean_array_mk_empty",
    generateBoxedWrapper := true
  },
  {
    name := `Array.mk,
    generateBoxedWrapper := true
  },
  {
    name := `Array.push,
    generateBoxedWrapper := true
  },
  {
    name := `Array.toList,
    generateBoxedWrapper := true
  },
  {
    name := `Array.size,
    generateBoxedWrapper := true
  },
  {
    name := `Array.usize,
    generateBoxedWrapper := true
  },
  {
    name := `Array.uget,
    generateBoxedWrapper := true
  },
  {
    name := `Array.ugetBorrowed,
  },
  {
    name := `Array.getInternal,
    generateBoxedWrapper := true
  },
  {
    name := `Array.getInternalBorrowed,
  },
  {
    name := `Array.get!Internal,
    generateBoxedWrapper := true
  },
  {
    name := `Array.get!InternalBorrowed,
  },
  {
    name := `Array.uset,
    generateBoxedWrapper := true
  },
  {
    name := `Array.set,
    generateBoxedWrapper := true
  },
  {
    name := `Array.set!,
    generateBoxedWrapper := true
  },
  {
    name := `Array.pop,
    generateBoxedWrapper := true
  },
  {
    name := `Array.replicate,
    generateBoxedWrapper := true
  },
  {
    name := `Array.swapIfInBounds,
    generateBoxedWrapper := true
  },
  {
    name := `Array.swap,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.mk,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.empty,
    symbolOverride? := some "l_ByteArray_empty"
  },
  {
    name := `ByteArray.push,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.get!,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.get,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.set!,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.extract,
    symbolOverride? := some "l_ByteArray_extract",
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.size,
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.validateUTF8,
    generateBoxedWrapper := true
  },
  {
    name := `Bool.toUInt64,
    generateBoxedWrapper := true
  },
  {
    name := `Void.mk,
    generateBoxedWrapper := true
  },
  {
    name := `USize.ofNat,
    generateBoxedWrapper := true
  },
  {
    name := `USize.ofNatLT,
    symbolOverride? := some "l_USize_ofNatLT",
    generateBoxedWrapper := true
  },
  {
    name := `USize.add,
    generateBoxedWrapper := true
  },
  {
    name := `USize.sub,
    generateBoxedWrapper := true
  },
  {
    name := `USize.mul,
    generateBoxedWrapper := true
  },
  {
    name := `USize.land,
    generateBoxedWrapper := true
  },
  {
    name := `USize.shiftLeft,
    generateBoxedWrapper := true
  },
  {
    name := `USize.shiftRight,
    generateBoxedWrapper := true
  },
  {
    name := `USize.toNat,
    generateBoxedWrapper := true
  },
  {
    name := `USize.toUInt64,
    generateBoxedWrapper := true
  },
  {
    name := `USize.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `USize.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `USize.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `USize.repr,
    generateBoxedWrapper := true
  },
  {
    name := `String.append,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.append,
    generateBoxedWrapper := true
  },
  {
    name := `String.ofList,
    generateBoxedWrapper := true
  },
  {
    name := `String.toUTF8,
    generateBoxedWrapper := true
  },
  {
    name := `String.ofByteArray,
    generateBoxedWrapper := true
  },
  {
    name := `String.hash,
    generateBoxedWrapper := true
  },
  {
    name := `String.push,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.pushn,
    generateBoxedWrapper := true
  },
  {
    name := `String.length,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.length,
    generateBoxedWrapper := true
  },
  {
    name := `String.utf8ByteSize,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.isEmpty,
    generateBoxedWrapper := true
  },
  {
    name := `String.getUTF8Byte,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.set,
    symbolOverride? := some "l_String_Pos_set",
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.set,
    symbolOverride? := some "l_String_Pos_Raw_set",
    generateBoxedWrapper := true
  },
  {
    name := `String.set,
    symbolOverride? := some "l_String_set",
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.next,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.posOf,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.offsetOfPos,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.next,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.next,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.next',
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.extract,
    generateBoxedWrapper := true
  },
  {
    name := `String.extract,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.extract,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.prev,
    generateBoxedWrapper := true
  },
  {
    name := `String.decodeChar,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.get,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.get',
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.atEnd,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.atEnd,
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.isValid,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.get,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.trim,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.foldl,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.isPrefixOf,
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.contains,
    generateBoxedWrapper := true
  },
  {
    name := `String.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `String.decidableLT,
    generateBoxedWrapper := true
  },
  {
    name := `String.compare,
    generateBoxedWrapper := true
  },
  {
    name := `String.Slice.Pattern.Internal.memcmpStr,
    generateBoxedWrapper := true
  },
  {
    name := `Substring.Raw.Internal.beq,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Name.beq,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.toNat,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.toUInt32,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.add,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.sub,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.mul,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.div,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.mod,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.land,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.lor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.xor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.shiftLeft,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.shiftRight,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.complement,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.neg,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `UInt8.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.toNat,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.toUInt32,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.add,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.sub,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.mul,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.div,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.mod,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.land,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.lor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.xor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.shiftLeft,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.shiftRight,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.complement,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.neg,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `UInt16.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.ofNat,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.ofNatLT,
    symbolOverride? := some "l_UInt32_ofNatLT",
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.toNat,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.toUInt8,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.toUInt16,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.toUInt64,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.add,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.sub,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.mul,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.div,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.mod,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.land,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.lor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.xor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.shiftLeft,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.shiftRight,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.complement,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.neg,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `UInt32.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.ofNat,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.ofBitVec,
    generateBoxedWrapper := true
  },
  {
    name := `mixHash,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.ofNatLT,
    symbolOverride? := some "l_UInt64_ofNatLT",
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.toNat,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.toUSize,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.toUInt32,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.toUInt8,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.add,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.sub,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.mul,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.div,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.mod,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.land,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.lor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.xor,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.shiftLeft,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.shiftRight,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.complement,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.neg,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.decEq,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.decLt,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `UInt64.toFloat,
    generateBoxedWrapper := true
  },
  {
    name := `Float.sub,
    generateBoxedWrapper := true
  },
  {
    name := `Float.mul,
    generateBoxedWrapper := true
  },
  {
    name := `Float.div,
    generateBoxedWrapper := true
  },
  {
    name := `Float.neg,
    generateBoxedWrapper := true
  },
  {
    name := `Float.decLe,
    generateBoxedWrapper := true
  },
  {
    name := `Float.round,
    generateBoxedWrapper := true
  },
  {
    name := `Float.toUInt64,
    generateBoxedWrapper := true
  },
  {
    name := `Float.ofModel,
    generateBoxedWrapper := true
  },
  {
    name := `Float.ofBits,
    generateBoxedWrapper := true
  },
  {
    name := `Float.scaleB,
    generateBoxedWrapper := true
  },
  {
    name := `Float.toUInt32,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Level.beq,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Level.mkData,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.mkData,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.mkAppData,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.data,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.eqv,
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.equal,
    generateBoxedWrapper := true
  }
]

def resolveNativeExterns (env : Environment) : Except String (Array NativeExtern) :=
  nativeExternSpecs.mapM (·.resolve env)

def nativeExternSpec? (n : Name) : Option NativeExternSpec :=
  nativeExternSpecs.find? fun spec => spec.name == n

def isUnsupportedInitGlobal : Decl -> Bool
  | .fdecl _ params _ .unreachable _ => params.isEmpty
  | _ => false

def primitiveNamespaces : List String :=
  [
    "Array", "Bool", "ByteArray", "Char", "Float", "Float32", "IO", "Int", "Lean",
    "Nat", "Ptr", "ST", "String", "UInt8", "UInt16", "UInt32", "UInt64",
    "USize"
  ]

partial def nameHead? : Name -> Option String
  | .anonymous => none
  | .str .anonymous part => some part
  | .str pre _ => nameHead? pre
  | .num pre _ => nameHead? pre

def isNativeExternCandidate (n : Name) : Bool :=
  match nameHead? n with
  | some head => primitiveNamespaces.contains head
  | none => false

end Vir.GeneratePackage
