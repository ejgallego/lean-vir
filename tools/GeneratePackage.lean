/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Lean.Elab.Frontend
import Lean.Compiler.IR.CompilerM
import Lean.Compiler.InitAttr
import Lean.Compiler.LCNF.Main
import Lean.Compiler.LCNF.ToImpureType

open Lean

namespace Vir.GeneratePackage

open Lean.IR

inductive StructureFieldLayout where
  | object (index : Nat)
  | usize (index : Nat)
  | scalar (size offset : Nat)
  deriving BEq, Repr

abbrev StructureSeen := Array (Name × String)

structure Target where
  source : System.FilePath
  roots : Array Name
  includeAll : Bool := false
  packageOnly : Bool := false

structure LoadedDecl where
  source : String
  decl : Decl

structure DeclIndex where
  localDecls : NameMap LoadedDecl := {}
  envs : Array (String × Environment) := #[]
  sourceDecls : Array (String × Array Name) := #[]

structure NativeExtern where
  name : Name
  params : Array Param
  resultType : IRType
  symbol : String
  deps : Array Name := #[]

structure InitGlobal where
  name : Name
  initName : Name

structure Closure where
  seen : NameSet := {}
  initGlobalSeen : NameSet := {}
  decls : Array LoadedDecl := #[]
  externs : Array NativeExtern := #[]
  initGlobals : Array InitGlobal := #[]
  missingDecls : Array Name := #[]
  missingExterns : Array Name := #[]
  unsupportedInitGlobals : Array Name := #[]

inductive InterfaceType where
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
  | structure (name : Name) (label : String) (trivialField? : Option Nat)
      (objectFields usizeFields scalarBytes : Nat)
      (fields : Array (String × InterfaceType × StructureFieldLayout × Bool))
  | expr
  deriving BEq, Repr

structure InterfaceArg where
  name : String
  type : InterfaceType

structure InterfaceExport where
  id : String
  jsName : String
  entry : Name
  source : String
  args : Array InterfaceArg
  result : InterfaceType

structure InterfaceDiagnostic where
  name : Name
  source : String
  reason : String

structure PackageTargetMetadata where
  source : String
  mode : String
  roots : Array Name
  resolvedRoots : Array Name
  packageOnly : Bool

structure PackageMetadata where
  generator : String
  packageFormatVersion : Nat
  manifestVersion : Nat
  leanVersion : String
  leanToolchain : String
  leanGithash : String
  generatedAt : String
  targets : Array PackageTargetMetadata

structure InterfaceManifest where
  metadata : PackageMetadata
  exports : Array InterfaceExport := #[]
  diagnostics : Array InterfaceDiagnostic := #[]

def defaultTargets : Array Target := #[
  {
    source := "examples/Fib.lean",
    roots := #[`fib]
  },
  {
    source := "examples/Tamagotchi.lean",
    roots := #[
      `Tamagotchi.step
    ]
  },
  {
    source := "examples/Tamagotchi.lean",
    roots := #[
      `Tamagotchi.run,
      `Tamagotchi.trace,
      `Tamagotchi.demoScript
    ],
    packageOnly := true
  },
  {
    source := "examples/MergeSort.lean",
    roots := #[`SortDemo.demo, `SortDemo.demoFromArray]
  }
]

def param (idx : Nat) (borrow : Bool) (ty : IRType) : Param :=
  { x := { idx }, borrow, ty }

def privateEnvironmentName (part : String) : Name :=
  let root := .str (.str (.str .anonymous "_private") "Lean") "Environment"
  let pre := .str (.str (.num root 0) "Lean") "Environment"
  .str pre part

