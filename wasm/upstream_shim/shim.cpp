/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <initializer_list>
#include <string>

#include "kernel/environment.h"
#include "kernel/expr.h"
#include "kernel/trace.h"
#include "library/elab_environment.h"
#include "library/init_attribute.h"
#include "library/ir_interpreter.h"
#include "library/time_task.h"
#include "runtime/io.h"
#include "runtime/object.h"
#include "util/name.h"
#include "util/option_declarations.h"
#include "util/options.h"

extern "C" {
lean_object * l_ByteArray_empty = nullptr;
lean_object * lean_byte_array_copy_slice(
    lean_object * src,
    lean_object * src_off,
    lean_object * dest,
    lean_object * dest_off,
    lean_object * len,
    bool exact);
uint8_t lean_string_validate_utf8(lean_object * bytes);
lean_object * lean_string_to_utf8(lean_object * str);
lean_object * lean_string_from_utf8_unchecked(lean_object * bytes);
lean_object * lean_string_utf8_set(lean_object * str, lean_object * pos, uint32_t c);
}

static lean_object * box_uint8_binary(lean_object * a, lean_object * b, uint8_t (*fn)(uint8_t, uint8_t)) {
    uint8_t result = fn(static_cast<uint8_t>(lean_unbox(a)), static_cast<uint8_t>(lean_unbox(b)));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

static lean_object * box_uint8_unary(lean_object * a, uint8_t (*fn)(uint8_t)) {
    uint8_t result = fn(static_cast<uint8_t>(lean_unbox(a)));
    lean_dec(a);
    return lean_box(result);
}

static lean_object * box_uint16_binary(lean_object * a, lean_object * b, uint16_t (*fn)(uint16_t, uint16_t)) {
    uint16_t result = fn(static_cast<uint16_t>(lean_unbox(a)), static_cast<uint16_t>(lean_unbox(b)));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

static lean_object * box_uint16_unary(lean_object * a, uint16_t (*fn)(uint16_t)) {
    uint16_t result = fn(static_cast<uint16_t>(lean_unbox(a)));
    lean_dec(a);
    return lean_box(result);
}

static lean_object * box_uint16_predicate(lean_object * a, lean_object * b, uint8_t (*fn)(uint16_t, uint16_t)) {
    uint8_t result = fn(static_cast<uint16_t>(lean_unbox(a)), static_cast<uint16_t>(lean_unbox(b)));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

static lean_object * box_uint64_binary(lean_object * a, lean_object * b, uint64_t (*fn)(uint64_t, uint64_t)) {
    uint64_t result = fn(lean_unbox_uint64(a), lean_unbox_uint64(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint64(result);
}

static lean_object * box_uint64_unary(lean_object * a, uint64_t (*fn)(uint64_t)) {
    uint64_t result = fn(lean_unbox_uint64(a));
    lean_dec(a);
    return lean_box_uint64(result);
}

static lean_object * box_uint64_predicate(lean_object * a, lean_object * b, uint8_t (*fn)(uint64_t, uint64_t)) {
    uint8_t result = fn(lean_unbox_uint64(a), lean_unbox_uint64(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_add___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_add(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_sub___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_sub(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_dec_eq___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_nat_dec_eq(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_dec_le___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_nat_dec_le(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_dec_lt___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_nat_dec_lt(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_mul___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_mul(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_div___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_div(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_pow___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_pow(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_log2___boxed(lean_object * a) {
    lean_object * result = lean_nat_log2(a);
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_nat_shiftl___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_shiftl(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_shiftr___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_shiftr(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_nat_to_int___boxed(lean_object * a) {
    return lean_nat_to_int(a);
}

extern "C" lean_object * lean_int_add___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_int_add(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_int_sub___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_int_sub(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_int_mul___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_int_mul(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_int_neg___boxed(lean_object * a) {
    lean_object * result = lean_int_neg(a);
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_int_dec_lt___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_int_dec_lt(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_nat_abs___boxed(lean_object * a) {
    lean_object * result = lean_nat_abs(a);
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_array_mk_empty___boxed(lean_object * type, lean_object * capacity) {
    lean_dec(type);
    lean_object * result = lean_mk_empty_array_with_capacity(capacity);
    lean_dec(capacity);
    return result;
}

extern "C" lean_object * lean_array_push___boxed(lean_object * type, lean_object * array, lean_object * value) {
    lean_dec(type);
    return lean_array_push(array, value);
}

extern "C" lean_object * lean_array_to_list___boxed(lean_object * type, lean_object * array) {
    lean_dec(type);
    lean_object * result = lean_box(0);
    size_t idx = lean_array_size(array);
    while (idx > 0) {
        idx--;
        lean_object * value = lean_array_get_core(array, idx);
        lean_inc(value);
        lean_object * cons = lean_alloc_ctor(1, 2, 0);
        lean_ctor_set(cons, 0, value);
        lean_ctor_set(cons, 1, result);
        result = cons;
    }
    lean_dec(array);
    return result;
}

extern "C" lean_object * lean_array_get_size___boxed(lean_object * type, lean_object * array) {
    lean_dec(type);
    lean_object * result = lean_array_get_size(array);
    lean_dec(array);
    return result;
}

extern "C" lean_object * lean_array_size___boxed(lean_object * type, lean_object * array) {
    lean_dec(type);
    size_t result = lean_array_size(array);
    lean_dec(array);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_array_uget___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_uget(array, lean_unbox_usize(index));
    lean_dec(array);
    lean_dec(index);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_array_uget_borrowed___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_uget_borrowed(array, lean_unbox_usize(index));
    lean_inc(result);
    lean_dec(array);
    lean_dec(index);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_array_uset___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * value, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_uset(array, lean_unbox_usize(index), value);
    lean_dec(index);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_array_set___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * value) {
    lean_dec(type);
    lean_object * result = lean_array_set(array, index, value);
    lean_dec(index);
    return result;
}

extern "C" lean_object * lean_array_pop___boxed(lean_object * type, lean_object * array) {
    lean_dec(type);
    return lean_array_pop(array);
}

extern "C" lean_object * lean_mk_array___boxed(lean_object * type, lean_object * size, lean_object * value) {
    lean_dec(type);
    return lean_mk_array(size, value);
}

extern "C" lean_object * lean_array_swap___boxed(lean_object * type, lean_object * array, lean_object * i, lean_object * j) {
    lean_dec(type);
    lean_object * result = lean_array_swap(array, i, j);
    lean_dec(i);
    lean_dec(j);
    return result;
}

extern "C" lean_object * lean_byte_array_push___boxed(lean_object * array, lean_object * value) {
    uint8_t byte = static_cast<uint8_t>(lean_unbox(value));
    lean_dec(value);
    return lean_byte_array_push(array, byte);
}

extern "C" lean_object * lean_byte_array_get___boxed(lean_object * array, lean_object * index) {
    uint8_t result = lean_byte_array_get(array, index);
    lean_dec(array);
    lean_dec(index);
    return lean_box(result);
}

extern "C" lean_object * lean_byte_array_set___boxed(lean_object * array, lean_object * index, lean_object * value) {
    uint8_t byte = static_cast<uint8_t>(lean_unbox(value));
    lean_dec(value);
    lean_object * result = lean_byte_array_set(array, index, byte);
    lean_dec(index);
    return result;
}

extern "C" lean_object * l_ByteArray_extract___boxed(lean_object * array, lean_object * start, lean_object * stop) {
    lean_object * len = lean_nat_sub(stop, start);
    lean_object * result = lean_byte_array_copy_slice(
        array,
        start,
        lean_mk_empty_byte_array(lean_box(0)),
        lean_box(0),
        len,
        true);
    lean_dec(array);
    lean_dec(start);
    lean_dec(stop);
    lean_dec(len);
    return result;
}

extern "C" lean_object * lean_byte_array_size___boxed(lean_object * array) {
    lean_object * result = lean_byte_array_size(array);
    lean_dec(array);
    return result;
}

extern "C" lean_object * lean_string_validate_utf8___boxed(lean_object * array) {
    uint8_t result = lean_string_validate_utf8(array);
    lean_dec(array);
    return lean_box(result);
}

extern "C" lean_object * lean_usize_of_nat___boxed(lean_object * a) {
    size_t result = lean_usize_of_nat(a);
    lean_dec(a);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_usize_add___boxed(lean_object * a, lean_object * b) {
    size_t result = lean_usize_add(lean_unbox_usize(a), lean_unbox_usize(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_usize_dec_eq___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_usize_dec_eq(lean_unbox_usize(a), lean_unbox_usize(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_usize_dec_lt___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_usize_dec_lt(lean_unbox_usize(a), lean_unbox_usize(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_string_append___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_string_append(a, b);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_string_to_utf8___boxed(lean_object * s) {
    lean_object * result = lean_string_to_utf8(s);
    lean_dec(s);
    return result;
}

extern "C" lean_object * lean_string_from_utf8_unchecked___boxed(lean_object * bytes, lean_object * proof) {
    lean_object * result = lean_string_from_utf8_unchecked(bytes);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * l_String_Pos_set___boxed(lean_object * s, lean_object * pos, lean_object * c, lean_object * proof) {
    uint32_t ch = lean_unbox_uint32(c);
    lean_dec(c);
    lean_object * result = lean_string_utf8_set(s, pos, ch);
    lean_dec(pos);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * l_String_Pos_Raw_set___boxed(lean_object * s, lean_object * pos, lean_object * c) {
    uint32_t ch = lean_unbox_uint32(c);
    lean_dec(c);
    lean_object * result = lean_string_utf8_set(s, pos, ch);
    lean_dec(pos);
    return result;
}

extern "C" lean_object * l_String_set___boxed(lean_object * s, lean_object * pos, lean_object * c) {
    return l_String_Pos_Raw_set___boxed(s, pos, c);
}

extern "C" lean_object * lean_string_push___boxed(lean_object * s, lean_object * c) {
    uint32_t ch = lean_unbox_uint32(c);
    lean_dec(c);
    return lean_string_push(s, ch);
}

extern "C" lean_object * lean_string_length___boxed(lean_object * a) {
    lean_object * result = lean_string_length(a);
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_string_utf8_byte_size___boxed(lean_object * a) {
    lean_object * result = lean_string_utf8_byte_size(a);
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_string_get_byte_fast___boxed(lean_object * s, lean_object * pos, lean_object * proof) {
    uint8_t result = lean_string_get_byte_fast(s, pos);
    lean_dec(s);
    lean_dec(pos);
    lean_dec(proof);
    return lean_box(result);
}

extern "C" lean_object * lean_string_utf8_next___boxed(lean_object * s, lean_object * pos) {
    lean_object * result = lean_string_utf8_next(s, pos);
    lean_dec(s);
    lean_dec(pos);
    return result;
}

extern "C" lean_object * lean_string_utf8_next_fast___boxed(lean_object * s, lean_object * pos, lean_object * proof) {
    lean_object * result = lean_string_utf8_next_fast(s, pos);
    lean_dec(s);
    lean_dec(pos);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_string_utf8_extract___boxed(lean_object * s, lean_object * start, lean_object * stop) {
    lean_object * result = lean_string_utf8_extract(s, start, stop);
    lean_dec(s);
    lean_dec(start);
    lean_dec(stop);
    return result;
}

extern "C" lean_object * lean_string_utf8_prev___boxed(lean_object * s, lean_object * pos) {
    lean_object * result = lean_string_utf8_prev(s, pos);
    lean_dec(s);
    lean_dec(pos);
    return result;
}

extern "C" lean_object * lean_string_utf8_get_fast___boxed(lean_object * s, lean_object * pos, lean_object * proof) {
    uint32_t result = lean_string_utf8_get_fast(s, pos);
    lean_dec(s);
    lean_dec(pos);
    lean_dec(proof);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_string_utf8_get___boxed(lean_object * s, lean_object * pos) {
    uint32_t result = lean_string_utf8_get(s, pos);
    lean_dec(s);
    lean_dec(pos);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_string_utf8_at_end___boxed(lean_object * s, lean_object * pos) {
    uint8_t result = lean_string_utf8_at_end(s, pos);
    lean_dec(s);
    lean_dec(pos);
    return lean_box(result);
}

extern "C" lean_object * lean_string_dec_eq___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_string_dec_eq(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_string_dec_lt___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_string_dec_lt(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_string_memcmp___boxed(
    lean_object * lhs,
    lean_object * rhs,
    lean_object * lstart,
    lean_object * rstart,
    lean_object * len,
    lean_object * h1,
    lean_object * h2) {
    uint8_t result = lean_string_memcmp(lhs, rhs, lstart, rstart, len);
    lean_dec(lhs);
    lean_dec(rhs);
    lean_dec(lstart);
    lean_dec(rstart);
    lean_dec(len);
    lean_dec(h1);
    lean_dec(h2);
    return lean_box(result);
}

extern "C" lean_object * lean_uint8_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_uint8_to_nat(static_cast<uint8_t>(lean_unbox(a)));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_uint8_add___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_add);
}

extern "C" lean_object * lean_uint8_sub___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_sub);
}

extern "C" lean_object * lean_uint8_mul___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_mul);
}

extern "C" lean_object * lean_uint8_div___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_div);
}

extern "C" lean_object * lean_uint8_mod___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_mod);
}

extern "C" lean_object * lean_uint8_land___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_land);
}

extern "C" lean_object * lean_uint8_lor___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_lor);
}

extern "C" lean_object * lean_uint8_xor___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_xor);
}

extern "C" lean_object * lean_uint8_shift_left___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_shift_left);
}

extern "C" lean_object * lean_uint8_shift_right___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_shift_right);
}

extern "C" lean_object * lean_uint8_complement___boxed(lean_object * a) {
    return box_uint8_unary(a, lean_uint8_complement);
}

extern "C" lean_object * lean_uint8_neg___boxed(lean_object * a) {
    return box_uint8_unary(a, lean_uint8_neg);
}

extern "C" lean_object * lean_uint8_dec_eq___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_dec_eq);
}

extern "C" lean_object * lean_uint8_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_dec_lt);
}

extern "C" lean_object * lean_uint8_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_uint8_binary(a, b, lean_uint8_dec_le);
}

extern "C" lean_object * lean_uint16_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_uint16_to_nat(static_cast<uint16_t>(lean_unbox(a)));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_uint16_add___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_add);
}

extern "C" lean_object * lean_uint16_sub___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_sub);
}

extern "C" lean_object * lean_uint16_mul___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_mul);
}

extern "C" lean_object * lean_uint16_div___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_div);
}

extern "C" lean_object * lean_uint16_mod___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_mod);
}

extern "C" lean_object * lean_uint16_land___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_land);
}

extern "C" lean_object * lean_uint16_lor___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_lor);
}

extern "C" lean_object * lean_uint16_xor___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_xor);
}

extern "C" lean_object * lean_uint16_shift_left___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_shift_left);
}

