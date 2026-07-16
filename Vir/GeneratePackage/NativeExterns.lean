/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Basic

open Lean

namespace Vir.GeneratePackage

open Lean.IR

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
    name := `Int.decEq,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_int_dec_eq"
  },
  {
    name := `Int.decLe,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_int_dec_le"
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
    symbol := "lean_panic_fn_borrowed",
    generateBoxedWrapper := true
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
    resultType := .tagged,
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
    symbol := "lean_eval_const",
    generateBoxedWrapper := true
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
    params := #[param 1 false .erased, param 2 true .tobject],
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
    symbol := "lean_array_size",
    generateBoxedWrapper := true
  },
  {
    name := `Array.uget,
    params := #[param 1 false .erased, param 2 true .object, param 3 false .usize, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_uget",
    generateBoxedWrapper := true
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
    symbol := "lean_array_fget",
    generateBoxedWrapper := true
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
    symbol := "lean_array_get",
    generateBoxedWrapper := true
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
    symbol := "lean_array_uset",
    generateBoxedWrapper := true
  },
  {
    name := `Array.set,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 false .tobject, param 5 false .erased],
    resultType := .object,
    symbol := "lean_array_fset",
    generateBoxedWrapper := true
  },
  {
    name := `Array.set!,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 false .tobject],
    resultType := .object,
    symbol := "lean_array_set",
    generateBoxedWrapper := true
  },
  {
    name := `Array.pop,
    params := #[param 1 false .erased, param 2 false .object],
    resultType := .object,
    symbol := "lean_array_pop"
  },
  {
    name := `Array.replicate,
    params := #[param 1 false .erased, param 2 false .tobject, param 3 false .tobject],
    resultType := .object,
    symbol := "lean_mk_array"
  },
  {
    name := `Array.swapIfInBounds,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 true .tobject],
    resultType := .object,
    symbol := "lean_array_swap",
    generateBoxedWrapper := true
  },
  {
    name := `Array.swap,
    params := #[param 1 false .erased, param 2 false .object, param 3 true .tobject, param 4 true .tobject, param 5 false .erased, param 6 false .erased],
    resultType := .object,
    symbol := "lean_array_fswap",
    generateBoxedWrapper := true
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
    symbol := "lean_byte_array_fget",
    generateBoxedWrapper := true
  },
  {
    name := `ByteArray.set!,
    params := #[param 1 false .object, param 2 true .tobject, param 3 false .uint8],
    resultType := .object,
    symbol := "lean_byte_array_set",
    generateBoxedWrapper := true
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
    symbol := "lean_string_of_usize",
    generateBoxedWrapper := true
  },
  {
    name := `String.append,
    params := #[param 1 false .object, param 2 true .object],
    resultType := .object,
    symbol := "lean_string_append",
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.append,
    params := #[param 1 false .object, param 2 true .object],
    resultType := .object,
    symbol := "lean_string_append",
    generateBoxedWrapper := true
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
    symbol := "lean_string_from_utf8_unchecked",
    generateBoxedWrapper := true
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
    symbol := "lean_string_push",
    generateBoxedWrapper := true
  },
  {
    name := `String.Internal.pushn,
    params := #[param 1 false .object, param 2 false .uint32, param 3 false .tobject],
    resultType := .object,
    symbol := "lean_string_pushn"
  },
  {
    name := `String.length,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_string_length"
  },
  {
    name := `String.Internal.length,
    params := #[param 1 true .object],
    resultType := .tobject,
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
    symbol := "lean_string_get_byte_fast",
    generateBoxedWrapper := true
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
    name := `String.Internal.posOf,
    params := #[param 1 false .object, param 2 false .uint32],
    resultType := .tobject,
    symbol := "lean_string_posof"
  },
  {
    name := `String.Internal.offsetOfPos,
    params := #[param 1 false .object, param 2 false .tobject],
    resultType := .tobject,
    symbol := "lean_string_offsetofpos"
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
    symbol := "lean_string_utf8_next_fast",
    generateBoxedWrapper := true
  },
  {
    name := `String.Pos.Raw.next',
    params := #[param 1 true .object, param 2 true .tobject, param 3 false .erased],
    resultType := .tagged,
    symbol := "lean_string_utf8_next_fast",
    generateBoxedWrapper := true
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
    symbol := "lean_string_utf8_get_fast",
    generateBoxedWrapper := true
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
    symbol := "lean_string_utf8_get_fast",
    generateBoxedWrapper := true
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
    name := `String.compare,
    params := #[param 1 true .object, param 2 true .object],
    resultType := .uint8,
    symbol := "lean_string_compare"
  },
  {
    name := `String.Slice.Pattern.Internal.memcmpStr,
    params := #[param 1 true .object, param 2 true .object, param 3 true .tobject, param 4 true .tobject, param 5 true .tobject, param 6 false .erased, param 7 false .erased],
    resultType := .uint8,
    symbol := "lean_string_memcmp",
    generateBoxedWrapper := true
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
    name := `UInt16.toUInt32,
    params := #[param 1 false .uint16],
    resultType := .uint32,
    symbol := "lean_uint16_to_uint32"
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
    name := `UInt32.toUInt16,
    params := #[param 1 false .uint32],
    resultType := .uint16,
    symbol := "lean_uint32_to_uint16"
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
    symbol := "lean_float_scaleb",
    generateBoxedWrapper := true
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
    symbol := "lean_level_mk_data",
    generateBoxedWrapper := true
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
    symbol := "lean_expr_mk_data",
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.mkAppData,
    params := #[param 1 false .uint64, param 2 false .uint64],
    resultType := .uint64,
    symbol := "lean_expr_mk_app_data",
    generateBoxedWrapper := true
  },
  {
    name := `Lean.Expr.data,
    params := #[param 1 true .object],
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

end Vir.GeneratePackage