def nativeExterns : Array NativeExtern := #[
  {
    name := `Nat.add,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_add"
  },
  {
    name := `Nat.sub,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_sub"
  },
  {
    name := `Nat.decEq,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_eq"
  },
  {
    name := `Nat.decLe,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_le"
  },
  {
    name := `Nat.ble,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_le"
  },
  {
    name := `Nat.decLt,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_lt"
  },
  {
    name := `Nat.mul,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_mul"
  },
  {
    name := `Nat.div,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_div"
  },
  {
    name := `Nat.mod,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_mod"
  },
  {
    name := `Nat.pow,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_pow"
  },
  {
    name := `Nat.log2,
    params := #[param 1 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_log2"
  },
  {
    name := `Nat.shiftLeft,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_shiftl"
  },
  {
    name := `Nat.shiftRight,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_shiftr"
  },
  {
    name := `Int.ofNat,
    params := #[param 1 false .tobject],
    resultType := .tobject,
    symbol := "lean_nat_to_int"
  },
  {
    name := `Int.add,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_int_add"
  },
  {
    name := `Int.sub,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_int_sub"
  },
  {
    name := `Int.mul,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_int_mul"
  },
  {
    name := `Int.neg,
    params := #[param 1 true .tobject],
    resultType := .tobject,
    symbol := "lean_int_neg"
  },
  {
    name := `Int.decLt,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_int_dec_lt"
  },
  {
    name := `Int.natAbs,
    params := #[param 1 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_abs"
  },
  {
    name := `System.Platform.getNumBits,
    params := #[param 1 false .tagged],
    resultType := .tobject,
    symbol := "lean_system_platform_nbits"
  },
  {
    name := `panicCore,
    params := #[param 1 false .erased, param 2 true .tobject, param 3 false .object],
    resultType := .tobject,
    symbol := "lean_panic_fn_borrowed"
  },
  {
    name := `ptrAddrUnsafe,
    params := #[param 1 false .erased, param 2 true .tobject],
    resultType := .usize,
    symbol := "lean_ptr_addr"
  },
  {
    name := `IO.initializing,
    params := #[param 1 false .void],
    resultType := .uint8,
    symbol := "lean_io_initializing"
  },
  {
    name := `ST.Prim.mkRef,
    params := #[
      param 1 false .erased,
      param 2 false .erased,
      param 3 false .tobject,
      param 4 false .void
    ],
    resultType := .tobject,
    symbol := "lean_st_mk_ref"
  },
  {
    name := `ST.Prim.Ref.get,
    params := #[
      param 1 false .erased,
      param 2 false .erased,
      param 3 true .tobject,
      param 4 false .void
    ],
    resultType := .tobject,
    symbol := "lean_st_ref_get"
  },
  {
    name := `ST.Prim.Ref.set,
    params := #[
      param 1 false .erased,
      param 2 false .erased,
      param 3 true .tobject,
      param 4 false .tobject,
      param 5 false .void
    ],
    resultType := .tobject,
    symbol := "lean_st_ref_set"
  },
  {
    name := `ST.Prim.Ref.take,
    params := #[
      param 1 false .erased,
      param 2 false .erased,
      param 3 true .tobject,
      param 4 false .void
    ],
    resultType := .tobject,
    symbol := "lean_st_ref_take"
  },
  {
    name := privateEnvironmentName "isReservedName",
    params := #[param 1 false .object, param 2 false .tobject],
    resultType := .uint8,
    symbol := "lean_is_reserved_name",
    deps := #[`Lean.isReservedName]
  },
  {
    name := privateEnvironmentName "evalConstCore",
    params := #[
      param 1 false .erased,
      param 2 true .object,
      param 3 true .object,
      param 4 true .tobject
    ],
    resultType := .object,
    symbol := "lean_eval_const"
  },
  {
    name := privateEnvironmentName "evalCheckMeta",
    params := #[param 1 false .object, param 2 false .tobject],
    resultType := .object,
    symbol := "lean_eval_check_meta"
  },
  {
    name := `Task.pure,
    params := #[param 1 false .erased, param 2 false .tobject],
    resultType := .object,
    symbol := "lean_task_pure"
  },
  {
    name := `Task.get,
    params := #[param 1 false .erased, param 2 false .object],
    resultType := .tobject,
    symbol := "lean_task_get_own"
  },
  {
    name := `Task.map,
    params := #[
      param 1 false .erased,
      param 2 false .erased,
      param 3 false .tobject,
      param 4 false .object,
      param 5 false .tobject,
      param 6 false .uint8
    ],
    resultType := .object,
    symbol := "lean_task_map"
  },
  {
    name := `Array.mkEmpty,
    params := #[param 1 false .erased, param 2 false .tagged],
    resultType := .object,
    symbol := "lean_array_mk_empty"
  },
  {
    name := `Array.emptyWithCapacity,
    params := #[param 1 false .erased, param 2 true .tobject],
    resultType := .object,
    symbol := "lean_array_mk_empty"
  },
  {
    name := `Array.mk,
    params := #[param 1 false .erased, param 2 false .tobject],
    resultType := .object,
    symbol := "lean_array_mk"
  },
  {
    name := `Array.push,
    params := #[param 1 false .erased, param 2 false .object, param 3 false .tobject],
    resultType := .object,
    symbol := "lean_array_push"
  },
  {
    name := `Array.toList,
    params := #[param 1 false .erased, param 2 false .object],
    resultType := .tobject,
    symbol := "lean_array_to_list"
  },
  {
    name := `Array.size,
    params := #[param 1 false .erased, param 2 true .object],
    resultType := .tagged,
    symbol := "lean_array_get_size"
  },
  {
    name := `Array.usize,
    params := #[param 1 false .erased, param 2 true .object],
    resultType := .usize,
    symbol := "lean_array_size"
  },
  {
    name := `Array.uget,
    params := #[param 1 false .erased, param 2 true .object, param 3 false .usize, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_uget"
  },
  {
    name := `Array.ugetBorrowed,
    params := #[param 1 false .erased, param 2 true .object, param 3 false .usize, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_uget_borrowed"
  },
  {
    name := `Array.getInternal,
    params := #[param 1 false .erased, param 2 true .object, param 3 true .tobject, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_fget"
  },
  {
    name := `Array.getInternalBorrowed,
    params := #[param 1 false .erased, param 2 true .object, param 3 true .tobject, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_fget_borrowed"
  },
  {
    name := `Array.get!Internal,
    params := #[param 1 false .erased, param 2 true .tobject, param 3 true .object, param 4 true .tobject],
    resultType := .tobject,
    symbol := "lean_array_get"
  },
  {
    name := `Array.get!InternalBorrowed,
    params := #[param 1 false .erased, param 2 true .tobject, param 3 true .object, param 4 true .tobject],
    resultType := .tobject,
    symbol := "lean_array_get_borrowed"
  },
  {
    name := `Array.uset,
    params := #[param 1 false .erased, param 2 false .object, param 3 false .usize, param 4 false .tobject, param 5 false .erased],
    resultType := .object,
    symbol := "lean_array_uset"
  },
  {
    name := `Array.set,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 false .tobject, param 5 false .erased],
    resultType := .object,
    symbol := "lean_array_fset"
  },
  {
    name := `Array.set!,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 false .tobject],
    resultType := .object,
    symbol := "lean_array_set"
  },
  {
    name := `Array.pop,
    params := #[param 1 false .erased, param 2 false .object],
    resultType := .object,
    symbol := "lean_array_pop"
  },
  {
    name := `Array.replicate,
    params := #[param 1 false .erased, param 2 true .tobject, param 3 false .tobject],
    resultType := .object,
    symbol := "lean_mk_array"
  },
  {
    name := `Array.swapIfInBounds,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 true .tobject],
    resultType := .object,
    symbol := "lean_array_swap"
  },
  {
    name := `Array.swap,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 true .tobject, param 5 false .erased, param 6 false .erased],
    resultType := .object,
    symbol := "lean_array_fswap"
  },
  {
    name := `ByteArray.mk,
    params := #[param 1 false .object],
    resultType := .object,
    symbol := "lean_byte_array_mk"
  },
  {
    name := `ByteArray.empty,
    params := #[],
    resultType := .object,
    symbol := "l_ByteArray_empty"
  },
  {
    name := `ByteArray.push,
    params := #[param 1 false .object, param 2 false .uint8],
    resultType := .object,
    symbol := "lean_byte_array_push"
  },
  {
    name := `ByteArray.get!,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_byte_array_get"
  },
  {
    name := `ByteArray.get,
    params := #[param 1 true .object, param 2 true .tobject, param 3 false .erased],
    resultType := .uint8,
    symbol := "lean_byte_array_fget"
  },
  {
    name := `ByteArray.set!,
    params := #[param 1 false .object, param 2 true .tobject, param 3 false .uint8],
    resultType := .object,
    symbol := "lean_byte_array_set"
  },
  {
    name := `ByteArray.extract,
    params := #[param 1 true .object, param 2 false .tobject, param 3 true .tobject],
    resultType := .object,
    symbol := "l_ByteArray_extract"
  },
  {
    name := `ByteArray.size,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_byte_array_size"
  },
  {
    name := `ByteArray.validateUTF8,
    params := #[param 1 true .object],
    resultType := .uint8,
    symbol := "lean_string_validate_utf8"
  },
  {
    name := `USize.ofNat,
    params := #[param 1 true .tobject],
    resultType := .usize,
    symbol := "lean_usize_of_nat"
  },
  {
    name := `USize.ofNatLT,
    params := #[param 1 true .tobject, param 2 false .erased],
    resultType := .usize,
    symbol := "l_USize_ofNatLT"
  },
  {
    name := `USize.add,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_add"
  },
  {
    name := `USize.sub,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_sub"
  },
  {
    name := `USize.mul,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_mul"
  },
  {
    name := `USize.land,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_land"
  },
  {
    name := `USize.shiftLeft,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_shift_left"
  },
  {
    name := `USize.shiftRight,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_shift_right"
  },
  {
    name := `USize.toNat,
    params := #[param 1 false .usize],
    resultType := .tobject,
    symbol := "lean_usize_to_nat"
  },
  {
    name := `USize.decEq,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .uint8,
    symbol := "lean_usize_dec_eq"
  },
  {
    name := `USize.decLt,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .uint8,
    symbol := "lean_usize_dec_lt"
  },
  {
    name := `USize.decLe,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .uint8,
    symbol := "lean_usize_dec_le"
  },
  {
    name := `USize.repr,
    params := #[param 1 true .usize],
    resultType := .object,
    symbol := "lean_string_of_usize"
  },
  {
    name := `String.append,
    params := #[param 1 false .object, param 2 true .object],
    resultType := .object,
    symbol := "lean_string_append"
  },
  {
    name := `String.Internal.append,
    params := #[param 1 false .object, param 2 true .object],
    resultType := .object,
    symbol := "lean_string_append"
  },
  {
    name := `String.ofList,
    params := #[param 1 false .tobject],
    resultType := .object,
    symbol := "lean_string_mk"
  },
  {
    name := `String.toUTF8,
    params := #[param 1 true .object],
    resultType := .object,
    symbol := "lean_string_to_utf8"
  },
  {
    name := `String.ofByteArray,
    params := #[param 1 false .object, param 2 false .erased],
    resultType := .object,
    symbol := "lean_string_from_utf8_unchecked"
  },
  {
    name := `String.hash,
    params := #[param 1 true .object],
    resultType := .uint64,
    symbol := "lean_string_hash"
  },
  {
    name := `String.push,
    params := #[param 1 false .object, param 2 false .uint32],
    resultType := .object,
    symbol := "lean_string_push"
  },
  {
    name := `String.length,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_string_length"
  },
  {
    name := `String.utf8ByteSize,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_string_utf8_byte_size"
  },
  {
    name := `String.getUTF8Byte,
    params := #[param 1 true .object, param 2 false .tobject, param 3 false .erased],
    resultType := .uint8,
    symbol := "lean_string_get_byte_fast"
  },
  {
    name := `String.Pos.set,
    params := #[param 1 false .object, param 2 false .tobject, param 3 false .uint32, param 4 false .erased],
    resultType := .object,
    symbol := "l_String_Pos_set"
  },
  {
    name := `String.Pos.Raw.set,
    params := #[param 1 false .object, param 2 true .tobject, param 3 false .uint32],
    resultType := .object,
    symbol := "l_String_Pos_Raw_set"
  },
  {
    name := `String.set,
    params := #[param 1 false .object, param 2 true .tobject, param 3 false .uint32],
    resultType := .object,
    symbol := "l_String_set"
  },
  {
    name := `String.Internal.next,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_string_utf8_next"
  },
  {
    name := `String.Pos.Raw.next,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_string_utf8_next"
  },
  {
    name := `String.Pos.next,
    params := #[param 1 true .object, param 2 true .tobject, param 3 false .erased],
    resultType := .tagged,
    symbol := "lean_string_utf8_next_fast"
  },
  {
    name := `String.Pos.Raw.next',
    params := #[param 1 true .object, param 2 true .tobject, param 3 false .erased],
    resultType := .tagged,
    symbol := "lean_string_utf8_next_fast"
  },
  {
    name := `String.Internal.extract,
    params := #[param 1 true .object, param 2 true .tobject, param 3 true .tobject],
    resultType := .object,
    symbol := "lean_string_utf8_extract"
  },
  {
    name := `String.extract,
    params := #[param 1 true .object, param 2 true .tobject, param 3 true .tobject],
    resultType := .object,
    symbol := "lean_string_utf8_extract"
  },
  {
    name := `String.Pos.Raw.extract,
    params := #[param 1 true .object, param 2 true .tobject, param 3 true .tobject],
    resultType := .object,
    symbol := "lean_string_utf8_extract"
  },
  {
    name := `String.Pos.Raw.prev,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_string_utf8_prev"
  },
  {
    name := `String.decodeChar,
    params := #[param 1 true .object, param 2 true .tobject, param 3 false .erased],
    resultType := .uint32,
    symbol := "lean_string_utf8_get_fast"
  },
  {
    name := `String.Pos.Raw.get,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .uint32,
    symbol := "lean_string_utf8_get"
  },
  {
    name := `String.Pos.Raw.get',
    params := #[param 1 true .object, param 2 true .tobject, param 3 false .erased],
    resultType := .uint32,
    symbol := "lean_string_utf8_get_fast"
  },
  {
    name := `String.Internal.atEnd,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_string_utf8_at_end"
  },
  {
    name := `String.Pos.Raw.atEnd,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_string_utf8_at_end"
  },
  {
    name := `String.Pos.Raw.isValid,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_string_is_valid_pos"
  },
  {
    name := `String.Internal.contains,
    params := #[param 1 false .object, param 2 false .uint32],
    resultType := .uint8,
    symbol := "lean_string_contains"
  },
  {
    name := `String.decEq,
    params := #[param 1 true .object, param 2 true .object],
    resultType := .uint8,
    symbol := "lean_string_dec_eq"
  },
  {
    name := `String.decidableLT,
    params := #[param 1 true .object, param 2 true .object],
    resultType := .uint8,
    symbol := "lean_string_dec_lt"
  },
  {
    name := `String.Slice.Pattern.Internal.memcmpStr,
    params := #[param 1 true .object, param 2 true .object, param 3 true .tobject, param 4 true .tobject, param 5 true .tobject, param 6 false .erased, param 7 false .erased],
    resultType := .uint8,
    symbol := "lean_string_memcmp"
  },
  {
    name := `Substring.Raw.Internal.beq,
    params := #[param 1 false .object, param 2 false .object],
    resultType := .uint8,
    symbol := "lean_substring_beq"
  },
  {
    name := `Lean.Name.beq,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_name_eq"
  },
  {
    name := `UInt8.toNat,
    params := #[param 1 false .uint8],
    resultType := .tagged,
    symbol := "lean_uint8_to_nat"
  },
  {
    name := `UInt8.toUInt32,
    params := #[param 1 false .uint8],
    resultType := .uint32,
    symbol := "lean_uint8_to_uint32"
  },
  {
    name := `UInt8.add,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_add"
  },
  {
    name := `UInt8.sub,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_sub"
  },
  {
    name := `UInt8.mul,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_mul"
  },
  {
    name := `UInt8.div,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_div"
  },
  {
    name := `UInt8.mod,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_mod"
  },
  {
    name := `UInt8.land,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_land"
  },
  {
    name := `UInt8.lor,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_lor"
  },
  {
    name := `UInt8.xor,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_xor"
  },
  {
    name := `UInt8.shiftLeft,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_shift_left"
  },
  {
    name := `UInt8.shiftRight,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_shift_right"
  },
  {
    name := `UInt8.complement,
    params := #[param 1 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_complement"
  },
  {
    name := `UInt8.neg,
    params := #[param 1 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_neg"
  },
  {
    name := `UInt8.decEq,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_dec_eq"
  },
  {
    name := `UInt8.decLt,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_dec_lt"
  },
  {
    name := `UInt8.decLe,
    params := #[param 1 false .uint8, param 2 false .uint8],
    resultType := .uint8,
    symbol := "lean_uint8_dec_le"
  },
  {
    name := `UInt16.toNat,
    params := #[param 1 false .uint16],
    resultType := .tagged,
    symbol := "lean_uint16_to_nat"
  },
  {
    name := `UInt16.add,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_add"
  },
  {
    name := `UInt16.sub,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_sub"
  },
  {
    name := `UInt16.mul,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_mul"
  },
  {
    name := `UInt16.div,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_div"
  },
  {
    name := `UInt16.mod,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_mod"
  },
  {
    name := `UInt16.land,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_land"
  },
  {
    name := `UInt16.lor,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_lor"
  },
  {
    name := `UInt16.xor,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_xor"
  },
  {
    name := `UInt16.shiftLeft,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_shift_left"
  },
  {
    name := `UInt16.shiftRight,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_shift_right"
  },
  {
    name := `UInt16.complement,
    params := #[param 1 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_complement"
  },
  {
    name := `UInt16.neg,
    params := #[param 1 false .uint16],
    resultType := .uint16,
    symbol := "lean_uint16_neg"
  },
  {
    name := `UInt16.decEq,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint8,
    symbol := "lean_uint16_dec_eq"
  },
  {
    name := `UInt16.decLt,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint8,
    symbol := "lean_uint16_dec_lt"
  },
  {
    name := `UInt16.decLe,
    params := #[param 1 false .uint16, param 2 false .uint16],
    resultType := .uint8,
    symbol := "lean_uint16_dec_le"
  },
  {
    name := `UInt32.ofNat,
    params := #[param 1 true .tobject],
    resultType := .uint32,
    symbol := "lean_uint32_of_nat"
  },
  {
    name := `UInt32.ofNatLT,
    params := #[param 1 true .tobject, param 2 false .erased],
    resultType := .uint32,
    symbol := "l_UInt32_ofNatLT"
  },
  {
    name := `UInt32.toNat,
    params := #[param 1 false .uint32],
    resultType := .tobject,
    symbol := "lean_uint32_to_nat"
  },
  {
    name := `UInt32.toUInt8,
    params := #[param 1 false .uint32],
    resultType := .uint8,
    symbol := "lean_uint32_to_uint8"
  },
  {
    name := `UInt32.toUInt64,
    params := #[param 1 false .uint32],
    resultType := .uint64,
    symbol := "lean_uint32_to_uint64"
  },
  {
    name := `UInt32.add,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_add"
  },
  {
    name := `UInt32.sub,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_sub"
  },
  {
    name := `UInt32.mul,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_mul"
  },
  {
    name := `UInt32.div,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_div"
  },
  {
    name := `UInt32.mod,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_mod"
  },
  {
    name := `UInt32.land,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_land"
  },
  {
    name := `UInt32.lor,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_lor"
  },
  {
    name := `UInt32.xor,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_xor"
  },
  {
    name := `UInt32.shiftLeft,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_shift_left"
  },
  {
    name := `UInt32.shiftRight,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_shift_right"
  },
  {
    name := `UInt32.complement,
    params := #[param 1 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_complement"
  },
  {
    name := `UInt32.neg,
    params := #[param 1 false .uint32],
    resultType := .uint32,
    symbol := "lean_uint32_neg"
  },
  {
    name := `UInt32.decEq,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint8,
    symbol := "lean_uint32_dec_eq"
  },
  {
    name := `UInt32.decLt,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint8,
    symbol := "lean_uint32_dec_lt"
  },
  {
    name := `UInt32.decLe,
    params := #[param 1 false .uint32, param 2 false .uint32],
    resultType := .uint8,
    symbol := "lean_uint32_dec_le"
  },
  {
    name := `UInt64.ofNat,
    params := #[param 1 true .tobject],
    resultType := .uint64,
    symbol := "lean_uint64_of_nat"
  },
  {
    name := `mixHash,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_mix_hash"
  },
  {
    name := `UInt64.ofNatLT,
    params := #[param 1 true .tobject, param 2 false .erased],
    resultType := .uint64,
    symbol := "l_UInt64_ofNatLT"
  },
  {
    name := `UInt64.toNat,
    params := #[param 1 false .uint64],
    resultType := .tobject,
    symbol := "lean_uint64_to_nat"
  },
  {
    name := `UInt64.toUSize,
    params := #[param 1 false .uint64],
    resultType := .usize,
    symbol := "lean_uint64_to_usize"
  },
  {
    name := `UInt64.toUInt32,
    params := #[param 1 false .uint64],
    resultType := .uint32,
    symbol := "lean_uint64_to_uint32"
  },
  {
    name := `UInt64.toUInt8,
    params := #[param 1 false .uint64],
    resultType := .uint8,
    symbol := "lean_uint64_to_uint8"
  },
  {
    name := `UInt64.add,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_add"
  },
  {
    name := `UInt64.sub,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_sub"
  },
  {
    name := `UInt64.mul,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_mul"
  },
  {
    name := `UInt64.div,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_div"
  },
  {
    name := `UInt64.mod,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_mod"
  },
  {
    name := `UInt64.land,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_land"
  },
  {
    name := `UInt64.lor,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_lor"
  },
  {
    name := `UInt64.xor,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_xor"
  },
  {
    name := `UInt64.shiftLeft,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_shift_left"
  },
  {
    name := `UInt64.shiftRight,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_shift_right"
  },
  {
    name := `UInt64.complement,
    params := #[param 1 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_complement"
  },
  {
    name := `UInt64.neg,
    params := #[param 1 false .uint64],
    resultType := .uint64,
    symbol := "lean_uint64_neg"
  },
  {
    name := `UInt64.decEq,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint8,
    symbol := "lean_uint64_dec_eq"
  },
  {
    name := `UInt64.decLt,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint8,
    symbol := "lean_uint64_dec_lt"
  },
  {
    name := `UInt64.decLe,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint8,
    symbol := "lean_uint64_dec_le"
  },
  {
    name := `UInt64.toFloat,
    params := #[param 1 false .uint64],
    resultType := .float,
    symbol := "lean_uint64_to_float"
  },
  {
    name := `Float.scaleB,
    params := #[param 1 false .float, param 2 true .tobject],
    resultType := .float,
    symbol := "lean_float_scaleb"
  },
  {
    name := `Float.toUInt32,
    params := #[param 1 false .float],
    resultType := .uint32,
    symbol := "lean_float_to_uint32"
  },
  {
    name := `Lean.Level.mkData,
    params := #[param 1 false .uint64, param 2 false .tobject, param 3 false .uint8, param 4 false .uint8],
    resultType := .uint64,
    symbol := "lean_level_mk_data"
  },
  {
    name := `Lean.Expr.mkData,
    params := #[
      param 1 false .uint64,
      param 2 false .tobject,
      param 3 false .uint32,
      param 4 false .uint8,
      param 5 false .uint8,
      param 6 false .uint8,
      param 7 false .uint8
    ],
    resultType := .uint64,
    symbol := "lean_expr_mk_data"
  },
  {
    name := `Lean.Expr.mkAppData,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_expr_mk_app_data"
  },
  {
    name := `Lean.Expr.data,
    params := #[param 1 true .tobject],
    resultType := .uint64,
    symbol := "lean_expr_data"
  }
]