extern "C" lean_object * lean_uint16_shift_right___boxed(lean_object * a, lean_object * b) {
    return box_uint16_binary(a, b, lean_uint16_shift_right);
}

extern "C" lean_object * lean_uint16_complement___boxed(lean_object * a) {
    return box_uint16_unary(a, lean_uint16_complement);
}

extern "C" lean_object * lean_uint16_neg___boxed(lean_object * a) {
    return box_uint16_unary(a, lean_uint16_neg);
}

extern "C" lean_object * lean_uint16_dec_eq___boxed(lean_object * a, lean_object * b) {
    return box_uint16_predicate(a, b, lean_uint16_dec_eq);
}

extern "C" lean_object * lean_uint16_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_uint16_predicate(a, b, lean_uint16_dec_lt);
}

extern "C" lean_object * lean_uint16_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_uint16_predicate(a, b, lean_uint16_dec_le);
}

extern "C" lean_object * lean_uint32_of_nat___boxed(lean_object * a) {
    uint32_t result = lean_uint32_of_nat(a);
    lean_dec(a);
    return lean_box_uint32(result);
}

extern "C" lean_object * l_UInt32_ofNatLT___boxed(lean_object * a, lean_object * proof) {
    uint32_t result = lean_uint32_of_nat(a);
    lean_dec(a);
    lean_dec(proof);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_uint32_to_nat(static_cast<uint32_t>(lean_unbox_uint32(a)));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_uint32_add___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_add(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_sub___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_sub(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_mul___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_mul(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_div___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_div(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_mod___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_mod(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_land___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_land(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_lor___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_lor(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_xor___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_xor(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_shift_left___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_shift_left(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_shift_right___boxed(lean_object * a, lean_object * b) {
    uint32_t result = lean_uint32_shift_right(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_complement___boxed(lean_object * a) {
    uint32_t result = lean_uint32_complement(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_neg___boxed(lean_object * a) {
    uint32_t result = lean_uint32_neg(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint32_dec_eq___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_uint32_dec_eq(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_uint32_dec_lt___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_uint32_dec_lt(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_uint32_dec_le___boxed(lean_object * a, lean_object * b) {
    uint8_t result = lean_uint32_dec_le(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
}

extern "C" lean_object * lean_uint64_of_nat___boxed(lean_object * a) {
    uint64_t result = lean_uint64_of_nat(a);
    lean_dec(a);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_uint64_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_uint64_to_nat(lean_unbox_uint64(a));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_uint64_add___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_add);
}

extern "C" lean_object * lean_uint64_sub___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_sub);
}

extern "C" lean_object * lean_uint64_mul___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_mul);
}

extern "C" lean_object * lean_uint64_div___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_div);
}

extern "C" lean_object * lean_uint64_mod___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_mod);
}

extern "C" lean_object * lean_uint64_land___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_land);
}

extern "C" lean_object * lean_uint64_lor___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_lor);
}

extern "C" lean_object * lean_uint64_xor___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_xor);
}

extern "C" lean_object * lean_uint64_shift_left___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_shift_left);
}

extern "C" lean_object * lean_uint64_shift_right___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_shift_right);
}

extern "C" lean_object * lean_uint64_complement___boxed(lean_object * a) {
    return box_uint64_unary(a, lean_uint64_complement);
}

extern "C" lean_object * lean_uint64_neg___boxed(lean_object * a) {
    return box_uint64_unary(a, lean_uint64_neg);
}

extern "C" lean_object * lean_uint64_dec_eq___boxed(lean_object * a, lean_object * b) {
    return box_uint64_predicate(a, b, lean_uint64_dec_eq);
}

extern "C" lean_object * lean_uint64_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_uint64_predicate(a, b, lean_uint64_dec_lt);
}

extern "C" lean_object * lean_uint64_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_uint64_predicate(a, b, lean_uint64_dec_le);
}

extern "C" lean_object * lean_uint64_to_float___boxed(lean_object * a) {
    double result = lean_uint64_to_float(lean_unbox_uint64(a));
    lean_dec(a);
    return lean_box_float(result);
}

extern "C" lean_object * lean_float_scaleb___boxed(lean_object * a, lean_object * b) {
    double result = lean_float_scaleb(lean_unbox_float(a), b);
    lean_dec(a);
    lean_dec(b);
    return lean_box_float(result);
}

extern "C" lean_object * lean_float_to_uint32___boxed(lean_object * a) {
    uint32_t result = lean_float_to_uint32(lean_unbox_float(a));
    lean_dec(a);
    return lean_box_uint32(result);
}