def nativeExtern? (n : Name) : Option NativeExtern :=
  nativeExterns.find? fun ext => ext.name == n

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

def sanitizeSource (input : String) : String :=
  "\n".intercalate <|
    input.splitOn "\n" |>.filter fun line =>
      !(line.trimAsciiStart.copy.startsWith "#eval")

def moduleNameFor (path : System.FilePath) : Name :=
  .str (.str `VirIRInput (path.fileStem.getD "Input")) "Generated"

unsafe def frontendEnv (target : Target) : IO Environment := do
  -- Match Lean's CLI startup path: the frontend imports modules with loaded extensions.
  enableInitializersExecution
  let contents <- IO.FS.readFile target.source
  let opts := Elab.async.set ({} : Options) false
  let fileName := target.source.toString
  match <- Elab.runFrontend (sanitizeSource contents) opts fileName (moduleNameFor target.source) with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed for {fileName}"

unsafe def loadDeclIndex (targets : Array Target) : IO DeclIndex := do
  initSearchPath (← getBuildDir)
  let mut index : DeclIndex := {}
  for target in targets do
    let env <- frontendEnv target
    let mut names : Array Name := #[]
    index := { index with envs := index.envs.push (target.source.toString, env) }
    for decl in getDecls env do
      names := names.push decl.name
      let loaded := { source := target.source.toString, decl }
      index := { index with localDecls := index.localDecls.insert decl.name loaded }
    index := { index with sourceDecls := index.sourceDecls.push (target.source.toString, names) }
  return index

def DeclIndex.find? (index : DeclIndex) (name : Name) : Option LoadedDecl :=
  match index.localDecls.find? name with
  | some decl => some decl
  | none =>
      index.envs.findSome? fun (source, env) => do
        let decl <- findEnvDecl env name
        match decl with
        | .fdecl .. => some { source := s!"imported by {source}", decl }
        | .extern .. => none

def DeclIndex.initFnNameFor? (index : DeclIndex) (name : Name) : Option Name :=
  index.envs.findSome? fun (_, env) => getInitFnNameFor? env name

def refsOfExpr (expr : IR.Expr) (refs : Array Name) : Array Name :=
  match expr with
  | .fap f _ => refs.push f
  | .pap f _ => refs.push f
  | _ => refs

partial def refsOfBody : FnBody -> Array Name -> Array Name
  | .vdecl _ _ expr cont, refs => refsOfBody cont (refsOfExpr expr refs)
  | .jdecl _ _ body cont, refs => refsOfBody cont (refsOfBody body refs)
  | .set _ _ _ cont, refs => refsOfBody cont refs
  | .setTag _ _ cont, refs => refsOfBody cont refs
  | .uset _ _ _ cont, refs => refsOfBody cont refs
  | .sset _ _ _ _ _ cont, refs => refsOfBody cont refs
  | .inc _ _ _ _ cont, refs => refsOfBody cont refs
  | .dec _ _ _ _ cont, refs => refsOfBody cont refs
  | .del _ cont, refs => refsOfBody cont refs
  | .case _ _ _ alts, refs =>
      alts.foldl (fun refs alt =>
        match alt with
        | .ctor _ body => refsOfBody body refs
        | .default body => refsOfBody body refs) refs
  | .ret _, refs => refs
  | .jmp _ _, refs => refs
  | .unreachable, refs => refs

def refsOfDecl : Decl -> Array Name
  | .fdecl (body := body) .. => refsOfBody body #[]
  | .extern .. => #[]

def addInitGlobal (name initName : Name) (state : Closure) : Closure :=
  if state.initGlobalSeen.contains name then
    state
  else
    { state with
      initGlobalSeen := state.initGlobalSeen.insert name
      initGlobals := state.initGlobals.push { name, initName } }

partial def collectName (index : DeclIndex) (name : Name) (state : Closure) : Closure :=
  if state.seen.contains name then
    state
  else
    let state := { state with seen := state.seen.insert name }
    match nativeExtern? name with
    | some ext =>
        let state := { state with externs := state.externs.push ext }
        ext.deps.foldl (fun state dep => collectName index dep state) state
    | none =>
        match index.find? name with
        | none =>
            if isNativeExternCandidate name then
              { state with missingExterns := state.missingExterns.push name }
            else
              { state with missingDecls := state.missingDecls.push name }
        | some loaded =>
            if isUnsupportedInitGlobal loaded.decl then
              match index.initFnNameFor? name with
              | some initName =>
                  let state := { state with decls := state.decls.push loaded }
                  let state := collectName index initName state
                  addInitGlobal name initName state
              | none =>
                  { state with
                    decls := state.decls.push loaded
                    unsupportedInitGlobals := state.unsupportedInitGlobals.push name }
            else
              let state := { state with decls := state.decls.push loaded }
              refsOfDecl loaded.decl |>.foldl (fun state dep => collectName index dep state) state

def boxedBaseName? : Name -> Option Name
  | .str pre "_boxed" => some pre
  | _ => none

def rootsForTarget (index : DeclIndex) (target : Target) : Array Name :=
  if target.includeAll then
    index.sourceDecls.findSome? (fun (source, names) =>
      if source == target.source.toString then
        some <| names.filter fun n => (boxedBaseName? n).isNone
      else
        none) |>.getD #[]
  else
    target.roots

def resolvedRootsForTarget (index : DeclIndex) (target : Target) : Array Name :=
  rootsForTarget index target |>.foldl (fun roots root =>
    if roots.contains root then roots else roots.push root) #[]

def collectClosure (targets : Array Target) (index : DeclIndex) : Closure :=
  targets.foldl (fun state target =>
    (resolvedRootsForTarget index target).foldl (fun state root => collectName index root state) state) {}

def DeclIndex.envForSource? (index : DeclIndex) (source : String) : Option Environment :=
  index.envs.findSome? fun (candidate, env) =>
    if candidate == source then some env else none

def InterfaceType.label : InterfaceType → String
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
  | .structure _ label .. => label
  | .expr => "Lean.Expr"

def InterfaceType.wireTag : InterfaceType → Nat
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
  | .structure .. => 20
  | .expr => 15

def jsonEscape (text : String) : String :=
  text.foldl (fun out c =>
    match c with
    | '"' => out ++ "\\\""
    | '\\' => out ++ "\\\\"
    | '\n' => out ++ "\\n"
    | '\r' => out ++ "\\r"
    | '\t' => out ++ "\\t"
    | _ => out.push c) ""

def jsonString (text : String) : String :=
  "\"" ++ jsonEscape text ++ "\""

def jsonArray (items : Array String) : String :=
  "[" ++ ",".intercalate items.toList ++ "]"

def jsonBool (value : Bool) : String :=
  if value then "true" else "false"

def ctorShortName (inductiveName ctorName : Name) : String :=
  let prefixText := inductiveName.toString ++ "."
  let text := ctorName.toString
  if text.startsWith prefixText then
    (text.drop prefixText.length).toString
  else
    text

def StructureFieldLayout.toJson : StructureFieldLayout → String
  | .object index =>
      "{"
      ++ "\"kind\":\"object\","
      ++ "\"index\":" ++ toString index
      ++ "}"
  | .usize index =>
      "{"
      ++ "\"kind\":\"usize\","
      ++ "\"index\":" ++ toString index
      ++ "}"
  | .scalar size offset =>
      "{"
      ++ "\"kind\":\"scalar\","
      ++ "\"size\":" ++ toString size ++ ","
      ++ "\"offset\":" ++ toString offset
      ++ "}"

partial def InterfaceType.toJson (ty : InterfaceType) : String :=
  match ty with
  | .array element =>
      "{"
      ++ "\"type\":" ++ jsonString ty.label ++ ","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"array\","
      ++ "\"element\":" ++ element.toJson
      ++ "}"
  | .list element =>
      "{"
      ++ "\"type\":" ++ jsonString ty.label ++ ","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"list\","
      ++ "\"element\":" ++ element.toJson
      ++ "}"
  | .option element =>
      "{"
      ++ "\"type\":" ++ jsonString ty.label ++ ","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"option\","
      ++ "\"element\":" ++ element.toJson
      ++ "}"
  | .prod fst snd =>
      "{"
      ++ "\"type\":" ++ jsonString ty.label ++ ","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"prod\","
      ++ "\"fst\":" ++ fst.toJson ++ ","
      ++ "\"snd\":" ++ snd.toJson
      ++ "}"
  | .simpleEnum name constructors =>
      let ctorJson := constructors.mapIdx fun idx ctor =>
        "{"
        ++ "\"name\":" ++ jsonString ctor.toString ++ ","
        ++ "\"jsName\":" ++ jsonString (ctorShortName name ctor) ++ ","
        ++ "\"tag\":" ++ toString idx
        ++ "}"
      "{"
      ++ "\"type\":\"" ++ jsonEscape ty.label ++ "\","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"simpleEnum\","
      ++ "\"constructors\":" ++ jsonArray ctorJson
      ++ "}"
  | .taggedUnion name _ constructors =>
      let ctorJson := constructors.mapIdx fun idx (ctorName, jsName, fieldType, fieldLayout, objectFields, usizeFields, scalarBytes) =>
        "{"
        ++ "\"name\":" ++ jsonString ctorName.toString ++ ","
        ++ "\"jsName\":" ++ jsonString jsName ++ ","
        ++ "\"tag\":" ++ toString idx ++ ","
        ++ "\"type\":" ++ fieldType.toJson ++ ","
        ++ "\"layout\":" ++ fieldLayout.toJson ++ ","
        ++ "\"objectFieldCount\":" ++ toString objectFields ++ ","
        ++ "\"usizeFieldCount\":" ++ toString usizeFields ++ ","
        ++ "\"scalarByteSize\":" ++ toString scalarBytes
        ++ "}"
      "{"
      ++ "\"type\":" ++ jsonString ty.label ++ ","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"taggedUnion\","
      ++ "\"name\":" ++ jsonString name.toString ++ ","
      ++ "\"constructors\":" ++ jsonArray ctorJson
      ++ "}"
  | .structure name _ trivialField? objectFields usizeFields scalarBytes fields =>
      let fieldJson := fields.map fun (fieldName, fieldType, fieldLayout, isSubobject) =>
        "{"
        ++ "\"name\":" ++ jsonString fieldName ++ ","
        ++ "\"type\":" ++ fieldType.toJson ++ ","
        ++ "\"layout\":" ++ fieldLayout.toJson
        ++ (if isSubobject then ",\"subobject\":true" else "")
        ++ "}"
      let trivialFieldJson :=
        match trivialField? with
        | some idx => "\"trivialFieldIndex\":" ++ toString idx ++ ","
        | none => ""
      "{"
      ++ "\"type\":" ++ jsonString ty.label ++ ","
      ++ "\"wireTag\":" ++ toString ty.wireTag ++ ","
      ++ "\"kind\":\"structure\","
      ++ "\"name\":" ++ jsonString name.toString ++ ","
      ++ "\"objectFieldCount\":" ++ toString objectFields ++ ","
      ++ "\"usizeFieldCount\":" ++ toString usizeFields ++ ","
      ++ "\"scalarByteSize\":" ++ toString scalarBytes ++ ","
      ++ trivialFieldJson
      ++ "\"fields\":" ++ jsonArray fieldJson
      ++ "}"
  | _ =>
      "{\"type\":\"" ++ ty.label ++ "\",\"wireTag\":" ++ toString ty.wireTag ++ "}"

partial def stripMData : Lean.Expr → Lean.Expr
  | .mdata _ e => stripMData e
  | e => e

def constName? (e : Lean.Expr) : Option Name :=
  match stripMData e with
  | .const n _ => some n
  | _ => none

def simpleInterfaceType? (e : Lean.Expr) : Option InterfaceType :=
  match constName? e with
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

def structureSeenContains (seen : StructureSeen) (name : Name) (key : String) : Bool :=
  seen.any fun (seenName, seenKey) => seenName == name && seenKey == key

mutual

partial def taggedUnionType (seenStructures : StructureSeen) (name : Name) (label : String)
    (constructors : Array (Name × String × Lean.Expr)) : CoreM (Except String InterfaceType) := do
  let mut variants := #[]
  for (ctorName, jsName, fieldExpr) in constructors do
    let layout ←
      try
        Lean.Compiler.LCNF.getCtorLayout ctorName
      catch _ =>
        return .error s!"could not compute runtime layout for constructor `{ctorName}`"
    if layout.fieldInfo.size != 1 then
      return .error s!"constructor `{ctorName}` must have exactly one runtime field"
    let some fieldLayout := structureFieldLayout? layout.fieldInfo[0]!
      | return .error s!"constructor `{ctorName}` has erased or void runtime layout"
    match ← interfaceType fieldExpr seenStructures with
    | .ok fieldType =>
        variants := variants.push (
          ctorName,
          jsName,
          fieldType,
          fieldLayout,
          layout.ctorInfo.size,
          layout.ctorInfo.usize,
          layout.ctorInfo.ssize)
    | .error reason =>
        return .error s!"constructor `{ctorName}` has unsupported payload type `{fieldExpr}`: {reason}"
  return .ok (.taggedUnion name label variants)

partial def structureType (seenStructures : StructureSeen) (e : Lean.Expr) : CoreM (Except String InterfaceType) := do
  let e := stripMData e
  let (name, args) := e.getAppFnArgs
  if name.isAnonymous then
    return .error s!"unsupported type `{e}`"
  let seenKey := toString e
  if structureSeenContains seenStructures name seenKey then
    return .error s!"recursive structure `{name}` is not supported"
  else
    let env ← getEnv
    let some (.inductInfo indInfo) := env.find? name
      | return .error s!"unsupported type `{e}`"
    let some structInfo := getStructureInfo? env name
      | return .error s!"unsupported type `{e}`"
    if indInfo.numIndices != 0 then
      return .error s!"indexed structure `{name}` is not supported"
    else if args.size != indInfo.numParams then
      return .error s!"structure `{name}` expects {indInfo.numParams} parameter(s), got {args.size}"
    else if indInfo.isRec then
      return .error s!"recursive structure `{name}` is not supported"
    else if indInfo.ctors.length != 1 then
      return .error s!"structure `{name}` must have exactly one constructor"
    else if structInfo.fieldNames.isEmpty then
      return .error s!"empty structure `{name}` is not supported"
    else
      let ctorName := indInfo.ctors.head!
      let layout ←
        try
          Lean.Compiler.LCNF.getCtorLayout ctorName
        catch _ =>
          return .error s!"could not compute runtime layout for structure `{name}`"
      let trivialField? :=
        (← Lean.Compiler.LCNF.hasTrivialImpureStructure? name).map (·.fieldIdx)
      if layout.fieldInfo.size != structInfo.fieldNames.size then
        return .error s!"runtime layout for structure `{name}` does not match its field count"
      let nextSeen := seenStructures.push (name, seenKey)
      let mut fields := #[]
      for h : idx in *...structInfo.fieldNames.size do
        let fieldName := structInfo.fieldNames[idx]
        let isSubobject := (isSubobjectField? env name fieldName).isSome
        let some fieldLayout := structureFieldLayout? layout.fieldInfo[idx]!
          | return .error s!"field `{fieldName}` of structure `{name}` has erased or void runtime layout"
        let some projName := structInfo.getProjFn? idx
          | return .error s!"field `{fieldName}` of structure `{name}` is missing a projection function"
        let some info := env.find? projName
          | return .error s!"field `{fieldName}` of structure `{name}` has no projection declaration"
        let some fieldExpr := projectionFieldType? indInfo.numParams args info.type
          | return .error s!"field `{fieldName}` of structure `{name}` has invalid projection type `{info.type}`"
        match ← interfaceType fieldExpr nextSeen with
        | .ok fieldType =>
            fields := fields.push (fieldName.toString, fieldType, fieldLayout, isSubobject)
        | .error reason =>
            return .error s!"field `{fieldName}` of structure `{name}` has unsupported type `{fieldExpr}`: {reason}"
      return .ok (.structure name (exprTypeLabel e) trivialField? layout.ctorInfo.size layout.ctorInfo.usize layout.ctorInfo.ssize fields)

partial def interfaceType (e : Lean.Expr) (seenStructures : StructureSeen := #[]) : CoreM (Except String InterfaceType) := do
  match simpleInterfaceType? e with
  | some ty => return .ok ty
  | none =>
      let e := stripMData e
      let (fn, args) := e.getAppFnArgs
      match fn, Array.toList args with
      | `Array, [arg] =>
          match ← interfaceType arg seenStructures with
          | .ok ty => return .ok (.array ty)
          | .error reason => return .error s!"unsupported Array element type: {reason}"
      | `List, [arg] =>
          match ← interfaceType arg seenStructures with
          | .ok ty => return .ok (.list ty)
          | .error reason => return .error s!"unsupported List element type: {reason}"
      | `Option, [arg] =>
          match ← interfaceType arg seenStructures with
          | .ok ty => return .ok (.option ty)
          | .error reason => return .error s!"unsupported Option element type: {reason}"
      | `Prod, [lhs, rhs] =>
          match ← interfaceType lhs seenStructures with
          | .error reason => return .error s!"unsupported Prod fst type: {reason}"
          | .ok lhsTy =>
              match ← interfaceType rhs seenStructures with
              | .error reason => return .error s!"unsupported Prod snd type: {reason}"
              | .ok rhsTy => return .ok (.prod lhsTy rhsTy)
      | `Sum, [lhs, rhs] =>
          taggedUnionType seenStructures `Sum (exprTypeLabel e) #[
            (`Sum.inl, "inl", lhs),
            (`Sum.inr, "inr", rhs)
          ]
      | `Except, [err, ok] =>
          taggedUnionType seenStructures `Except (exprTypeLabel e) #[
            (`Except.error, "error", err),
            (`Except.ok, "ok", ok)
          ]
      | _, _ =>
          let env ← getEnv
          match simpleEnumType? env e with
          | some ty => return .ok ty
          | none => structureType seenStructures e

end

def binderArgName (fallback : Nat) (name : Name) : String :=
  let candidate := name.toString
  if name.isAnonymous || candidate.startsWith "_" || candidate.contains '_' then
    s!"arg{fallback}"
  else
    candidate

partial def interfaceSignature? (type : Lean.Expr) (argIndex : Nat := 1) (args : Array InterfaceArg := #[]) :
    CoreM (Except String (Array InterfaceArg × InterfaceType)) := do
  match stripMData type with
  | .forallE name domain body binderInfo =>
      if binderInfo != .default then
        return .error s!"unsupported implicit/instance argument `{name}`"
      else
        match ← interfaceType domain with
        | .error reason => return .error s!"unsupported argument type `{domain}`: {reason}"
        | .ok argType =>
            let arg := { name := binderArgName argIndex name, type := argType }
            interfaceSignature? body (argIndex + 1) (args.push arg)
  | result =>
      match ← interfaceType result with
      | .error reason => return .error s!"unsupported result type `{result}`: {reason}"
      | .ok resultType => return .ok (args, resultType)

def isInterfaceDeclInfo : ConstantInfo → Bool
  | .defnInfo _ => true
  | .opaqueInfo _ => true
  | _ => false

def isGeneratedAuxName (n : Name) : Bool :=
  match boxedBaseName? n with
  | some _ => true
  | none =>
      let text := n.toString
      (text.splitOn "._").length > 1 ||
        text.endsWith ".elim" ||
        text.endsWith ".ctorElim" ||
        text.endsWith ".rec" ||
        text.endsWith ".casesOn" ||
        text.endsWith ".ctorIdx" ||
        text.endsWith ".toCtorIdx" ||
        text.endsWith ".noConfusion" ||
        text.endsWith ".noConfusionType"

def sourceDeclNamesFor (index : DeclIndex) (target : Target) : Array Name :=
  index.sourceDecls.findSome? (fun (source, names) =>
    if source == target.source.toString then some names else none) |>.getD #[]

def publicSourceDeclsFor (index : DeclIndex) (target : Target) : Array Name :=
  match index.envForSource? target.source.toString with
  | none => #[]
  | some env =>
      sourceDeclNamesFor index target |>.filter fun n =>
        !isPrivateName n &&
        !isGeneratedAuxName n &&
        match env.find? n with
        | some info => isInterfaceDeclInfo info
        | none => false

def exportCandidatesFor (index : DeclIndex) (target : Target) : Array Name :=
  if target.packageOnly then
    #[]
  else if target.includeAll then
    publicSourceDeclsFor index target
  else
    target.roots.foldl (fun acc root =>
      let n := (boxedBaseName? root).getD root
      if acc.contains n then acc else acc.push n) #[]

def sanitizeJsNameChar (c : Char) : Char :=
  if c.isAlphanum || c == '_' then c else '_'

def jsNameFor (n : Name) : String :=
  let text := n.toString
  let sanitized := text.map sanitizeJsNameChar
  if sanitized.isEmpty then "entry" else sanitized

def interfaceExportFor (_index : DeclIndex) (source : String) (name : Name) :
    CoreM (Except InterfaceDiagnostic InterfaceExport) := do
  if isPrivateName name then
    return .error { name, source, reason := "private declarations are not exported" }
  else
    let env ← getEnv
    match env.find? name with
    | none => return .error { name, source, reason := "missing elaborated Lean declaration" }
    | some info =>
        if !isInterfaceDeclInfo info then
          return .error { name, source, reason := "declaration is not a compiled definition" }
        else
          match ← interfaceSignature? info.type with
          | .ok (args, result) =>
              let jsName := jsNameFor name
              return .ok { id := jsName, jsName, entry := name, source, args, result }
          | .error reason =>
              return .error { name, source, reason }

def targetMetadataFor (index : DeclIndex) (target : Target) : PackageTargetMetadata :=
  let mode :=
    if target.packageOnly then "packageOnly"
    else if target.includeAll then "all"
    else "explicit"
  {
    source := target.source.toString
    mode := mode
    roots := target.roots
    resolvedRoots := resolvedRootsForTarget index target
    packageOnly := target.packageOnly
  }

def collectPackageMetadata (generatedAt : String) (targets : Array Target) (index : DeclIndex) : PackageMetadata :=
  {
    generator := "tools/GeneratePackage.lean"
    packageFormatVersion := 4
    manifestVersion := 1
    leanVersion := Lean.versionString
    leanToolchain := Lean.toolchain
    leanGithash := Lean.githash
    generatedAt := generatedAt
    targets := targets.map (targetMetadataFor index)
  }

def runCoreForSource (source : String) (env : Environment) (x : CoreM α) : IO α :=
  x.toIO'
    { fileName := source, fileMap := default }
    { env := env }

def collectInterfaceManifest (metadata : PackageMetadata) (targets : Array Target) (index : DeclIndex) : IO InterfaceManifest := do
  let mut manifest : InterfaceManifest := { metadata := metadata }
  for target in targets do
    let source := target.source.toString
    match index.envForSource? source with
    | none =>
        manifest := { manifest with diagnostics := manifest.diagnostics.push {
          name := .anonymous,
          source,
          reason := "source environment was not loaded"
        } }
    | some env =>
        for name in exportCandidatesFor index target do
          match ← runCoreForSource source env (interfaceExportFor index source name) with
          | .ok entry =>
              if !manifest.exports.any (fun existing => existing.entry == entry.entry) then
                manifest := { manifest with exports := manifest.exports.push entry }
          | .error diagnostic =>
              manifest := { manifest with diagnostics := manifest.diagnostics.push diagnostic }
  return manifest

def InterfaceArg.toJson (arg : InterfaceArg) : String :=
  "{"
  ++ "\"name\":" ++ jsonString arg.name ++ ","
  ++ "\"type\":" ++ arg.type.toJson
  ++ "}"

def InterfaceExport.toJson (entry : InterfaceExport) : String :=
  "{"
  ++ "\"id\":" ++ jsonString entry.id ++ ","
  ++ "\"jsName\":" ++ jsonString entry.jsName ++ ","
  ++ "\"entry\":" ++ jsonString entry.entry.toString ++ ","
  ++ "\"source\":" ++ jsonString entry.source ++ ","
  ++ "\"args\":" ++ jsonArray (entry.args.map InterfaceArg.toJson) ++ ","
  ++ "\"result\":" ++ entry.result.toJson
  ++ "}"

def InterfaceDiagnostic.toJson (diagnostic : InterfaceDiagnostic) : String :=
  "{"
  ++ "\"name\":" ++ jsonString diagnostic.name.toString ++ ","
  ++ "\"source\":" ++ jsonString diagnostic.source ++ ","
  ++ "\"reason\":" ++ jsonString diagnostic.reason
  ++ "}"

def PackageTargetMetadata.toJson (target : PackageTargetMetadata) : String :=
  "{"
  ++ "\"source\":" ++ jsonString target.source ++ ","
  ++ "\"mode\":" ++ jsonString target.mode ++ ","
  ++ "\"roots\":" ++ jsonArray (target.roots.map (fun n => jsonString n.toString)) ++ ","
  ++ "\"resolvedRoots\":" ++ jsonArray (target.resolvedRoots.map (fun n => jsonString n.toString)) ++ ","
  ++ "\"packageOnly\":" ++ jsonBool target.packageOnly
  ++ "}"

def PackageMetadata.toJson (metadata : PackageMetadata) : String :=
  "{"
  ++ "\"generator\":" ++ jsonString metadata.generator ++ ","
  ++ "\"packageFormatVersion\":" ++ toString metadata.packageFormatVersion ++ ","
  ++ "\"manifestVersion\":" ++ toString metadata.manifestVersion ++ ","
  ++ "\"leanVersion\":" ++ jsonString metadata.leanVersion ++ ","
  ++ "\"leanToolchain\":" ++ jsonString metadata.leanToolchain ++ ","
  ++ "\"leanGithash\":" ++ jsonString metadata.leanGithash ++ ","
  ++ "\"generatedAt\":" ++ jsonString metadata.generatedAt ++ ","
  ++ "\"targets\":" ++ jsonArray (metadata.targets.map PackageTargetMetadata.toJson)
  ++ "}"

def InterfaceManifest.toJson (manifest : InterfaceManifest) : String :=
  "{"
  ++ "\"version\":1,"
  ++ "\"artifact\":\"lean-vir-ir-package\","
  ++ "\"metadata\":" ++ manifest.metadata.toJson ++ ","
  ++ "\"exports\":" ++ jsonArray (manifest.exports.map InterfaceExport.toJson) ++ ","
  ++ "\"diagnostics\":" ++ jsonArray (manifest.diagnostics.map InterfaceDiagnostic.toJson)
  ++ "}"

abbrev EmitM := StateT ByteArray (Except String)

def maxU32 : Nat := 4294967295

def withEmitContext (context : String) (action : EmitM α) : EmitM α :=
  fun bytes =>
    match action.run bytes with
    | .ok result => .ok result
    | .error err => .error s!"{context}: {err}"

def emitU8 (value : Nat) : EmitM Unit :=
  modify fun bytes => bytes.push (UInt8.ofNat value)

def emitBool (value : Bool) : EmitM Unit :=
  emitU8 (if value then 1 else 0)

def emitU32 (value : Nat) : EmitM Unit := do
  if value > maxU32 then
    throw s!"package format stores this field as u32, but got {value}"
  emitU8 (value % 256)
  emitU8 ((value / 256) % 256)
  emitU8 ((value / 65536) % 256)
  emitU8 ((value / 16777216) % 256)

def emitBytes (chunk : ByteArray) : EmitM Unit :=
  modify fun bytes => bytes.append chunk

def emitString (value : String) : EmitM Unit := do
  let bytes := value.toUTF8
  emitU32 bytes.size
  emitBytes bytes

partial def emitName : Name -> EmitM Unit
  | .anonymous => emitU8 0
  | .str pre part => do
      emitU8 1
      emitName pre
      emitString part
  | .num pre idx => do
      emitU8 2
      emitName pre
      emitU32 idx

def emitType : IRType -> EmitM Unit
  | .float => emitU8 0
  | .uint8 => emitU8 1
  | .uint16 => emitU8 2
  | .uint32 => emitU8 3
  | .uint64 => emitU8 4
  | .usize => emitU8 5
  | .erased => emitU8 6
  | .object => emitU8 7
  | .tobject => emitU8 8
  | .float32 => emitU8 9
  | .struct .. => throw "unsupported IR type: struct values are not encoded by the demo package yet"
  | .union .. => throw "unsupported IR type: union values are not encoded by the demo package yet"
  | .tagged => emitU8 12
  | .void => emitU8 13

def emitArray (items : Array α) (emitItem : α -> EmitM Unit) : EmitM Unit := do
  emitU32 items.size
  items.forM emitItem

def emitArg : Arg -> EmitM Unit
  | .var id => emitU8 0 *> emitU32 id.idx
  | .erased => emitU8 1

def emitLit : LitVal -> EmitM Unit
  | .num value => emitU8 0 *> emitString (toString value)
  | .str value => emitU8 1 *> emitString value

def emitCtorInfo (info : CtorInfo) : EmitM Unit := do
  emitName info.name
  emitU32 info.cidx
  emitU32 info.size
  emitU32 info.usize
  emitU32 info.ssize

partial def emitExpr : IR.Expr -> EmitM Unit
  | .ctor info args => emitU8 0 *> emitCtorInfo info *> emitArray args emitArg
  | .reset n x => emitU8 1 *> emitU32 n *> emitU32 x.idx
  | .reuse x info updtHeader args => do
      emitU8 2; emitU32 x.idx; emitCtorInfo info; emitBool updtHeader; emitArray args emitArg
  | .proj i x => emitU8 3 *> emitU32 i *> emitU32 x.idx
  | .uproj i x => emitU8 4 *> emitU32 i *> emitU32 x.idx
  | .sproj i offset x => emitU8 5 *> emitU32 i *> emitU32 offset *> emitU32 x.idx
  | .fap f args => emitU8 6 *> emitName f *> emitArray args emitArg
  | .pap f args => emitU8 7 *> emitName f *> emitArray args emitArg
  | .ap x args => emitU8 8 *> emitU32 x.idx *> emitArray args emitArg
  | .box ty x => emitU8 9 *> emitType ty *> emitU32 x.idx
  | .unbox x => emitU8 10 *> emitU32 x.idx
  | .lit value => emitU8 11 *> emitLit value
  | .isShared x => emitU8 12 *> emitU32 x.idx

partial def emitAlt : Alt -> EmitM Unit
  | .ctor info body => emitU8 0 *> emitCtorInfo info *> emitBody body
  | .default body => emitU8 1 *> emitBody body
where
  emitParam (p : Param) : EmitM Unit := do
    emitU32 p.x.idx
    emitBool p.borrow
    emitType p.ty

  emitBody : FnBody -> EmitM Unit
    | .vdecl x ty expr cont => do
        emitU8 0; emitU32 x.idx; emitType ty; emitExpr expr; emitBody cont
    | .jdecl jp params body cont => do
        emitU8 1; emitU32 jp.idx; emitArray params emitParam; emitBody body; emitBody cont
    | .set x i arg cont => do
        emitU8 2; emitU32 x.idx; emitU32 i; emitArg arg; emitBody cont
    | .setTag x cidx cont => do
        emitU8 3; emitU32 x.idx; emitU32 cidx; emitBody cont
    | .uset x i y cont => do
        emitU8 4; emitU32 x.idx; emitU32 i; emitU32 y.idx; emitBody cont
    | .sset x i offset y ty cont => do
        emitU8 5; emitU32 x.idx; emitU32 i; emitU32 offset; emitU32 y.idx; emitType ty; emitBody cont
    | .inc x n maybeScalar persistent cont => do
        emitU8 6; emitU32 x.idx; emitU32 n; emitBool maybeScalar; emitBool persistent; emitBody cont
    | .dec x n maybeScalar persistent cont => do
        emitU8 7; emitU32 x.idx; emitU32 n; emitBool maybeScalar; emitBool persistent; emitBody cont
    | .del x cont => do
        emitU8 8; emitU32 x.idx; emitBody cont
    | .case tid x ty alts => do
        emitU8 9; emitName tid; emitU32 x.idx; emitType ty; emitArray alts emitAlt
    | .ret arg => emitU8 10 *> emitArg arg
    | .jmp jp args => emitU8 11 *> emitU32 jp.idx *> emitArray args emitArg
    | .unreachable => emitU8 12

def emitParam (p : Param) : EmitM Unit :=
  emitAlt.emitParam p

def emitBody (body : FnBody) : EmitM Unit :=
  emitAlt.emitBody body

def emitEntryHeader (name : Name) : EmitM Unit := do
  emitName name
  match boxedBaseName? name with
  | some base => emitBool true *> emitName base
  | none => emitBool false

def emitDeclEntry (loaded : LoadedDecl) : EmitM Unit := do
  withEmitContext s!"while encoding declaration `{loaded.decl.name}` from `{loaded.source}`" do
    emitEntryHeader loaded.decl.name
    match loaded.decl with
    | .fdecl _ params resultType body _ => do
        emitU8 0
        emitArray params emitParam
        emitType resultType
        emitBody body
    | .extern _ params resultType _ => do
        emitU8 1
        emitArray params emitParam
        emitType resultType

def emitExternEntry (ext : NativeExtern) : EmitM Unit := do
  withEmitContext s!"while encoding native extern `{ext.name}` mapped to `{ext.symbol}`" do
    emitEntryHeader ext.name
    emitU8 1
    emitArray ext.params emitParam
    emitType ext.resultType

def emitInitGlobal (entry : InitGlobal) : EmitM Unit := do
  withEmitContext s!"while encoding initializer global `{entry.name}`" do
    emitName entry.name
    emitName entry.initName

def emitPackageM (closure : Closure) (manifest : InterfaceManifest) : EmitM Unit := do
  emitString "lean-vir-ir-package"
  emitU32 4
  emitU32 (closure.decls.size + closure.externs.size)
  closure.decls.forM emitDeclEntry
  closure.externs.forM emitExternEntry
  emitArray closure.initGlobals emitInitGlobal
  emitString manifest.toJson

def emitPackage (closure : Closure) (manifest : InterfaceManifest) : Except String ByteArray := do
  let (_, bytes) <- (emitPackageM closure manifest).run ByteArray.empty
  return bytes

def reportFor (targets : Array Target) (closure : Closure) (manifest : InterfaceManifest) : String :=
  let roots :=
    targets.foldl (fun acc target =>
      if target.includeAll then
        let localRoots := closure.decls.foldl (fun roots loaded =>
          if loaded.source == target.source.toString then roots.push loaded.decl.name else roots) #[]
        acc ++ localRoots
      else
        acc ++ target.roots) #[]
  let loadedLines :=
    closure.decls.map fun loaded =>
      s!"- `{loaded.decl.name}` from `{loaded.source}`"
  let externLines :=
    closure.externs.map fun ext =>
      s!"- `{ext.name}` -> `{ext.symbol}`"
  let initGlobalLines :=
    if closure.initGlobals.isEmpty then #["None."] else closure.initGlobals.map fun entry =>
      s!"- `{entry.name}` <- `{entry.initName}`"
  let missingDeclLines :=
    if closure.missingDecls.isEmpty then #["None."] else closure.missingDecls.map fun n => s!"- `{n}`"
  let missingExternLines :=
    if closure.missingExterns.isEmpty then #["None."] else closure.missingExterns.map fun n => s!"- `{n}`"
  let unsupportedInitGlobalLines :=
    if closure.unsupportedInitGlobals.isEmpty then #["None."] else closure.unsupportedInitGlobals.map fun n => s!"- `{n}`"
  let interfaceExportLines :=
    if manifest.exports.isEmpty then #["None."] else manifest.exports.map fun entry =>
      let args := entry.args.map (fun arg => s!"{arg.name} : {arg.type.label}")
      s!"- `{entry.entry}` as `{entry.jsName}` : ({", ".intercalate args.toList}) -> {entry.result.label}"
  let interfaceDiagnosticLines :=
    if manifest.diagnostics.isEmpty then #["None."] else manifest.diagnostics.map fun diagnostic =>
      s!"- `{diagnostic.name}` from `{diagnostic.source}`: {diagnostic.reason}"
  "# Generated IR Package Report\n\n"
  ++ "Generated by `tools/GeneratePackage.lean` from typed `Lean.IR.Decl` values.\n\n"
  ++ s!"Package format: {manifest.metadata.packageFormatVersion}\n\n"
  ++ s!"Manifest version: {manifest.metadata.manifestVersion}\n\n"
  ++ s!"Lean toolchain: {manifest.metadata.leanToolchain}\n\n"
  ++ s!"Lean version: {manifest.metadata.leanVersion}\n\n"
  ++ s!"Lean git hash: {manifest.metadata.leanGithash}\n\n"
  ++ s!"Generated at: {manifest.metadata.generatedAt}\n\n"
  ++ s!"Loaded declarations: {closure.decls.size}\n\n"
  ++ s!"Native extern declarations: {closure.externs.size}\n\n"
  ++ s!"Initializer globals: {closure.initGlobals.size}\n\n"
  ++ s!"Interface exports: {manifest.exports.size}\n\n"
  ++ "## Roots\n\n"
  ++ "\n".intercalate (roots.map (fun n => s!"- `{n}`")).toList ++ "\n\n"
  ++ "## Loaded IR Declarations\n\n"
  ++ "\n".intercalate loadedLines.toList ++ "\n\n"
  ++ "## Native Extern Declarations\n\n"
  ++ "\n".intercalate externLines.toList ++ "\n\n"
  ++ "## Initializer Globals\n\n"
  ++ "\n".intercalate initGlobalLines.toList ++ "\n\n"
  ++ "## Missing IR Declarations\n\n"
  ++ "\n".intercalate missingDeclLines.toList ++ "\n\n"
  ++ "## Missing Native Extern Registrations\n\n"
  ++ "\n".intercalate missingExternLines.toList ++ "\n\n"
  ++ "## Unsupported Init Globals\n\n"
  ++ "\n".intercalate unsupportedInitGlobalLines.toList ++ "\n\n"
  ++ "## Interface Exports\n\n"
  ++ "\n".intercalate interfaceExportLines.toList ++ "\n\n"
  ++ "## Interface Diagnostics\n\n"
  ++ "\n".intercalate interfaceDiagnosticLines.toList ++ "\n"

def readTextFile? (path : System.FilePath) : IO (Option String) := do
  try
    return some (← IO.FS.readFile path)
  catch _ =>
    return none

def readBinFile? (path : System.FilePath) : IO (Option ByteArray) := do
  try
    return some (← IO.FS.readBinFile path)
  catch _ =>
    return none

def writeTextFile (path : System.FilePath) (content : String) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readTextFile? path) != some content then
    IO.FS.writeFile path content

def writeBinFile (path : System.FilePath) (content : ByteArray) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readBinFile? path) != some content then
    IO.FS.writeBinFile path content

def generatedAtUtc : IO String := do
  try
    let out <- IO.Process.output {
      cmd := "date"
      args := #["-u", "+%Y-%m-%dT%H:%M:%SZ"]
    }
    if out.exitCode == 0 then
      return out.stdout.trimAscii.toString
    else
      return "unknown"
  catch _ =>
    return "unknown"

def namesSummary (names : Array Name) : String :=
  if names.isEmpty then
    "(none)"
  else
    ", ".intercalate (names.map (fun n => n.toString)).toList

unsafe def run (targets : Array Target) (packagePath reportPath : System.FilePath) : IO UInt32 := do
  let index <- loadDeclIndex targets
  let closure := collectClosure targets index
  let metadata := collectPackageMetadata (← generatedAtUtc) targets index
  let manifest ← collectInterfaceManifest metadata targets index
  let report := reportFor targets closure manifest
  writeTextFile reportPath report
  if !closure.missingDecls.isEmpty || !closure.missingExterns.isEmpty || !closure.unsupportedInitGlobals.isEmpty || !manifest.diagnostics.isEmpty then
    if !closure.missingDecls.isEmpty then
      IO.eprintln "missing IR declarations:"
      for name in closure.missingDecls do
        IO.eprintln s!"  - {name}"
    if !closure.missingExterns.isEmpty then
      IO.eprintln "missing native extern registrations:"
      for name in closure.missingExterns do
        IO.eprintln s!"  - {name}"
    if !closure.unsupportedInitGlobals.isEmpty then
      IO.eprintln "unsupported initializer globals:"
      for name in closure.unsupportedInitGlobals do
        IO.eprintln s!"  - {name}"
    if !manifest.diagnostics.isEmpty then
      IO.eprintln "unsupported interface exports:"
      for diagnostic in manifest.diagnostics do
        IO.eprintln s!"  - {diagnostic.name}: {diagnostic.reason}"
    IO.eprintln s!"see {reportPath}"
    return 1
  match emitPackage closure manifest with
  | .ok bytes =>
      writeBinFile packagePath bytes
      IO.println s!"wrote {packagePath}"
      IO.println s!"wrote {reportPath}"
      IO.println s!"package format: {manifest.metadata.packageFormatVersion}"
      IO.println s!"toolchain: {manifest.metadata.leanToolchain}"
      IO.println s!"generated at: {manifest.metadata.generatedAt}"
      IO.println s!"declarations: {closure.decls.size + closure.externs.size} ({closure.decls.size} Lean IR, {closure.externs.size} native externs)"
      IO.println s!"interface exports: {manifest.exports.size}"
      for target in manifest.metadata.targets do
        IO.println s!"target: {target.source} [{target.mode}] roots: {namesSummary target.resolvedRoots}"
      return 0
  | .error err =>
      IO.eprintln err
      return 1

end Vir.GeneratePackage

def nameFromDotted (text : String) : Name :=
  text.splitOn "." |>.foldl (fun name part =>
    if part.isEmpty then name else .str name part) .anonymous

partial def takeTargetRoots : List String -> List String -> List String × List String
  | [], roots => (roots.reverse, [])
  | "--target" :: rest, roots => (roots.reverse, "--target" :: rest)
  | "--package-target" :: rest, roots => (roots.reverse, "--package-target" :: rest)
  | "--target-all" :: rest, roots => (roots.reverse, "--target-all" :: rest)
  | root :: rest, roots => takeTargetRoots rest (root :: roots)

partial def parseTargets : List String -> Except String (Array Vir.GeneratePackage.Target)
  | [] => pure #[]
  | "--target" :: source :: rest => do
      let (roots, rest) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"target `{source}` has no roots"
      let target : Vir.GeneratePackage.Target :=
        { source := source, roots := roots.toArray.map nameFromDotted }
      return (#[target] ++ (← parseTargets rest))
  | "--package-target" :: source :: rest => do
      let (roots, rest) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"package target `{source}` has no roots"
      let target : Vir.GeneratePackage.Target :=
        { source := source, roots := roots.toArray.map nameFromDotted, packageOnly := true }
      return (#[target] ++ (← parseTargets rest))
  | "--target-all" :: source :: rest => do
      let target : Vir.GeneratePackage.Target :=
        { source := source, roots := #[], includeAll := true }
      return (#[target] ++ (← parseTargets rest))
  | arg :: _ => throw s!"expected `--target`, `--package-target`, or `--target-all`, got `{arg}`"

unsafe def main (args : List String) : IO UInt32 := do
  match args with
  | [packagePath, reportPath] =>
      Vir.GeneratePackage.run Vir.GeneratePackage.defaultTargets packagePath reportPath
  | packagePath :: reportPath :: targetArgs =>
      match parseTargets targetArgs with
      | .ok targets => Vir.GeneratePackage.run targets packagePath reportPath
      | .error err =>
          IO.eprintln err
          return 2
  | _ =>
      IO.eprintln "usage: lean --run tools/GeneratePackage.lean <package.irpkg> <report.md> [--target <source.lean> <root>... | --package-target <source.lean> <root>... | --target-all <source.lean>]..."
      return 2