#define VIR_NATIVE_SYMBOLS(X, X_CONST) \
    X("Nat.add", "lean_nat_add", lean_nat_add___boxed) \
    X("Nat.sub", "lean_nat_sub", lean_nat_sub___boxed) \
    X("Nat.decEq", "lean_nat_dec_eq", lean_nat_dec_eq___boxed) \
    X("Nat.decLe", "lean_nat_dec_le", lean_nat_dec_le___boxed) \
    X("Nat.ble", "lean_nat_dec_le", lean_nat_dec_le___boxed) \
    X("Nat.decLt", "lean_nat_dec_lt", lean_nat_dec_lt___boxed) \
    X("Nat.mul", "lean_nat_mul", lean_nat_mul___boxed) \
    X("Nat.div", "lean_nat_div", lean_nat_div___boxed) \
    X("Nat.pow", "lean_nat_pow", lean_nat_pow___boxed) \
    X("Nat.log2", "lean_nat_log2", lean_nat_log2___boxed) \
    X("Nat.shiftLeft", "lean_nat_shiftl", lean_nat_shiftl___boxed) \
    X("Nat.shiftRight", "lean_nat_shiftr", lean_nat_shiftr___boxed) \
    X("Int.ofNat", "lean_nat_to_int", lean_nat_to_int___boxed) \
    X("Int.add", "lean_int_add", lean_int_add___boxed) \
    X("Int.sub", "lean_int_sub", lean_int_sub___boxed) \
    X("Int.mul", "lean_int_mul", lean_int_mul___boxed) \
    X("Int.neg", "lean_int_neg", lean_int_neg___boxed) \
    X("Int.decLt", "lean_int_dec_lt", lean_int_dec_lt___boxed) \
    X("Int.natAbs", "lean_nat_abs", lean_nat_abs___boxed) \
    X("Array.mkEmpty", "lean_array_mk_empty", lean_array_mk_empty___boxed) \
    X("Array.push", "lean_array_push", lean_array_push___boxed) \
    X("Array.toList", "lean_array_to_list", lean_array_to_list___boxed) \
    X("Array.size", "lean_array_get_size", lean_array_get_size___boxed) \
    X("Array.usize", "lean_array_size", lean_array_size___boxed) \
    X("Array.uget", "lean_array_uget", lean_array_uget___boxed) \
    X("Array.ugetBorrowed", "lean_array_uget_borrowed", lean_array_uget_borrowed___boxed) \
    X("Array.uset", "lean_array_uset", lean_array_uset___boxed) \
    X("Array.set!", "lean_array_set", lean_array_set___boxed) \
    X("Array.pop", "lean_array_pop", lean_array_pop___boxed) \
    X("Array.replicate", "lean_mk_array", lean_mk_array___boxed) \
    X("Array.swapIfInBounds", "lean_array_swap", lean_array_swap___boxed) \
    X_CONST("ByteArray.empty", "l_ByteArray_empty", &l_ByteArray_empty) \
    X("ByteArray.push", "lean_byte_array_push", lean_byte_array_push___boxed) \
    X("ByteArray.get!", "lean_byte_array_get", lean_byte_array_get___boxed) \
    X("ByteArray.set!", "lean_byte_array_set", lean_byte_array_set___boxed) \
    X("ByteArray.extract", "l_ByteArray_extract", l_ByteArray_extract___boxed) \
    X("ByteArray.size", "lean_byte_array_size", lean_byte_array_size___boxed) \
    X("ByteArray.validateUTF8", "lean_string_validate_utf8", lean_string_validate_utf8___boxed) \
    X("USize.ofNat", "lean_usize_of_nat", lean_usize_of_nat___boxed) \
    X("USize.add", "lean_usize_add", lean_usize_add___boxed) \
    X("USize.decEq", "lean_usize_dec_eq", lean_usize_dec_eq___boxed) \
    X("USize.decLt", "lean_usize_dec_lt", lean_usize_dec_lt___boxed) \
    X("String.append", "lean_string_append", lean_string_append___boxed) \
    X("String.toUTF8", "lean_string_to_utf8", lean_string_to_utf8___boxed) \
    X("String.ofByteArray", "lean_string_from_utf8_unchecked", lean_string_from_utf8_unchecked___boxed) \
    X("String.push", "lean_string_push", lean_string_push___boxed) \
    X("String.length", "lean_string_length", lean_string_length___boxed) \
    X("String.utf8ByteSize", "lean_string_utf8_byte_size", lean_string_utf8_byte_size___boxed) \
    X("String.getUTF8Byte", "lean_string_get_byte_fast", lean_string_get_byte_fast___boxed) \
    X("String.Pos.set", "l_String_Pos_set", l_String_Pos_set___boxed) \
    X("String.Pos.Raw.set", "l_String_Pos_Raw_set", l_String_Pos_Raw_set___boxed) \
    X("String.set", "l_String_set", l_String_set___boxed) \
    X("String.Internal.next", "lean_string_utf8_next", lean_string_utf8_next___boxed) \
    X("String.Pos.Raw.next", "lean_string_utf8_next", lean_string_utf8_next___boxed) \
    X("String.Pos.next", "lean_string_utf8_next_fast", lean_string_utf8_next_fast___boxed) \
    X("String.Internal.extract", "lean_string_utf8_extract", lean_string_utf8_extract___boxed) \
    X("String.extract", "lean_string_utf8_extract", lean_string_utf8_extract___boxed) \
    X("String.Pos.Raw.extract", "lean_string_utf8_extract", lean_string_utf8_extract___boxed) \
    X("String.Pos.Raw.prev", "lean_string_utf8_prev", lean_string_utf8_prev___boxed) \
    X("String.decodeChar", "lean_string_utf8_get_fast", lean_string_utf8_get_fast___boxed) \
    X("String.Pos.Raw.get", "lean_string_utf8_get", lean_string_utf8_get___boxed) \
    X("String.Internal.atEnd", "lean_string_utf8_at_end", lean_string_utf8_at_end___boxed) \
    X("String.Pos.Raw.atEnd", "lean_string_utf8_at_end", lean_string_utf8_at_end___boxed) \
    X("String.decEq", "lean_string_dec_eq", lean_string_dec_eq___boxed) \
    X("String.decidableLT", "lean_string_dec_lt", lean_string_dec_lt___boxed) \
    X("String.Slice.Pattern.Internal.memcmpStr", "lean_string_memcmp", lean_string_memcmp___boxed) \
    X("UInt8.toNat", "lean_uint8_to_nat", lean_uint8_to_nat___boxed) \
    X("UInt8.add", "lean_uint8_add", lean_uint8_add___boxed) \
    X("UInt8.sub", "lean_uint8_sub", lean_uint8_sub___boxed) \
    X("UInt8.mul", "lean_uint8_mul", lean_uint8_mul___boxed) \
    X("UInt8.div", "lean_uint8_div", lean_uint8_div___boxed) \
    X("UInt8.mod", "lean_uint8_mod", lean_uint8_mod___boxed) \
    X("UInt8.land", "lean_uint8_land", lean_uint8_land___boxed) \
    X("UInt8.lor", "lean_uint8_lor", lean_uint8_lor___boxed) \
    X("UInt8.xor", "lean_uint8_xor", lean_uint8_xor___boxed) \
    X("UInt8.shiftLeft", "lean_uint8_shift_left", lean_uint8_shift_left___boxed) \
    X("UInt8.shiftRight", "lean_uint8_shift_right", lean_uint8_shift_right___boxed) \
    X("UInt8.complement", "lean_uint8_complement", lean_uint8_complement___boxed) \
    X("UInt8.neg", "lean_uint8_neg", lean_uint8_neg___boxed) \
    X("UInt8.decEq", "lean_uint8_dec_eq", lean_uint8_dec_eq___boxed) \
    X("UInt8.decLt", "lean_uint8_dec_lt", lean_uint8_dec_lt___boxed) \
    X("UInt8.decLe", "lean_uint8_dec_le", lean_uint8_dec_le___boxed) \
    X("UInt16.toNat", "lean_uint16_to_nat", lean_uint16_to_nat___boxed) \
    X("UInt16.add", "lean_uint16_add", lean_uint16_add___boxed) \
    X("UInt16.sub", "lean_uint16_sub", lean_uint16_sub___boxed) \
    X("UInt16.mul", "lean_uint16_mul", lean_uint16_mul___boxed) \
    X("UInt16.div", "lean_uint16_div", lean_uint16_div___boxed) \
    X("UInt16.mod", "lean_uint16_mod", lean_uint16_mod___boxed) \
    X("UInt16.land", "lean_uint16_land", lean_uint16_land___boxed) \
    X("UInt16.lor", "lean_uint16_lor", lean_uint16_lor___boxed) \
    X("UInt16.xor", "lean_uint16_xor", lean_uint16_xor___boxed) \
    X("UInt16.shiftLeft", "lean_uint16_shift_left", lean_uint16_shift_left___boxed) \
    X("UInt16.shiftRight", "lean_uint16_shift_right", lean_uint16_shift_right___boxed) \
    X("UInt16.complement", "lean_uint16_complement", lean_uint16_complement___boxed) \
    X("UInt16.neg", "lean_uint16_neg", lean_uint16_neg___boxed) \
    X("UInt16.decEq", "lean_uint16_dec_eq", lean_uint16_dec_eq___boxed) \
    X("UInt16.decLt", "lean_uint16_dec_lt", lean_uint16_dec_lt___boxed) \
    X("UInt16.decLe", "lean_uint16_dec_le", lean_uint16_dec_le___boxed) \
    X("UInt32.ofNat", "lean_uint32_of_nat", lean_uint32_of_nat___boxed) \
    X("UInt32.ofNatLT", "l_UInt32_ofNatLT", l_UInt32_ofNatLT___boxed) \
    X("UInt32.toNat", "lean_uint32_to_nat", lean_uint32_to_nat___boxed) \
    X("UInt32.add", "lean_uint32_add", lean_uint32_add___boxed) \
    X("UInt32.sub", "lean_uint32_sub", lean_uint32_sub___boxed) \
    X("UInt32.mul", "lean_uint32_mul", lean_uint32_mul___boxed) \
    X("UInt32.div", "lean_uint32_div", lean_uint32_div___boxed) \
    X("UInt32.mod", "lean_uint32_mod", lean_uint32_mod___boxed) \
    X("UInt32.land", "lean_uint32_land", lean_uint32_land___boxed) \
    X("UInt32.lor", "lean_uint32_lor", lean_uint32_lor___boxed) \
    X("UInt32.xor", "lean_uint32_xor", lean_uint32_xor___boxed) \
    X("UInt32.shiftLeft", "lean_uint32_shift_left", lean_uint32_shift_left___boxed) \
    X("UInt32.shiftRight", "lean_uint32_shift_right", lean_uint32_shift_right___boxed) \
    X("UInt32.complement", "lean_uint32_complement", lean_uint32_complement___boxed) \
    X("UInt32.neg", "lean_uint32_neg", lean_uint32_neg___boxed) \
    X("UInt32.decEq", "lean_uint32_dec_eq", lean_uint32_dec_eq___boxed) \
    X("UInt32.decLt", "lean_uint32_dec_lt", lean_uint32_dec_lt___boxed) \
    X("UInt32.decLe", "lean_uint32_dec_le", lean_uint32_dec_le___boxed) \
    X("UInt64.ofNat", "lean_uint64_of_nat", lean_uint64_of_nat___boxed) \
    X("UInt64.toNat", "lean_uint64_to_nat", lean_uint64_to_nat___boxed) \
    X("UInt64.add", "lean_uint64_add", lean_uint64_add___boxed) \
    X("UInt64.sub", "lean_uint64_sub", lean_uint64_sub___boxed) \
    X("UInt64.mul", "lean_uint64_mul", lean_uint64_mul___boxed) \
    X("UInt64.div", "lean_uint64_div", lean_uint64_div___boxed) \
    X("UInt64.mod", "lean_uint64_mod", lean_uint64_mod___boxed) \
    X("UInt64.land", "lean_uint64_land", lean_uint64_land___boxed) \
    X("UInt64.lor", "lean_uint64_lor", lean_uint64_lor___boxed) \
    X("UInt64.xor", "lean_uint64_xor", lean_uint64_xor___boxed) \
    X("UInt64.shiftLeft", "lean_uint64_shift_left", lean_uint64_shift_left___boxed) \
    X("UInt64.shiftRight", "lean_uint64_shift_right", lean_uint64_shift_right___boxed) \
    X("UInt64.complement", "lean_uint64_complement", lean_uint64_complement___boxed) \
    X("UInt64.neg", "lean_uint64_neg", lean_uint64_neg___boxed) \
    X("UInt64.decEq", "lean_uint64_dec_eq", lean_uint64_dec_eq___boxed) \
    X("UInt64.decLt", "lean_uint64_dec_lt", lean_uint64_dec_lt___boxed) \
    X("UInt64.decLe", "lean_uint64_dec_le", lean_uint64_dec_le___boxed) \
    X("UInt64.toFloat", "lean_uint64_to_float", lean_uint64_to_float___boxed) \
    X("Float.scaleB", "lean_float_scaleb", lean_float_scaleb___boxed) \
    X("Float.toUInt32", "lean_float_to_uint32", lean_float_to_uint32___boxed)

struct NativeSymbol {
    char const * lean_name;
    char const * stem;
    char const * dlsym_name;
    void * address;
};

static NativeSymbol const g_native_symbols[] = {
#define VIR_NATIVE_BOXED_ENTRY(lean_name, stem, fn) \
    { lean_name, stem, stem "___boxed", reinterpret_cast<void *>(fn) },
#define VIR_NATIVE_CONST_ENTRY(lean_name, stem, ptr) \
    { lean_name, stem, stem, reinterpret_cast<void *>(ptr) },
    VIR_NATIVE_SYMBOLS(VIR_NATIVE_BOXED_ENTRY, VIR_NATIVE_CONST_ENTRY)
#undef VIR_NATIVE_CONST_ENTRY
#undef VIR_NATIVE_BOXED_ENTRY
};

extern "C" void * dlsym(void *, char const * sym) {
    for (NativeSymbol const & entry : g_native_symbols) {
        if (strcmp(sym, entry.dlsym_name) == 0) {
            return entry.address;
        }
    }
    return nullptr;
}

extern "C" void * __cxa_allocate_exception(size_t size) {
    return malloc(size == 0 ? 1 : size);
}

extern "C" [[noreturn]] void __cxa_throw(void *, void *, void (*)(void *)) {
    __builtin_trap();
    abort();
}

namespace lean {
namespace {

constexpr unsigned NAME_HASH_OFFSET = 2 * sizeof(void *);

static object * mk_ctor(unsigned tag, std::initializer_list<object *> fields, unsigned scalar_size = 0) {
    object * obj = lean_alloc_ctor(tag, fields.size(), scalar_size);
    unsigned idx = 0;
    for (object * field : fields) {
        lean_inc(field);
        lean_ctor_set(obj, idx, field);
        idx++;
    }
    return obj;
}

static object * mk_some(object * value) {
    return mk_ctor(1, { value });
}

static void set_name_hash(object * name, uint64_t hash) {
    lean_ctor_set_uint64(name, NAME_HASH_OFFSET, hash);
}

static void ensure_ir_interpreter_initialized() {
    static bool initialized = false;
    if (!initialized) {
        initialize_ir_interpreter();
        l_ByteArray_empty = lean_mk_empty_byte_array(lean_box(0));
        lean_mark_persistent(l_ByteArray_empty);
        initialized = true;
    }
}

static uint32_t run_nat_function(name const & fn, unsigned n, object ** args) {
    elab_environment env(lean_box(0));
    options opts(lean_box(0));
    object * result = ir::run_boxed(env, opts, fn, n, args);
    uint32_t out = static_cast<uint32_t>(vir::static_nat_to_usize(result));
    lean_dec(result);
    return out;
}

static std::string nat_to_decimal(object * value) {
    if (lean_is_scalar(value)) {
        return std::to_string(lean_unbox(value));
    }
    return mpz_value(value).to_string();
}

static std::string run_nat_function_string(name const & fn, unsigned n, object ** args) {
    elab_environment env(lean_box(0));
    options opts(lean_box(0));
    object * result = ir::run_boxed(env, opts, fn, n, args);
    std::string out = nat_to_decimal(result);
    lean_dec(result);
    return out;
}

static std::string g_eval_const_nat_string;

static uint32_t run_tagged_function(name const & fn, unsigned n, object ** args) {
    elab_environment env(lean_box(0));
    options opts(lean_box(0));
    object * result = ir::run_boxed(env, opts, fn, n, args);
    uint32_t out = static_cast<uint32_t>(lean_obj_tag(result));
    lean_dec(result);
    return out;
}

static object * mk_nat_array(uint32_t const * values, uint32_t len) {
    object * array = lean_alloc_array(len, len);
    for (uint32_t i = 0; i < len; i++) {
        lean_array_set_core(array, i, vir::mk_static_nat(values[i]));
    }
    return array;
}

static char const * known_symbol_stem(name const & n) {
    std::string dotted = n.to_string();
    for (::NativeSymbol const & entry : ::g_native_symbols) {
        if (dotted == entry.lean_name) {
            return entry.stem;
        }
    }
    return nullptr;
}

static name name_from_dotted(char const * text, size_t len) {
    name current;
    size_t start = 0;
    while (start <= len) {
        size_t end = start;
        while (end < len && text[end] != '.') {
            end++;
        }
        if (end > start) {
            std::string part(text + start, end - start);
            current = name(current, part.c_str());
        }
        if (end == len) {
            break;
        }
        start = end + 1;
    }
    return current;
}

} // namespace

extern "C" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix) {
    object * obj = mk_ctor(static_cast<unsigned>(name_kind::STRING), { prefix, suffix }, sizeof(uint64_t));
    set_name_hash(obj, 1729);
    return obj;
}

extern "C" obj_res lean_name_mk_numeral(obj_arg prefix, obj_arg suffix) {
    object * obj = mk_ctor(static_cast<unsigned>(name_kind::NUMERAL), { prefix, suffix }, sizeof(uint64_t));
    set_name_hash(obj, 1729);
    return obj;
}

void check_system(char const *, bool) {}

void reset_heartbeat() {}

void save_stack_info(bool) {}

void notify_assertion_violation(char const *, int, char const *) {
    __builtin_trap();
}

bool options::get_bool(name const &, bool default_value) const {
    return default_value;
}

time_task::time_task(std::string const & category, options const &, name):
    m_category(category),
    m_timeit(),
    m_parent_task(nullptr) {
}

time_task::~time_task() {}

scope_trace_env::scope_trace_env(elab_environment const &, options const &):
    m_old_opts(nullptr) {
}

scope_trace_env::~scope_trace_env() {}

environment elab_environment::to_kernel_env() const {
    lean_inc(raw());
    return environment(raw());
}

constant_info environment::get(name const &) const {
    return constant_info(lean_box(0));
}

bool is_arrow(expr const &) {
    return false;
}

name const & get_uint32_name() {
    static name * n = nullptr;
    if (!n) {
        n = new name("UInt32");
    }
    return *n;
}

optional<name> get_init_fn_name_for(elab_environment const &, name const &) {
    return optional<name>();
}

void register_option(name const &, name const &, data_value_kind, char const *, char const *) {}

} // namespace lean

extern "C" lean::object * lean_decl_get_sorry_dep(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::object * lean_get_regular_init_fn_name_for(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::object * lean_get_export_name_for(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::obj_res lean_get_symbol_stem(lean::obj_arg env, lean::obj_arg fn) {
    lean_dec(env);
    lean::name n(fn);
    if (char const * stem = lean::known_symbol_stem(n)) {
        return lean_mk_string(stem);
    }
    std::string fallback = n.to_string();
    return lean_mk_string(fallback.c_str());
}

extern "C" lean::obj_res lean_mk_mangled_boxed_name(lean::obj_arg str) {
    lean::string_ref stem(str);
    std::string boxed = stem.to_std_string() + "___boxed";
    return lean_mk_string(boxed.c_str());
}

extern "C" double lean_float_of_nat(lean_obj_arg a) {
    double result = static_cast<double>(lean_usize_of_nat(a));
    lean_dec(a);
    return result;
}

extern "C" float lean_float32_of_nat(lean_obj_arg a) {
    float result = static_cast<float>(lean_usize_of_nat(a));
    lean_dec(a);
    return result;
}

extern "C" lean::obj_res lean_io_eprintln(lean::obj_arg s) {
    lean_dec(s);
    return lean_io_result_mk_ok(lean_box(0));
}

extern "C" void lean_io_result_show_error(lean::b_obj_arg) {}

extern "C" lean::object * lean_ir_find_env_decl(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_static_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_ir_find_env_decl_boxed(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_static_boxed_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" uint32_t vir_upstream_shim_fixture_count(void) {
    return lean::vir::static_decl_count();
}

extern "C" uint32_t vir_upstream_target_pointer_bytes(void) {
    return sizeof(void *);
}

extern "C" uint32_t vir_upstream_fib(uint32_t n) {
    lean::ensure_ir_interpreter_initialized();
    lean::object * arg = lean::vir::mk_static_nat(n);
    lean::object * args[] = { arg };
    return lean::run_nat_function(lean::name("fib"), 1, args);
}

extern "C" uint32_t vir_upstream_fib_repeated(uint32_t iterations, uint32_t n) {
    lean::ensure_ir_interpreter_initialized();
    lean::name fn("fib");
    lean::object * arg = lean::vir::mk_static_nat(n);
    uint32_t acc = 0;
    for (uint32_t i = 0; i < iterations; i++) {
        lean_inc(arg);
        lean::object * args[] = { arg };
        acc += lean::run_nat_function(fn, 1, args);
    }
    lean_dec(arg);
    return acc;
}

extern "C" uint32_t vir_upstream_tamagotchi_step(uint32_t mood, uint32_t action) {
    lean::ensure_ir_interpreter_initialized();
    lean::object * mood_obj = lean_box(mood);
    lean::object * action_obj = lean_box(action);
    lean::object * args[] = { mood_obj, action_obj };
    return lean::run_tagged_function(lean::name({ "Tamagotchi", "step" }), 2, args);
}

extern "C" uint32_t vir_upstream_tamagotchi_run_demo(void) {
    lean::ensure_ir_interpreter_initialized();
    lean::elab_environment env(lean_box(0));
    lean::options opts(lean_box(0));
    lean::object * script = lean::ir::run_boxed(env, opts, lean::name({ "Tamagotchi", "demoScript" }), 0, nullptr);
    lean::object * initial = lean_box(0);
    lean::object * args[] = { initial, script };
    lean::object * result = lean::ir::run_boxed(env, opts, lean::name({ "Tamagotchi", "run" }), 2, args);
    uint32_t out = static_cast<uint32_t>(lean_obj_tag(result));
    lean_dec(result);
    return out;
}

extern "C" uint32_t vir_eval_const_nat(char const * name_text, uint32_t name_len) {
    lean::ensure_ir_interpreter_initialized();
    lean::name fn = lean::name_from_dotted(name_text, name_len);
    return lean::run_nat_function(fn, 0, nullptr);
}

extern "C" char const * vir_eval_const_nat_string(char const * name_text, uint32_t name_len) {
    lean::ensure_ir_interpreter_initialized();
    lean::name fn = lean::name_from_dotted(name_text, name_len);
    lean::g_eval_const_nat_string = lean::run_nat_function_string(fn, 0, nullptr);
    return lean::g_eval_const_nat_string.c_str();
}

extern "C" uint32_t vir_eval_const_nat_string_size(void) {
    return static_cast<uint32_t>(lean::g_eval_const_nat_string.size());
}

extern "C" uint32_t vir_sort_checksum(uint32_t const * values, uint32_t len) {
    if (values == nullptr && len != 0) {
        return 0;
    }
    lean::ensure_ir_interpreter_initialized();
    lean::object * input = lean::mk_nat_array(values, len);
    lean::object * args[] = { input };
    return lean::run_nat_function(lean::name({ "SortDemo", "demoFromArray" }), 1, args);
}

extern "C" uint32_t vir_sort_checksum_repeated(uint32_t const * values, uint32_t len, uint32_t iterations) {
    if (values == nullptr && len != 0) {
        return 0;
    }
    lean::ensure_ir_interpreter_initialized();
    lean::name fn({ "SortDemo", "demoFromArray" });
    lean::object * input = lean::mk_nat_array(values, len);
    uint32_t acc = 0;
    for (uint32_t i = 0; i < iterations; i++) {
        lean_inc(input);
        lean::object * args[] = { input };
        acc += lean::run_nat_function(fn, 1, args);
    }
    lean_dec(input);
    return acc;
}
