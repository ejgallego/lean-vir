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

#include <algorithm>
#include <initializer_list>
#include <limits>
#include <string>
#include <vector>

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
uint8_t lean_string_is_valid_pos(lean_object * str, lean_object * pos);
lean_object * lean_eval_const(lean_object * env, lean_object * opts, lean_object * c);
uint64_t lean_level_mk_data(uint64_t h, lean_object * depth, uint8_t has_mvar, uint8_t has_param);
uint64_t lean_expr_mk_data(
    uint64_t hash,
    lean_object * bvar_range,
    uint32_t approx_depth,
    uint8_t has_fvar,
    uint8_t has_expr_mvar,
    uint8_t has_level_mvar,
    uint8_t has_level_param);
uint64_t lean_expr_mk_app_data(uint64_t f_data, uint64_t a_data);
char const * vir_js_call(uint32_t slot, uint8_t const * request, uint32_t request_len);
uint32_t vir_js_call_result_size(void);
}

static uint8_t g_vir_io_initializing = 0;

extern "C" void vir_set_io_initializing(uint8_t value) {
    g_vir_io_initializing = value ? 1 : 0;
}

extern "C" uint8_t vir_get_io_initializing(void) {
    return g_vir_io_initializing;
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

static lean_object * box_usize_binary(lean_object * a, lean_object * b, size_t (*fn)(size_t, size_t)) {
    size_t result = fn(lean_unbox_usize(a), lean_unbox_usize(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_usize(result);
}

static lean_object * box_usize_predicate(lean_object * a, lean_object * b, uint8_t (*fn)(size_t, size_t)) {
    uint8_t result = fn(lean_unbox_usize(a), lean_unbox_usize(b));
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

static size_t nat_to_size_or_max(lean_object * n) {
    return lean_is_scalar(n) ? lean_unbox(n) : SIZE_MAX;
}

static size_t substring_repaired_pos(lean_object * s, lean_object * p) {
    size_t end = lean_string_size(s) - 1;
    return lean_string_is_valid_pos(s, p) ? nat_to_size_or_max(p) : end;
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

extern "C" lean_object * lean_nat_mod___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_nat_mod(a, b);
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

extern "C" lean_object * lean_system_platform_nbits___boxed(lean_object * unit) {
    lean_dec(unit);
    return lean_box(sizeof(void*) == 8 ? 64 : 32);
}

extern "C" lean_object * lean_panic_fn_borrowed___boxed(lean_object * type, lean_object * default_value, lean_object * msg) {
    lean_dec(type);
    lean_object * result = lean_panic_fn_borrowed(default_value, msg);
    lean_dec(default_value);
    return result;
}

extern "C" lean_object * lean_ptr_addr___boxed(lean_object * type, lean_object * value) {
    lean_dec(type);
    size_t result = lean_ptr_addr(value);
    lean_dec(value);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_io_initializing___boxed(lean_object * world) {
    lean_dec(world);
    return lean_box(g_vir_io_initializing);
}

extern "C" lean_object * lean_st_mk_ref___boxed(
    lean_object * sigma,
    lean_object * alpha,
    lean_object * value,
    lean_object * world) {
    lean_dec(sigma);
    lean_dec(alpha);
    lean_dec(world);
    lean_ref_object * ref = reinterpret_cast<lean_ref_object *>(lean_alloc_small_object(sizeof(lean_ref_object)));
    lean_set_st_header(reinterpret_cast<lean_object *>(ref), LeanRef, 0);
    ref->m_value = value;
    return reinterpret_cast<lean_object *>(ref);
}

extern "C" lean_object * lean_st_ref_get___boxed(
    lean_object * sigma,
    lean_object * alpha,
    lean_object * ref,
    lean_object * world) {
    lean_dec(sigma);
    lean_dec(alpha);
    lean_dec(world);
    lean_object * value = lean_to_ref(ref)->m_value;
    lean_inc(value);
    lean_dec(ref);
    return value;
}

extern "C" lean_object * lean_st_ref_set___boxed(
    lean_object * sigma,
    lean_object * alpha,
    lean_object * ref,
    lean_object * value,
    lean_object * world) {
    lean_dec(sigma);
    lean_dec(alpha);
    lean_dec(world);
    lean_ref_object * ref_obj = lean_to_ref(ref);
    lean_object * old_value = ref_obj->m_value;
    ref_obj->m_value = value;
    lean_dec(old_value);
    lean_dec(ref);
    return lean_box(0);
}

extern "C" lean_object * lean_st_ref_take___boxed(
    lean_object * sigma,
    lean_object * alpha,
    lean_object * ref,
    lean_object * world) {
    lean_dec(sigma);
    lean_dec(alpha);
    lean_dec(world);
    lean_ref_object * ref_obj = lean_to_ref(ref);
    lean_object * value = ref_obj->m_value;
    ref_obj->m_value = nullptr;
    lean_dec(ref);
    return value;
}

extern "C" lean_object * lean_task_pure___boxed(lean_object * type, lean_object * value) {
    lean_dec(type);
    return lean_task_pure(value);
}

extern "C" lean_object * lean_task_get_own___boxed(lean_object * type, lean_object * task) {
    lean_dec(type);
    return lean_task_get_own(task);
}

extern "C" lean_object * lean_task_map___boxed(
    lean_object * alpha,
    lean_object * beta,
    lean_object * fn,
    lean_object * task,
    lean_object * prio,
    lean_object * sync) {
    lean_dec(alpha);
    lean_dec(beta);
    unsigned prio_value = static_cast<unsigned>(lean_unbox(prio));
    uint8_t sync_value = static_cast<uint8_t>(lean_unbox(sync));
    lean_dec(prio);
    lean_dec(sync);
    return lean_task_map_core(fn, task, prio_value, sync_value, false);
}

extern "C" lean_object * lean_array_mk_empty___boxed(lean_object * type, lean_object * capacity) {
    lean_dec(type);
    lean_object * result = lean_mk_empty_array_with_capacity(capacity);
    lean_dec(capacity);
    return result;
}

extern "C" lean_object * lean_array_mk___boxed(lean_object * type, lean_object * list) {
    lean_dec(type);
    size_t len = 0;
    for (lean_object * it = list; !lean_is_scalar(it); it = lean_ctor_get(it, 1)) {
        len++;
    }
    lean_object * array = lean_alloc_array(len, len);
    size_t i = 0;
    for (lean_object * it = list; !lean_is_scalar(it); it = lean_ctor_get(it, 1)) {
        lean_object * value = lean_ctor_get(it, 0);
        lean_inc(value);
        lean_array_set_core(array, i, value);
        i++;
    }
    lean_dec(list);
    return array;
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

extern "C" lean_object * lean_array_fget___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_fget(array, index);
    lean_dec(array);
    lean_dec(index);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_array_fget_borrowed___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_fget(array, index);
    lean_dec(array);
    lean_dec(index);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_array_get___boxed(lean_object * type, lean_object * default_value, lean_object * array, lean_object * index) {
    lean_dec(type);
    lean_object * result = lean_array_get(default_value, array, index);
    lean_dec(default_value);
    lean_dec(array);
    lean_dec(index);
    return result;
}

extern "C" lean_object * lean_array_get_borrowed___boxed(lean_object * type, lean_object * default_value, lean_object * array, lean_object * index) {
    lean_dec(type);
    lean_object * result = lean_array_get(default_value, array, index);
    lean_dec(default_value);
    lean_dec(array);
    lean_dec(index);
    return result;
}

extern "C" lean_object * lean_array_uset___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * value, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_uset(array, lean_unbox_usize(index), value);
    lean_dec(index);
    lean_dec(proof);
    return result;
}

extern "C" lean_object * lean_array_fset___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * value, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_fset(array, index, value);
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

extern "C" lean_object * lean_array_fswap___boxed(lean_object * type, lean_object * array, lean_object * i, lean_object * j, lean_object * hi, lean_object * hj) {
    lean_dec(type);
    lean_object * result = lean_array_fswap(array, i, j);
    lean_dec(i);
    lean_dec(j);
    lean_dec(hi);
    lean_dec(hj);
    return result;
}

extern "C" lean_object * lean_byte_array_mk___boxed(lean_object * array) {
    return lean_byte_array_mk(array);
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

extern "C" lean_object * lean_byte_array_fget___boxed(lean_object * array, lean_object * index, lean_object * proof) {
    uint8_t result = lean_byte_array_fget(array, index);
    lean_dec(array);
    lean_dec(index);
    lean_dec(proof);
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

extern "C" lean_object * l_USize_ofNatLT___boxed(lean_object * a, lean_object * proof) {
    size_t result = lean_usize_of_nat(a);
    lean_dec(a);
    lean_dec(proof);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_usize_add___boxed(lean_object * a, lean_object * b) {
    size_t result = lean_usize_add(lean_unbox_usize(a), lean_unbox_usize(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_usize_sub___boxed(lean_object * a, lean_object * b) {
    return box_usize_binary(a, b, lean_usize_sub);
}

extern "C" lean_object * lean_usize_mul___boxed(lean_object * a, lean_object * b) {
    return box_usize_binary(a, b, lean_usize_mul);
}

extern "C" lean_object * lean_usize_land___boxed(lean_object * a, lean_object * b) {
    return box_usize_binary(a, b, lean_usize_land);
}

extern "C" lean_object * lean_usize_shift_left___boxed(lean_object * a, lean_object * b) {
    return box_usize_binary(a, b, lean_usize_shift_left);
}

extern "C" lean_object * lean_usize_shift_right___boxed(lean_object * a, lean_object * b) {
    return box_usize_binary(a, b, lean_usize_shift_right);
}

extern "C" lean_object * lean_usize_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_usize_to_nat(lean_unbox_usize(a));
    lean_dec(a);
    return result;
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

extern "C" lean_object * lean_usize_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_usize_predicate(a, b, lean_usize_dec_le);
}

extern "C" lean_object * lean_string_of_usize___boxed(lean_object * a) {
    lean_object * result = lean_string_of_usize(lean_unbox_usize(a));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_string_append___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_string_append(a, b);
    lean_dec(b);
    return result;
}

extern "C" lean_object * lean_string_mk___boxed(lean_object * chars) {
    return lean_string_mk(chars);
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

extern "C" lean_object * lean_string_hash___boxed(lean_object * s) {
    uint64_t result = lean_string_hash(s);
    lean_dec(s);
    return lean_box_uint64(result);
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

extern "C" lean_object * lean_string_is_valid_pos___boxed(lean_object * s, lean_object * pos) {
    uint8_t result = lean_string_is_valid_pos(s, pos);
    lean_dec(s);
    lean_dec(pos);
    return lean_box(result);
}

extern "C" lean_object * lean_string_contains___boxed(lean_object * s, lean_object * c) {
    uint32_t needle = lean_unbox_uint32(c);
    lean_dec(c);
    uint8_t found = 0;
    lean_object * pos = lean_box(0);
    while (!lean_string_utf8_at_end(s, pos)) {
        if (lean_string_utf8_get(s, pos) == needle) {
            found = 1;
            break;
        }
        lean_object * next = lean_string_utf8_next(s, pos);
        lean_dec(pos);
        pos = next;
    }
    lean_dec(pos);
    lean_dec(s);
    return lean_box(found);
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

extern "C" lean_object * lean_substring_beq___boxed(lean_object * lhs, lean_object * rhs) {
    lean_object * lhs_str = lean_ctor_get(lhs, 0);
    lean_object * lhs_start_pos = lean_ctor_get(lhs, 1);
    lean_object * lhs_stop_pos = lean_ctor_get(lhs, 2);
    lean_object * rhs_str = lean_ctor_get(rhs, 0);
    lean_object * rhs_start_pos = lean_ctor_get(rhs, 1);
    lean_object * rhs_stop_pos = lean_ctor_get(rhs, 2);

    size_t lhs_start = substring_repaired_pos(lhs_str, lhs_start_pos);
    size_t lhs_stop = substring_repaired_pos(lhs_str, lhs_stop_pos);
    size_t rhs_start = substring_repaired_pos(rhs_str, rhs_start_pos);
    size_t rhs_stop = substring_repaired_pos(rhs_str, rhs_stop_pos);
    size_t lhs_size = lhs_stop >= lhs_start ? lhs_stop - lhs_start : 0;
    size_t rhs_size = rhs_stop >= rhs_start ? rhs_stop - rhs_start : 0;

    uint8_t result = 0;
    if (lhs_size == rhs_size &&
        lhs_start + lhs_size <= lean_string_size(lhs_str) - 1 &&
        rhs_start + rhs_size <= lean_string_size(rhs_str) - 1) {
        result = memcmp(lean_string_cstr(lhs_str) + lhs_start, lean_string_cstr(rhs_str) + rhs_start, lhs_size) == 0;
    }
    lean_dec(lhs);
    lean_dec(rhs);
    return lean_box(result);
}

extern "C" lean_object * lean_name_eq___boxed(lean_object * lhs, lean_object * rhs) {
    uint8_t result = lean_name_eq(lhs, rhs);
    lean_dec(lhs);
    lean_dec(rhs);
    return lean_box(result);
}

extern "C" lean_object * lean_uint8_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_uint8_to_nat(static_cast<uint8_t>(lean_unbox(a)));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_uint8_to_uint32___boxed(lean_object * a) {
    uint32_t result = static_cast<uint32_t>(lean_unbox(a));
    lean_dec(a);
    return lean_box_uint32(result);
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

extern "C" lean_object * lean_uint32_to_uint8___boxed(lean_object * a) {
    uint8_t result = lean_uint32_to_uint8(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box(result);
}

extern "C" lean_object * lean_uint32_to_uint64___boxed(lean_object * a) {
    uint64_t result = lean_uint32_to_uint64(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box_uint64(result);
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

extern "C" lean_object * lean_uint64_mix_hash___boxed(lean_object * a, lean_object * b) {
    return box_uint64_binary(a, b, lean_uint64_mix_hash);
}

extern "C" lean_object * l_UInt64_ofNatLT___boxed(lean_object * a, lean_object * proof) {
    uint64_t result = lean_uint64_of_nat(a);
    lean_dec(a);
    lean_dec(proof);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_uint64_to_nat___boxed(lean_object * a) {
    lean_object * result = lean_uint64_to_nat(lean_unbox_uint64(a));
    lean_dec(a);
    return result;
}

extern "C" lean_object * lean_uint64_to_usize___boxed(lean_object * a) {
    size_t result = lean_uint64_to_usize(lean_unbox_uint64(a));
    lean_dec(a);
    return lean_box_usize(result);
}

extern "C" lean_object * lean_uint64_to_uint32___boxed(lean_object * a) {
    uint32_t result = lean_uint64_to_uint32(lean_unbox_uint64(a));
    lean_dec(a);
    return lean_box_uint32(result);
}

extern "C" lean_object * lean_uint64_to_uint8___boxed(lean_object * a) {
    uint8_t result = static_cast<uint8_t>(lean_unbox_uint64(a));
    lean_dec(a);
    return lean_box(result);
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

extern "C" lean_object * lean_level_mk_data___boxed(
    lean_object * h,
    lean_object * depth,
    lean_object * has_mvar,
    lean_object * has_param) {
    uint64_t result = lean_level_mk_data(
        lean_unbox_uint64(h),
        depth,
        static_cast<uint8_t>(lean_unbox(has_mvar)),
        static_cast<uint8_t>(lean_unbox(has_param)));
    lean_dec(h);
    lean_dec(depth);
    lean_dec(has_mvar);
    lean_dec(has_param);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_expr_mk_data___boxed(
    lean_object * hash,
    lean_object * bvar_range,
    lean_object * approx_depth,
    lean_object * has_fvar,
    lean_object * has_expr_mvar,
    lean_object * has_level_mvar,
    lean_object * has_level_param) {
    uint64_t result = lean_expr_mk_data(
        lean_unbox_uint64(hash),
        bvar_range,
        lean_unbox_uint32(approx_depth),
        static_cast<uint8_t>(lean_unbox(has_fvar)),
        static_cast<uint8_t>(lean_unbox(has_expr_mvar)),
        static_cast<uint8_t>(lean_unbox(has_level_mvar)),
        static_cast<uint8_t>(lean_unbox(has_level_param)));
    lean_dec(hash);
    lean_dec(bvar_range);
    lean_dec(approx_depth);
    lean_dec(has_fvar);
    lean_dec(has_expr_mvar);
    lean_dec(has_level_mvar);
    lean_dec(has_level_param);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_expr_mk_app_data___boxed(lean_object * f_data, lean_object * a_data) {
    uint64_t result = lean_expr_mk_app_data(lean_unbox_uint64(f_data), lean_unbox_uint64(a_data));
    lean_dec(f_data);
    lean_dec(a_data);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_expr_data___boxed(lean_object * expr) {
    uint64_t result = lean_expr_data(expr);
    lean_dec(expr);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_is_reserved_name___boxed(lean_object * env, lean_object * n) {
    lean::elab_environment ienv(lean_box(0));
    lean::options opts(lean_box(0));
    lean_object * args[] = { env, n };
    return lean::ir::run_boxed(ienv, opts, lean::name({ "Lean", "isReservedName" }), 2, args);
}

extern "C" lean_object * lean_eval_const___boxed(
    lean_object * type,
    lean_object * env,
    lean_object * opts,
    lean_object * const_name) {
    lean_dec(type);
    lean_object * result = lean_eval_const(env, opts, const_name);
    lean_dec(env);
    lean_dec(opts);
    lean_dec(const_name);
    return result;
}

extern "C" lean_object * lean_eval_check_meta___boxed(lean_object * env, lean_object * const_name) {
    lean_dec(env);
    lean_dec(const_name);
    lean_object * result = lean_alloc_ctor(1, 1, 0);
    lean_ctor_set(result, 0, lean_box(0));
    return result;
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
    X("Nat.mod", "lean_nat_mod", lean_nat_mod___boxed) \
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
    X("System.Platform.getNumBits", "lean_system_platform_nbits", lean_system_platform_nbits___boxed) \
    X("panicCore", "lean_panic_fn_borrowed", lean_panic_fn_borrowed___boxed) \
    X("ptrAddrUnsafe", "lean_ptr_addr", lean_ptr_addr___boxed) \
    X("IO.initializing", "lean_io_initializing", lean_io_initializing___boxed) \
    X("ST.Prim.mkRef", "lean_st_mk_ref", lean_st_mk_ref___boxed) \
    X("ST.Prim.Ref.get", "lean_st_ref_get", lean_st_ref_get___boxed) \
    X("ST.Prim.Ref.set", "lean_st_ref_set", lean_st_ref_set___boxed) \
    X("ST.Prim.Ref.take", "lean_st_ref_take", lean_st_ref_take___boxed) \
    X("_private.Lean.Environment.0.Lean.Environment.isReservedName", "lean_is_reserved_name", lean_is_reserved_name___boxed) \
    X("_private.Lean.Environment.0.Lean.Environment.evalConstCore", "lean_eval_const", lean_eval_const___boxed) \
    X("_private.Lean.Environment.0.Lean.Environment.evalCheckMeta", "lean_eval_check_meta", lean_eval_check_meta___boxed) \
    X("Task.pure", "lean_task_pure", lean_task_pure___boxed) \
    X("Task.get", "lean_task_get_own", lean_task_get_own___boxed) \
    X("Task.map", "lean_task_map", lean_task_map___boxed) \
    X("Array.mkEmpty", "lean_array_mk_empty", lean_array_mk_empty___boxed) \
    X("Array.emptyWithCapacity", "lean_array_mk_empty", lean_array_mk_empty___boxed) \
    X("Array.mk", "lean_array_mk", lean_array_mk___boxed) \
    X("Array.push", "lean_array_push", lean_array_push___boxed) \
    X("Array.toList", "lean_array_to_list", lean_array_to_list___boxed) \
    X("Array.size", "lean_array_get_size", lean_array_get_size___boxed) \
    X("Array.usize", "lean_array_size", lean_array_size___boxed) \
    X("Array.uget", "lean_array_uget", lean_array_uget___boxed) \
    X("Array.ugetBorrowed", "lean_array_uget_borrowed", lean_array_uget_borrowed___boxed) \
    X("Array.getInternal", "lean_array_fget", lean_array_fget___boxed) \
    X("Array.getInternalBorrowed", "lean_array_fget_borrowed", lean_array_fget_borrowed___boxed) \
    X("Array.get!Internal", "lean_array_get", lean_array_get___boxed) \
    X("Array.get!InternalBorrowed", "lean_array_get_borrowed", lean_array_get_borrowed___boxed) \
    X("Array.uset", "lean_array_uset", lean_array_uset___boxed) \
    X("Array.set", "lean_array_fset", lean_array_fset___boxed) \
    X("Array.set!", "lean_array_set", lean_array_set___boxed) \
    X("Array.pop", "lean_array_pop", lean_array_pop___boxed) \
    X("Array.replicate", "lean_mk_array", lean_mk_array___boxed) \
    X("Array.swapIfInBounds", "lean_array_swap", lean_array_swap___boxed) \
    X("Array.swap", "lean_array_fswap", lean_array_fswap___boxed) \
    X("ByteArray.mk", "lean_byte_array_mk", lean_byte_array_mk___boxed) \
    X_CONST("ByteArray.empty", "l_ByteArray_empty", &l_ByteArray_empty) \
    X("ByteArray.push", "lean_byte_array_push", lean_byte_array_push___boxed) \
    X("ByteArray.get!", "lean_byte_array_get", lean_byte_array_get___boxed) \
    X("ByteArray.get", "lean_byte_array_fget", lean_byte_array_fget___boxed) \
    X("ByteArray.set!", "lean_byte_array_set", lean_byte_array_set___boxed) \
    X("ByteArray.extract", "l_ByteArray_extract", l_ByteArray_extract___boxed) \
    X("ByteArray.size", "lean_byte_array_size", lean_byte_array_size___boxed) \
    X("ByteArray.validateUTF8", "lean_string_validate_utf8", lean_string_validate_utf8___boxed) \
    X("USize.ofNat", "lean_usize_of_nat", lean_usize_of_nat___boxed) \
    X("USize.ofNatLT", "l_USize_ofNatLT", l_USize_ofNatLT___boxed) \
    X("USize.add", "lean_usize_add", lean_usize_add___boxed) \
    X("USize.sub", "lean_usize_sub", lean_usize_sub___boxed) \
    X("USize.mul", "lean_usize_mul", lean_usize_mul___boxed) \
    X("USize.land", "lean_usize_land", lean_usize_land___boxed) \
    X("USize.shiftLeft", "lean_usize_shift_left", lean_usize_shift_left___boxed) \
    X("USize.shiftRight", "lean_usize_shift_right", lean_usize_shift_right___boxed) \
    X("USize.toNat", "lean_usize_to_nat", lean_usize_to_nat___boxed) \
    X("USize.decEq", "lean_usize_dec_eq", lean_usize_dec_eq___boxed) \
    X("USize.decLt", "lean_usize_dec_lt", lean_usize_dec_lt___boxed) \
    X("USize.decLe", "lean_usize_dec_le", lean_usize_dec_le___boxed) \
    X("USize.repr", "lean_string_of_usize", lean_string_of_usize___boxed) \
    X("String.append", "lean_string_append", lean_string_append___boxed) \
    X("String.Internal.append", "lean_string_append", lean_string_append___boxed) \
    X("String.ofList", "lean_string_mk", lean_string_mk___boxed) \
    X("String.toUTF8", "lean_string_to_utf8", lean_string_to_utf8___boxed) \
    X("String.ofByteArray", "lean_string_from_utf8_unchecked", lean_string_from_utf8_unchecked___boxed) \
    X("String.hash", "lean_string_hash", lean_string_hash___boxed) \
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
    X("String.Pos.Raw.next'", "lean_string_utf8_next_fast", lean_string_utf8_next_fast___boxed) \
    X("String.Internal.extract", "lean_string_utf8_extract", lean_string_utf8_extract___boxed) \
    X("String.extract", "lean_string_utf8_extract", lean_string_utf8_extract___boxed) \
    X("String.Pos.Raw.extract", "lean_string_utf8_extract", lean_string_utf8_extract___boxed) \
    X("String.Pos.Raw.prev", "lean_string_utf8_prev", lean_string_utf8_prev___boxed) \
    X("String.decodeChar", "lean_string_utf8_get_fast", lean_string_utf8_get_fast___boxed) \
    X("String.Pos.Raw.get", "lean_string_utf8_get", lean_string_utf8_get___boxed) \
    X("String.Pos.Raw.get'", "lean_string_utf8_get_fast", lean_string_utf8_get_fast___boxed) \
    X("String.Internal.atEnd", "lean_string_utf8_at_end", lean_string_utf8_at_end___boxed) \
    X("String.Pos.Raw.atEnd", "lean_string_utf8_at_end", lean_string_utf8_at_end___boxed) \
    X("String.Pos.Raw.isValid", "lean_string_is_valid_pos", lean_string_is_valid_pos___boxed) \
    X("String.Internal.contains", "lean_string_contains", lean_string_contains___boxed) \
    X("String.decEq", "lean_string_dec_eq", lean_string_dec_eq___boxed) \
    X("String.decidableLT", "lean_string_dec_lt", lean_string_dec_lt___boxed) \
    X("String.Slice.Pattern.Internal.memcmpStr", "lean_string_memcmp", lean_string_memcmp___boxed) \
    X("Substring.Raw.Internal.beq", "lean_substring_beq", lean_substring_beq___boxed) \
    X("Lean.Name.beq", "lean_name_eq", lean_name_eq___boxed) \
    X("UInt8.toNat", "lean_uint8_to_nat", lean_uint8_to_nat___boxed) \
    X("UInt8.toUInt32", "lean_uint8_to_uint32", lean_uint8_to_uint32___boxed) \
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
    X("UInt32.toUInt8", "lean_uint32_to_uint8", lean_uint32_to_uint8___boxed) \
    X("UInt32.toUInt64", "lean_uint32_to_uint64", lean_uint32_to_uint64___boxed) \
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
    X("mixHash", "lean_uint64_mix_hash", lean_uint64_mix_hash___boxed) \
    X("UInt64.ofNatLT", "l_UInt64_ofNatLT", l_UInt64_ofNatLT___boxed) \
    X("UInt64.toNat", "lean_uint64_to_nat", lean_uint64_to_nat___boxed) \
    X("UInt64.toUSize", "lean_uint64_to_usize", lean_uint64_to_usize___boxed) \
    X("UInt64.toUInt32", "lean_uint64_to_uint32", lean_uint64_to_uint32___boxed) \
    X("UInt64.toUInt8", "lean_uint64_to_uint8", lean_uint64_to_uint8___boxed) \
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
    X("Float.toUInt32", "lean_float_to_uint32", lean_float_to_uint32___boxed) \
    X("Lean.Level.mkData", "lean_level_mk_data", lean_level_mk_data___boxed) \
    X("Lean.Expr.mkData", "lean_expr_mk_data", lean_expr_mk_data___boxed) \
    X("Lean.Expr.mkAppData", "lean_expr_mk_app_data", lean_expr_mk_app_data___boxed) \
    X("Lean.Expr.data", "lean_expr_data", lean_expr_data___boxed)

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
    if (void * host_import = lean::vir::host_import_trampoline(sym)) {
        return host_import;
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

static object * mk_ctor_owned(unsigned tag, std::initializer_list<object *> fields, unsigned scalar_size = 0) {
    object * obj = lean_alloc_ctor(tag, fields.size(), scalar_size);
    unsigned idx = 0;
    for (object * field : fields) {
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

static std::string nat_to_decimal(object * value) {
    if (lean_is_scalar(value)) {
        return std::to_string(lean_unbox(value));
    }
    return mpz_value(value).to_string();
}

static object * mk_byte_array(uint8_t const * values, uint32_t len) {
    object * array = lean_alloc_sarray(1, len, len);
    if (len != 0) {
        memcpy(lean_sarray_cptr(array), values, len);
    }
    return array;
}

static name name_from_dotted(char const * text, size_t len);

extern "C" object * lean_level_mk_succ(obj_arg);
extern "C" object * lean_level_mk_mvar(obj_arg);
extern "C" object * lean_level_mk_param(obj_arg);
extern "C" object * lean_level_mk_max(obj_arg, obj_arg);
extern "C" object * lean_level_mk_imax(obj_arg, obj_arg);

extern "C" object * lean_expr_mk_bvar(obj_arg);
extern "C" object * lean_expr_mk_fvar(obj_arg);
extern "C" object * lean_expr_mk_mvar(obj_arg);
extern "C" object * lean_expr_mk_sort(obj_arg);
extern "C" object * lean_expr_mk_const(obj_arg, obj_arg);
extern "C" object * lean_expr_mk_app(obj_arg, obj_arg);
extern "C" object * lean_expr_mk_lambda(obj_arg, obj_arg, obj_arg, uint8_t);
extern "C" object * lean_expr_mk_forall(obj_arg, obj_arg, obj_arg, uint8_t);
extern "C" object * lean_expr_mk_let(obj_arg, obj_arg, obj_arg, obj_arg, uint8_t);
extern "C" object * lean_expr_mk_lit(obj_arg);
extern "C" object * lean_expr_mk_proj(obj_arg, obj_arg, obj_arg);

static object * mk_name_from_dotted_string(std::string const & text) {
    name n = name_from_dotted(text.data(), text.size());
    lean_inc(n.raw());
    return n.raw();
}

static std::string name_to_string(object * value) {
    return name(value, true).to_string();
}

enum class vir_wire_type : uint8_t {
    Unit = 21,
    Nat = 0,
    Int = 1,
    Bool = 2,
    String = 3,
    UInt8 = 4,
    UInt16 = 5,
    UInt32 = 6,
    UInt64 = 7,
    USize = 8,
    ByteArray = 9,
    Float = 10,
    Float32 = 11,
    Array = 16,
    List = 17,
    Option = 18,
    Prod = 19,
    Structure = 20,
    TaggedUnion = 21,
    SimpleEnum = 14,
    Expr = 15,
};

enum class vir_field_layout_kind : uint8_t {
    Object = 0,
    USize = 1,
    Scalar = 2,
};

struct vir_field_layout {
    vir_field_layout_kind kind;
    uint32_t index;
    uint32_t size;
    uint32_t offset;
};

struct vir_type {
    vir_wire_type tag;
    std::vector<vir_type> args;
    std::vector<vir_field_layout> field_layouts;
    std::vector<uint32_t> variant_object_fields;
    std::vector<uint32_t> variant_usize_fields;
    std::vector<uint32_t> variant_scalar_bytes;
    uint32_t object_fields = 0;
    uint32_t usize_fields = 0;
    uint32_t scalar_bytes = 0;
    uint32_t trivial_field = UINT32_MAX;
};

struct vir_arg {
    object * value = nullptr;
    bool owned = true;
};

class vir_reader {
    uint8_t const * m_data;
    uint32_t m_size;
    uint32_t m_pos = 0;
    std::string m_error;

public:
    bool ok = true;

    vir_reader(uint8_t const * data, uint32_t size):
        m_data(data),
        m_size(size) {
    }

    std::string const & error() const {
        return m_error;
    }

    uint8_t u8() {
        if (!ok) return 0;
        if (m_pos >= m_size) {
            fail("unexpected end of call payload");
            return 0;
        }
        return m_data[m_pos++];
    }

    uint32_t u32() {
        uint32_t b0 = u8();
        uint32_t b1 = u8();
        uint32_t b2 = u8();
        uint32_t b3 = u8();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    uint64_t u64() {
        uint64_t lo = u32();
        uint64_t hi = u32();
        return lo | (hi << 32);
    }

    double f64() {
        uint64_t bits = u64();
        double value = 0.0;
        memcpy(&value, &bits, sizeof(value));
        return value;
    }

    float f32() {
        uint32_t bits = u32();
        float value = 0.0f;
        memcpy(&value, &bits, sizeof(value));
        return value;
    }

    std::string string() {
        uint32_t len = u32();
        if (!ok) return std::string();
        if (len > m_size - m_pos) {
            fail("string length exceeds remaining call payload");
            return std::string();
        }
        std::string out(reinterpret_cast<char const *>(m_data + m_pos), len);
        m_pos += len;
        return out;
    }

    std::vector<uint8_t> bytes() {
        uint32_t len = u32();
        if (!ok) return {};
        if (len > m_size - m_pos) {
            fail("byte array length exceeds remaining call payload");
            return {};
        }
        std::vector<uint8_t> out(m_data + m_pos, m_data + m_pos + len);
        m_pos += len;
        return out;
    }

    bool at_end() const {
        return m_pos == m_size;
    }

    void fail(std::string const & message) {
        if (ok) {
            ok = false;
            m_error = message;
        }
    }
};

class vir_writer {
    std::string m_bytes;

public:
    void u8(uint8_t value) {
        m_bytes.push_back(static_cast<char>(value));
    }

    void u32(uint32_t value) {
        m_bytes.push_back(static_cast<char>(value & 0xff));
        m_bytes.push_back(static_cast<char>((value >> 8) & 0xff));
        m_bytes.push_back(static_cast<char>((value >> 16) & 0xff));
        m_bytes.push_back(static_cast<char>((value >> 24) & 0xff));
    }

    void u64(uint64_t value) {
        u32(static_cast<uint32_t>(value & 0xffffffff));
        u32(static_cast<uint32_t>(value >> 32));
    }

    void f64(double value) {
        uint64_t bits = 0;
        memcpy(&bits, &value, sizeof(bits));
        u64(bits);
    }

    void f32(float value) {
        uint32_t bits = 0;
        memcpy(&bits, &value, sizeof(bits));
        u32(bits);
    }

    void string(std::string const & value) {
        u32(static_cast<uint32_t>(value.size()));
        m_bytes.append(value);
    }

    void bytes(uint8_t const * ptr, uint32_t len) {
        u32(len);
        if (len != 0) {
            m_bytes.append(reinterpret_cast<char const *>(ptr), len);
        }
    }

    std::string take() {
        return std::move(m_bytes);
    }
};

static bool parse_u64(std::string const & text, uint64_t & out) {
    if (text.empty()) return false;
    uint64_t value = 0;
    for (char c : text) {
        if (c < '0' || c > '9') return false;
        uint64_t digit = static_cast<uint64_t>(c - '0');
        if (value > (std::numeric_limits<uint64_t>::max() - digit) / 10) {
            return false;
        }
        value = value * 10 + digit;
    }
    out = value;
    return true;
}

static object * mk_list_from_reversed(std::vector<object *> const & values) {
    object * out = lean_box(0);
    for (object * value : values) {
        object * cons = lean_alloc_ctor(1, 2, 0);
        lean_inc(value);
        lean_ctor_set(cons, 0, value);
        lean_ctor_set(cons, 1, out);
        out = cons;
    }
    return out;
}

static object * decode_level(vir_reader & r);
static object * decode_expr(vir_reader & r);
static void encode_level(vir_writer & w, object * value);
static void encode_expr_payload(vir_writer & w, object * value);

static bool is_known_wire_type(vir_wire_type tag) {
    switch (tag) {
    case vir_wire_type::Unit:
    case vir_wire_type::Nat:
    case vir_wire_type::Int:
    case vir_wire_type::Bool:
    case vir_wire_type::String:
    case vir_wire_type::UInt8:
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
    case vir_wire_type::UInt64:
    case vir_wire_type::USize:
    case vir_wire_type::ByteArray:
    case vir_wire_type::Float:
    case vir_wire_type::Float32:
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
    case vir_wire_type::Prod:
    case vir_wire_type::Structure:
    case vir_wire_type::TaggedUnion:
    case vir_wire_type::SimpleEnum:
    case vir_wire_type::Expr:
        return true;
    default:
        return false;
    }
}

static bool is_known_field_layout(vir_field_layout_kind kind) {
    switch (kind) {
    case vir_field_layout_kind::Object:
    case vir_field_layout_kind::USize:
    case vir_field_layout_kind::Scalar:
        return true;
    default:
        return false;
    }
}

static vir_field_layout decode_field_layout(vir_reader & r) {
    vir_field_layout layout {
        static_cast<vir_field_layout_kind>(r.u8()),
        r.u32(),
        r.u32(),
        r.u32(),
    };
    if (!is_known_field_layout(layout.kind)) {
        r.fail("unsupported structure field layout tag " + std::to_string(static_cast<uint8_t>(layout.kind)));
    }
    return layout;
}

static void encode_field_layout(vir_writer & w, vir_field_layout const & layout) {
    w.u8(static_cast<uint8_t>(layout.kind));
    w.u32(layout.index);
    w.u32(layout.size);
    w.u32(layout.offset);
}

static vir_type decode_type(vir_reader & r) {
    vir_type type { static_cast<vir_wire_type>(r.u8()), {} };
    if (!is_known_wire_type(type.tag)) {
        r.fail("unsupported wire type tag " + std::to_string(static_cast<uint8_t>(type.tag)));
        return { vir_wire_type::Nat, {} };
    }
    switch (type.tag) {
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
        type.args.push_back(decode_type(r));
        break;
    case vir_wire_type::Prod:
        type.args.push_back(decode_type(r));
        type.args.push_back(decode_type(r));
        break;
    case vir_wire_type::Structure: {
        type.object_fields = r.u32();
        type.usize_fields = r.u32();
        type.scalar_bytes = r.u32();
        type.trivial_field = r.u32();
        uint32_t field_count = r.u32();
        type.args.reserve(field_count);
        type.field_layouts.reserve(field_count);
        for (uint32_t i = 0; i < field_count; i++) {
            type.field_layouts.push_back(decode_field_layout(r));
            type.args.push_back(decode_type(r));
        }
        if (type.trivial_field != UINT32_MAX && type.trivial_field >= field_count) {
            r.fail("structure trivial field index is out of range");
        }
        break;
    }
    case vir_wire_type::TaggedUnion: {
        uint32_t variant_count = r.u32();
        type.args.reserve(variant_count);
        type.field_layouts.reserve(variant_count);
        type.variant_object_fields.reserve(variant_count);
        type.variant_usize_fields.reserve(variant_count);
        type.variant_scalar_bytes.reserve(variant_count);
        for (uint32_t i = 0; i < variant_count; i++) {
            type.variant_object_fields.push_back(r.u32());
            type.variant_usize_fields.push_back(r.u32());
            type.variant_scalar_bytes.push_back(r.u32());
            type.field_layouts.push_back(decode_field_layout(r));
            type.args.push_back(decode_type(r));
        }
        if (variant_count == 0) {
            r.fail("tagged union has no constructors");
        }
        break;
    }
    default:
        break;
    }
    return type;
}

static void encode_type(vir_writer & w, vir_type const & type) {
    w.u8(static_cast<uint8_t>(type.tag));
    switch (type.tag) {
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
        encode_type(w, type.args[0]);
        break;
    case vir_wire_type::Prod:
        encode_type(w, type.args[0]);
        encode_type(w, type.args[1]);
        break;
    case vir_wire_type::Structure:
        w.u32(type.object_fields);
        w.u32(type.usize_fields);
        w.u32(type.scalar_bytes);
        w.u32(type.trivial_field);
        w.u32(static_cast<uint32_t>(type.args.size()));
        for (size_t i = 0; i < type.args.size(); i++) {
            encode_field_layout(w, type.field_layouts[i]);
            encode_type(w, type.args[i]);
        }
        break;
    case vir_wire_type::TaggedUnion:
        w.u32(static_cast<uint32_t>(type.args.size()));
        for (size_t i = 0; i < type.args.size(); i++) {
            w.u32(type.variant_object_fields[i]);
            w.u32(type.variant_usize_fields[i]);
            w.u32(type.variant_scalar_bytes[i]);
            encode_field_layout(w, type.field_layouts[i]);
            encode_type(w, type.args[i]);
        }
        break;
    default:
        break;
    }
}

static object * decode_level_list(vir_reader & r) {
    uint32_t len = r.u32();
    std::vector<object *> values;
    values.reserve(len);
    for (uint32_t i = 0; i < len; i++) {
        values.push_back(decode_level(r));
    }
    std::reverse(values.begin(), values.end());
    object * out = mk_list_from_reversed(values);
    for (object * value : values) lean_dec(value);
    return out;
}

static void encode_level_list(vir_writer & w, object * value) {
    std::vector<object *> values;
    object * cursor = value;
    while (!lean_is_scalar(cursor)) {
        values.push_back(lean_ctor_get(cursor, 0));
        cursor = lean_ctor_get(cursor, 1);
    }
    w.u32(static_cast<uint32_t>(values.size()));
    for (object * level : values) {
        encode_level(w, level);
    }
}

static object * decode_level(vir_reader & r) {
    uint8_t tag = r.u8();
    switch (tag) {
    case 0:
        return lean_box(0);
    case 1:
        return lean_level_mk_succ(decode_level(r));
    case 2: {
        object * lhs = decode_level(r);
        object * rhs = decode_level(r);
        return lean_level_mk_max(lhs, rhs);
    }
    case 3: {
        object * lhs = decode_level(r);
        object * rhs = decode_level(r);
        return lean_level_mk_imax(lhs, rhs);
    }
    case 4: {
        std::string text = r.string();
        return lean_level_mk_param(mk_name_from_dotted_string(text));
    }
    case 5: {
        std::string text = r.string();
        return lean_level_mk_mvar(mk_name_from_dotted_string(text));
    }
    default:
        r.fail("unsupported Lean.Level wire tag " + std::to_string(tag));
        return lean_box(0);
    }
}

static void encode_level(vir_writer & w, object * value) {
    if (lean_is_scalar(value)) {
        w.u8(0);
        return;
    }
    level lvl(value, true);
    switch (lvl.kind()) {
    case level_kind::Succ:
        w.u8(1);
        encode_level(w, succ_of(lvl).raw());
        break;
    case level_kind::Max:
        w.u8(2);
        encode_level(w, max_lhs(lvl).raw());
        encode_level(w, max_rhs(lvl).raw());
        break;
    case level_kind::IMax:
        w.u8(3);
        encode_level(w, imax_lhs(lvl).raw());
        encode_level(w, imax_rhs(lvl).raw());
        break;
    case level_kind::Param:
        w.u8(4);
        w.string(param_id(lvl).to_string());
        break;
    case level_kind::MVar:
        w.u8(5);
        w.string(mvar_id(lvl).to_string());
        break;
    case level_kind::Zero:
        w.u8(0);
        break;
    }
}

static uint8_t expr_scalar_u8(object * value, unsigned object_fields) {
    if (lean_ctor_num_objs(value) > object_fields) {
        return static_cast<uint8_t>(lean_unbox(lean_ctor_get(value, object_fields)));
    }
    return lean_ctor_get_uint8(value, lean_ctor_num_objs(value) * sizeof(void *) + sizeof(uint64_t));
}

static object * decode_literal(vir_reader & r) {
    uint8_t tag = r.u8();
    switch (tag) {
    case 0: {
        std::string text = r.string();
        return mk_ctor_owned(0, { lean_cstr_to_nat(text.c_str()) });
    }
    case 1: {
        std::string text = r.string();
        return mk_ctor_owned(1, { lean_mk_string_from_bytes(text.data(), text.size()) });
    }
    default:
        r.fail("unsupported Lean.Literal wire tag " + std::to_string(tag));
        return mk_ctor_owned(0, { lean_box(0) });
    }
}

static void encode_literal(vir_writer & w, object * value) {
    uint8_t tag = lean_obj_tag(value);
    w.u8(tag);
    if (tag == 0) {
        w.string(nat_to_decimal(lean_ctor_get(value, 0)));
    } else if (tag == 1) {
        object * text = lean_ctor_get(value, 0);
        size_t size = lean_string_size(text);
        uint32_t len = static_cast<uint32_t>(size == 0 ? 0 : size - 1);
        w.bytes(reinterpret_cast<uint8_t const *>(lean_string_cstr(text)), len);
    }
}

static object * decode_expr(vir_reader & r) {
    uint8_t tag = r.u8();
    switch (tag) {
    case 0: {
        std::string text = r.string();
        return lean_expr_mk_bvar(lean_cstr_to_nat(text.c_str()));
    }
    case 1: {
        std::string text = r.string();
        return lean_expr_mk_fvar(mk_name_from_dotted_string(text));
    }
    case 2: {
        std::string text = r.string();
        return lean_expr_mk_mvar(mk_name_from_dotted_string(text));
    }
    case 3:
        return lean_expr_mk_sort(decode_level(r));
    case 4: {
        object * name = mk_name_from_dotted_string(r.string());
        object * levels = decode_level_list(r);
        return lean_expr_mk_const(name, levels);
    }
    case 5: {
        object * fn = decode_expr(r);
        object * arg = decode_expr(r);
        return lean_expr_mk_app(fn, arg);
    }
    case 6: {
        object * name = mk_name_from_dotted_string(r.string());
        object * type = decode_expr(r);
        object * body = decode_expr(r);
        return lean_expr_mk_lambda(name, type, body, r.u8());
    }
    case 7: {
        object * name = mk_name_from_dotted_string(r.string());
        object * type = decode_expr(r);
        object * body = decode_expr(r);
        return lean_expr_mk_forall(name, type, body, r.u8());
    }
    case 8: {
        object * name = mk_name_from_dotted_string(r.string());
        object * type = decode_expr(r);
        object * value = decode_expr(r);
        object * body = decode_expr(r);
        return lean_expr_mk_let(name, type, value, body, r.u8());
    }
    case 9:
        return lean_expr_mk_lit(decode_literal(r));
    case 10:
        return decode_expr(r);
    case 11: {
        object * type_name = mk_name_from_dotted_string(r.string());
        std::string idx_text = r.string();
        object * idx = lean_cstr_to_nat(idx_text.c_str());
        object * structure = decode_expr(r);
        return lean_expr_mk_proj(type_name, idx, structure);
    }
    default:
        r.fail("unsupported Lean.Expr wire tag " + std::to_string(tag));
        return lean_expr_mk_bvar(lean_box(0));
    }
}

static uint32_t scalar_field_base(uint32_t object_fields, uint32_t usize_fields) {
    return (object_fields + usize_fields) * sizeof(void *);
}

static uint32_t structure_scalar_base(vir_type const & type) {
    return scalar_field_base(type.object_fields, type.usize_fields);
}

static void set_scalar_field(
    vir_reader & r,
    object * obj,
    uint32_t scalar_base,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * field_value) {
    uint32_t offset = scalar_base + layout.offset;
    switch (field_type.tag) {
    case vir_wire_type::Bool:
    case vir_wire_type::UInt8:
    case vir_wire_type::SimpleEnum:
        if (layout.size == 1) {
            lean_ctor_set_uint8(obj, offset, static_cast<uint8_t>(lean_unbox(field_value)));
            break;
        }
        if (layout.size == 2) {
            lean_ctor_set_uint16(obj, offset, static_cast<uint16_t>(lean_unbox(field_value)));
            break;
        }
        if (layout.size == 4) {
            lean_ctor_set_uint32(obj, offset, static_cast<uint32_t>(lean_unbox(field_value)));
            break;
        }
        r.fail("unsupported structure enum scalar size " + std::to_string(layout.size));
        break;
    case vir_wire_type::UInt16:
        lean_ctor_set_uint16(obj, offset, static_cast<uint16_t>(lean_unbox(field_value)));
        break;
    case vir_wire_type::UInt32:
        lean_ctor_set_uint32(obj, offset, lean_unbox_uint32(field_value));
        break;
    case vir_wire_type::UInt64:
        lean_ctor_set_uint64(obj, offset, lean_unbox_uint64(field_value));
        break;
    case vir_wire_type::Float:
        lean_ctor_set_float(obj, offset, lean_unbox_float(field_value));
        break;
    case vir_wire_type::Float32:
        lean_ctor_set_float32(obj, offset, lean_unbox_float32(field_value));
        break;
    default:
        r.fail("structure scalar field has non-scalar wire type");
        break;
    }
}

static void set_structure_scalar_field(
    vir_reader & r,
    object * obj,
    vir_type const & structure_type,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * field_value) {
    set_scalar_field(r, obj, structure_scalar_base(structure_type), field_type, layout, field_value);
}

static object * decode_value(vir_reader & r, vir_type const & type) {
    switch (type.tag) {
    case vir_wire_type::Unit:
        return lean_box(0);
    case vir_wire_type::Nat: {
        std::string text = r.string();
        return lean_cstr_to_nat(text.c_str());
    }
    case vir_wire_type::Int: {
        std::string text = r.string();
        return lean_cstr_to_int(text.c_str());
    }
    case vir_wire_type::Bool:
        return lean_box(r.u8() ? 1 : 0);
    case vir_wire_type::String: {
        std::string text = r.string();
        return lean_mk_string_from_bytes(text.data(), text.size());
    }
    case vir_wire_type::UInt8:
        return lean_box(r.u8());
    case vir_wire_type::UInt16:
        return lean_box(static_cast<uint16_t>(r.u32()));
    case vir_wire_type::UInt32:
        return lean_box_uint32(r.u32());
    case vir_wire_type::UInt64: {
        uint64_t value = 0;
        if (!parse_u64(r.string(), value)) {
            r.fail("invalid UInt64 decimal argument");
            return lean_box_uint64(0);
        }
        return lean_box_uint64(value);
    }
    case vir_wire_type::USize: {
        uint64_t value = 0;
        if (!parse_u64(r.string(), value) || value > std::numeric_limits<size_t>::max()) {
            r.fail("invalid USize decimal argument");
            return lean_box_usize(0);
        }
        return lean_box_usize(static_cast<size_t>(value));
    }
    case vir_wire_type::ByteArray: {
        std::vector<uint8_t> values = r.bytes();
        return mk_byte_array(values.data(), static_cast<uint32_t>(values.size()));
    }
    case vir_wire_type::Float:
        return lean_box_float(r.f64());
    case vir_wire_type::Float32:
        return lean_box_float32(r.f32());
    case vir_wire_type::Array: {
        uint32_t len = r.u32();
        object * array = lean_alloc_array(len, len);
        for (uint32_t i = 0; i < len; i++) {
            lean_array_set_core(array, i, decode_value(r, type.args[0]));
        }
        return array;
    }
    case vir_wire_type::List: {
        uint32_t len = r.u32();
        std::vector<object *> values;
        values.reserve(len);
        for (uint32_t i = 0; i < len; i++) {
            values.push_back(decode_value(r, type.args[0]));
        }
        std::reverse(values.begin(), values.end());
        object * out = mk_list_from_reversed(values);
        for (object * value : values) lean_dec(value);
        return out;
    }
    case vir_wire_type::Option: {
        if (r.u8() == 0) return lean_box(0);
        return mk_ctor_owned(1, { decode_value(r, type.args[0]) });
    }
    case vir_wire_type::Prod: {
        object * fst = decode_value(r, type.args[0]);
        object * snd = decode_value(r, type.args[1]);
        return mk_ctor_owned(0, { fst, snd });
    }
    case vir_wire_type::Structure: {
        if (type.trivial_field != UINT32_MAX) {
            return decode_value(r, type.args[type.trivial_field]);
        }
        object * obj = lean_alloc_ctor(
            0,
            type.object_fields,
            type.usize_fields * sizeof(size_t) + type.scalar_bytes);
        for (size_t i = 0; i < type.args.size(); i++) {
            vir_type const & field_type = type.args[i];
            vir_field_layout const & layout = type.field_layouts[i];
            object * field_value = decode_value(r, field_type);
            switch (layout.kind) {
            case vir_field_layout_kind::Object:
                lean_ctor_set(obj, layout.index, field_value);
                break;
            case vir_field_layout_kind::USize:
                if (field_type.tag != vir_wire_type::USize) {
                    r.fail("structure usize field has non-USize wire type");
                } else {
                    lean_ctor_set_usize(obj, layout.index, lean_unbox_usize(field_value));
                }
                lean_dec(field_value);
                break;
            case vir_field_layout_kind::Scalar:
                set_structure_scalar_field(r, obj, type, field_type, layout, field_value);
                lean_dec(field_value);
                break;
            }
        }
        return obj;
    }
    case vir_wire_type::TaggedUnion: {
        uint32_t tag = r.u32();
        if (tag >= type.args.size()) {
            r.fail("tagged union constructor index is out of range");
            return lean_box(0);
        }
        vir_type const & field_type = type.args[tag];
        vir_field_layout const & layout = type.field_layouts[tag];
        object * field_value = decode_value(r, field_type);
        object * obj = lean_alloc_ctor(
            tag,
            type.variant_object_fields[tag],
            type.variant_usize_fields[tag] * sizeof(size_t) + type.variant_scalar_bytes[tag]);
        switch (layout.kind) {
        case vir_field_layout_kind::Object:
            lean_ctor_set(obj, layout.index, field_value);
            break;
        case vir_field_layout_kind::USize:
            if (field_type.tag != vir_wire_type::USize) {
                r.fail("tagged union usize field has non-USize wire type");
            } else {
                lean_ctor_set_usize(obj, layout.index, lean_unbox_usize(field_value));
            }
            lean_dec(field_value);
            break;
        case vir_field_layout_kind::Scalar:
            set_scalar_field(
                r,
                obj,
                scalar_field_base(type.variant_object_fields[tag], type.variant_usize_fields[tag]),
                field_type,
                layout,
                field_value);
            lean_dec(field_value);
            break;
        }
        return obj;
    }
    case vir_wire_type::SimpleEnum:
        return lean_box(r.u32());
    case vir_wire_type::Expr:
        return decode_expr(r);
    default:
        r.fail("unsupported wire argument tag " + std::to_string(static_cast<uint8_t>(type.tag)));
        return lean_box(0);
    }
}

static bool is_unboxed_call_boundary_type(vir_type const & type) {
    switch (type.tag) {
    case vir_wire_type::UInt8:
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
    case vir_wire_type::USize:
        return true;
    default:
        return false;
    }
}

static bool is_unboxed_call_boundary_type(vir_type const & type, vir_type const ** field_type) {
    if (is_unboxed_call_boundary_type(type)) {
        *field_type = &type;
        return true;
    }
    if (type.tag == vir_wire_type::Structure && type.trivial_field != UINT32_MAX) {
        vir_type const & trivial_type = type.args[type.trivial_field];
        if (is_unboxed_call_boundary_type(trivial_type)) {
            *field_type = &trivial_type;
            return true;
        }
    }
    return false;
}

static bool needs_boxed_wasm32_call_boundary_type(vir_type const & type) {
    if (
        type.tag == vir_wire_type::Float ||
        type.tag == vir_wire_type::Float32 ||
        type.tag == vir_wire_type::UInt64) {
        return true;
    }
    if (type.tag == vir_wire_type::Structure && type.trivial_field != UINT32_MAX) {
        return needs_boxed_wasm32_call_boundary_type(type.args[type.trivial_field]);
    }
    return false;
}

static object * decode_unboxed_call_argument(vir_reader & r, vir_type const & type) {
    uintptr_t value = 0;
    switch (type.tag) {
    case vir_wire_type::UInt8:
        value = r.u8();
        break;
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
        value = r.u32();
        break;
    case vir_wire_type::USize: {
        uint64_t parsed = 0;
        if (!parse_u64(r.string(), parsed) || parsed > std::numeric_limits<uintptr_t>::max()) {
            r.fail("invalid USize trivial structure argument");
            return nullptr;
        }
        value = static_cast<uintptr_t>(parsed);
        break;
    }
    default:
        lean_unreachable();
    }
    return reinterpret_cast<object *>(value);
}

static void encode_unboxed_call_result(vir_writer & w, vir_type const & type, object * value) {
    uintptr_t raw = reinterpret_cast<uintptr_t>(value);
    switch (type.tag) {
    case vir_wire_type::UInt8:
        w.u8(static_cast<uint8_t>(raw));
        break;
    case vir_wire_type::UInt16:
        w.u32(static_cast<uint16_t>(raw));
        break;
    case vir_wire_type::UInt32:
        w.u32(static_cast<uint32_t>(raw));
        break;
    case vir_wire_type::USize:
        w.string(std::to_string(raw));
        break;
    default:
        lean_unreachable();
    }
}

static vir_arg decode_argument(vir_reader & r, bool has_boxed_decl) {
    vir_type type = decode_type(r);
    if (!r.ok) return { lean_box(0), true };
    if (!has_boxed_decl && needs_boxed_wasm32_call_boundary_type(type)) {
        r.fail("top-level Float, Float32, UInt64, and trivial wrappers over them require a boxed declaration at the wasm32 interpreter boundary");
        return { lean_box(0), true };
    }
    vir_type const * unboxed_type = nullptr;
    if (!has_boxed_decl && is_unboxed_call_boundary_type(type, &unboxed_type)) {
        return { decode_unboxed_call_argument(r, *unboxed_type), false };
    }
    return { decode_value(r, type), true };
}

static std::string int_to_decimal(object * value) {
    if (lean_is_scalar(value)) {
        return std::to_string(lean_scalar_to_int(value));
    }
    return mpz_value(value).to_string();
}

static void encode_nat_payload(vir_writer & w, object * value) {
    w.string(nat_to_decimal(value));
}

static void encode_string_payload(vir_writer & w, object * value) {
    size_t size = lean_string_size(value);
    uint32_t len = static_cast<uint32_t>(size == 0 ? 0 : size - 1);
    w.bytes(reinterpret_cast<uint8_t const *>(lean_string_cstr(value)), len);
}

static void encode_expr_payload(vir_writer & w, object * value) {
    expr e(value, true);
    switch (e.kind()) {
    case expr_kind::BVar:
        w.u8(0);
        w.string(nat_to_decimal(lean_ctor_get(value, 0)));
        break;
    case expr_kind::FVar:
        w.u8(1);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        break;
    case expr_kind::MVar:
        w.u8(2);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        break;
    case expr_kind::Sort:
        w.u8(3);
        encode_level(w, lean_ctor_get(value, 0));
        break;
    case expr_kind::Const:
        w.u8(4);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_level_list(w, lean_ctor_get(value, 1));
        break;
    case expr_kind::App:
        w.u8(5);
        encode_expr_payload(w, lean_ctor_get(value, 0));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        break;
    case expr_kind::Lambda:
        w.u8(6);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        w.u8(expr_scalar_u8(value, 3));
        break;
    case expr_kind::Pi:
        w.u8(7);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        w.u8(expr_scalar_u8(value, 3));
        break;
    case expr_kind::Let:
        w.u8(8);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        encode_expr_payload(w, lean_ctor_get(value, 1));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        encode_expr_payload(w, lean_ctor_get(value, 3));
        w.u8(expr_scalar_u8(value, 4));
        break;
    case expr_kind::Lit:
        w.u8(9);
        encode_literal(w, lean_ctor_get(value, 0));
        break;
    case expr_kind::MData:
        w.u8(10);
        encode_expr_payload(w, lean_ctor_get(value, 1));
        break;
    case expr_kind::Proj:
        w.u8(11);
        w.string(name_to_string(lean_ctor_get(value, 0)));
        w.string(nat_to_decimal(lean_ctor_get(value, 1)));
        encode_expr_payload(w, lean_ctor_get(value, 2));
        break;
    }
}

static object * scalar_field_as_object(
    uint32_t scalar_base,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * value) {
    uint32_t offset = scalar_base + layout.offset;
    switch (field_type.tag) {
    case vir_wire_type::Bool:
    case vir_wire_type::UInt8:
        return lean_box(lean_ctor_get_uint8(value, offset));
    case vir_wire_type::UInt16:
        return lean_box(lean_ctor_get_uint16(value, offset));
    case vir_wire_type::UInt32:
        return lean_box_uint32(lean_ctor_get_uint32(value, offset));
    case vir_wire_type::UInt64:
        return lean_box_uint64(lean_ctor_get_uint64(value, offset));
    case vir_wire_type::Float:
        return lean_box_float(lean_ctor_get_float(value, offset));
    case vir_wire_type::Float32:
        return lean_box_float32(lean_ctor_get_float32(value, offset));
    case vir_wire_type::SimpleEnum:
        if (layout.size == 1) return lean_box(lean_ctor_get_uint8(value, offset));
        if (layout.size == 2) return lean_box(lean_ctor_get_uint16(value, offset));
        if (layout.size == 4) return lean_box(lean_ctor_get_uint32(value, offset));
        if (layout.size == 8) return lean_box_uint64(lean_ctor_get_uint64(value, offset));
        return lean_box(0);
    default:
        return lean_box(0);
    }
}

static object * structure_scalar_field_as_object(
    vir_type const & structure_type,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * value) {
    return scalar_field_as_object(structure_scalar_base(structure_type), field_type, layout, value);
}

static object * structure_field_as_object(
    vir_type const & structure_type,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * value,
    bool & borrowed) {
    switch (layout.kind) {
    case vir_field_layout_kind::Object:
        borrowed = true;
        return lean_ctor_get(value, layout.index);
    case vir_field_layout_kind::USize:
        borrowed = false;
        return lean_box_usize(lean_ctor_get_usize(value, layout.index));
    case vir_field_layout_kind::Scalar:
        borrowed = false;
        return structure_scalar_field_as_object(structure_type, field_type, layout, value);
    }
    borrowed = false;
    return lean_box(0);
}

static object * tagged_union_field_as_object(
    vir_type const & type,
    uint32_t tag,
    vir_type const & field_type,
    vir_field_layout const & layout,
    object * value,
    bool & borrowed) {
    switch (layout.kind) {
    case vir_field_layout_kind::Object:
        borrowed = true;
        return lean_ctor_get(value, layout.index);
    case vir_field_layout_kind::USize:
        borrowed = false;
        return lean_box_usize(lean_ctor_get_usize(value, layout.index));
    case vir_field_layout_kind::Scalar:
        borrowed = false;
        return scalar_field_as_object(
            scalar_field_base(type.variant_object_fields[tag], type.variant_usize_fields[tag]),
            field_type,
            layout,
            value);
    }
    borrowed = false;
    return lean_box(0);
}

static void encode_value_payload(vir_writer & w, vir_type const & type, object * value) {
    switch (type.tag) {
    case vir_wire_type::Unit:
        (void)w;
        (void)value;
        break;
    case vir_wire_type::Nat:
        encode_nat_payload(w, value);
        break;
    case vir_wire_type::Int:
        w.string(int_to_decimal(value));
        break;
    case vir_wire_type::Bool:
        w.u8(lean_unbox(value) ? 1 : 0);
        break;
    case vir_wire_type::String:
        encode_string_payload(w, value);
        break;
    case vir_wire_type::UInt8:
        w.u8(static_cast<uint8_t>(lean_unbox(value)));
        break;
    case vir_wire_type::UInt16:
        w.u32(static_cast<uint32_t>(lean_unbox(value)));
        break;
    case vir_wire_type::UInt32:
        w.u32(lean_unbox_uint32(value));
        break;
    case vir_wire_type::UInt64:
        w.string(std::to_string(lean_unbox_uint64(value)));
        break;
    case vir_wire_type::USize:
        w.string(std::to_string(lean_unbox_usize(value)));
        break;
    case vir_wire_type::ByteArray:
        w.bytes(lean_sarray_cptr(value), static_cast<uint32_t>(lean_sarray_size(value)));
        break;
    case vir_wire_type::Float:
        w.f64(lean_unbox_float(value));
        break;
    case vir_wire_type::Float32:
        w.f32(lean_unbox_float32(value));
        break;
    case vir_wire_type::Array: {
        uint32_t len = static_cast<uint32_t>(lean_array_size(value));
        w.u32(len);
        for (uint32_t i = 0; i < len; i++) {
            encode_value_payload(w, type.args[0], lean_array_get_core(value, i));
        }
        break;
    }
    case vir_wire_type::List: {
        std::vector<object *> values;
        object * cursor = value;
        while (!lean_is_scalar(cursor)) {
            values.push_back(lean_ctor_get(cursor, 0));
            cursor = lean_ctor_get(cursor, 1);
        }
        w.u32(static_cast<uint32_t>(values.size()));
        for (object * elem : values) {
            encode_value_payload(w, type.args[0], elem);
        }
        break;
    }
    case vir_wire_type::Option:
        if (lean_is_scalar(value)) {
            w.u8(0);
        } else {
            w.u8(1);
            encode_value_payload(w, type.args[0], lean_ctor_get(value, 0));
        }
        break;
    case vir_wire_type::Prod:
        encode_value_payload(w, type.args[0], lean_ctor_get(value, 0));
        encode_value_payload(w, type.args[1], lean_ctor_get(value, 1));
        break;
    case vir_wire_type::Structure:
        if (type.trivial_field != UINT32_MAX) {
            encode_value_payload(w, type.args[type.trivial_field], value);
            break;
        }
        for (size_t i = 0; i < type.args.size(); i++) {
            bool borrowed = false;
            object * field = structure_field_as_object(type, type.args[i], type.field_layouts[i], value, borrowed);
            encode_value_payload(w, type.args[i], field);
            if (!borrowed) lean_dec(field);
        }
        break;
    case vir_wire_type::TaggedUnion: {
        uint32_t tag = lean_obj_tag(value);
        if (tag >= type.args.size()) {
            w.u32(tag);
            break;
        }
        w.u32(tag);
        bool borrowed = false;
        object * field = tagged_union_field_as_object(type, tag, type.args[tag], type.field_layouts[tag], value, borrowed);
        encode_value_payload(w, type.args[tag], field);
        if (!borrowed) lean_dec(field);
        break;
    }
    case vir_wire_type::SimpleEnum:
        w.u32(static_cast<uint32_t>(lean_is_scalar(value) ? lean_unbox(value) : lean_obj_tag(value)));
        break;
    case vir_wire_type::Expr:
        encode_expr_payload(w, value);
        break;
    default:
        break;
    }
}

static void encode_result(vir_writer & w, vir_type const & type, object * value, bool has_boxed_decl) {
    encode_type(w, type);
    vir_type const * unboxed_type = nullptr;
    if (!has_boxed_decl && is_unboxed_call_boundary_type(type, &unboxed_type)) {
        encode_unboxed_call_result(w, *unboxed_type, value);
    } else {
        encode_value_payload(w, type, value);
    }
}

static bool call_result_is_owned(vir_type const & type, bool has_boxed_decl) {
    vir_type const * unboxed_type = nullptr;
    return has_boxed_decl || !is_unboxed_call_boundary_type(type, &unboxed_type);
}

static bool same_wire_type(vir_type const & lhs, vir_type const & rhs) {
    if (lhs.tag != rhs.tag || lhs.args.size() != rhs.args.size()) {
        return false;
    }
    for (size_t i = 0; i < lhs.args.size(); i++) {
        if (!same_wire_type(lhs.args[i], rhs.args[i])) {
            return false;
        }
    }
    return true;
}

struct host_signature {
    bool ok = false;
    std::string error;
    std::vector<vir_type> args;
    vir_type result { vir_wire_type::Unit, {} };
};

static host_signature decode_host_signature(uint32_t slot) {
    char const * data = vir::host_import_signature(slot);
    uint32_t size = vir::host_import_signature_size(slot);
    if (data == nullptr) {
        return { false, "missing JavaScript import signature", {}, { vir_wire_type::Unit, {} } };
    }
    vir_reader reader(reinterpret_cast<uint8_t const *>(data), size);
    uint32_t argc = reader.u32();
    std::vector<vir_type> args;
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(decode_type(reader));
    }
    vir_type result = decode_type(reader);
    if (!reader.ok) {
        return { false, reader.error(), {}, { vir_wire_type::Unit, {} } };
    }
    if (!reader.at_end()) {
        return { false, "trailing bytes after JavaScript import signature", {}, { vir_wire_type::Unit, {} } };
    }
    return { true, "", args, result };
}

static object * decode_host_result(vir_type const & expected, char const * bytes, uint32_t size) {
    vir_reader reader(reinterpret_cast<uint8_t const *>(bytes), size);
    vir_type actual = decode_type(reader);
    if (!reader.ok) {
        return lean_box(0);
    }
    if (!same_wire_type(expected, actual)) {
        reader.fail("JavaScript import result type mismatch");
        return lean_box(0);
    }
    object * value = decode_value(reader, expected);
    if (!reader.ok || !reader.at_end()) {
        lean_dec(value);
        return lean_box(0);
    }
    return value;
}

static object * call_js_import(uint32_t slot, uint32_t argc, object ** args) {
    host_signature signature = decode_host_signature(slot);
    if (!signature.ok) {
        for (uint32_t i = 0; i < argc; i++) {
            lean_dec(args[i]);
        }
        return vir::host_import_is_io(slot) ? lean_io_result_mk_ok(lean_box(0)) : lean_box(0);
    }
    vir_writer request;
    request.u32(static_cast<uint32_t>(signature.args.size()));
    for (size_t i = 0; i < signature.args.size(); i++) {
        encode_type(request, signature.args[i]);
        encode_value_payload(request, signature.args[i], args[i]);
    }
    encode_type(request, signature.result);
    std::string request_bytes = request.take();
    char const * result_bytes = vir_js_call(
        slot,
        reinterpret_cast<uint8_t const *>(request_bytes.data()),
        static_cast<uint32_t>(request_bytes.size()));
    uint32_t result_size = vir_js_call_result_size();
    object * value = decode_host_result(signature.result, result_bytes, result_size);
    if (result_bytes != nullptr) {
        vir_free_bytes(const_cast<char *>(result_bytes));
    }
    for (uint32_t i = 0; i < argc; i++) {
        lean_dec(args[i]);
    }
    if (vir::host_import_is_io(slot)) {
        return lean_io_result_mk_ok(value);
    }
    return value;
}

#define VIR_JS_TRAMPOLINES_FOR_SLOT(SLOT) \
extern "C" object * vir_js_import_slot_##SLOT##_0(void) { \
    return call_js_import(SLOT, 0, nullptr); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_1(object * a0) { \
    object * args[] = { a0 }; \
    return call_js_import(SLOT, 1, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_2(object * a0, object * a1) { \
    object * args[] = { a0, a1 }; \
    return call_js_import(SLOT, 2, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_3(object * a0, object * a1, object * a2) { \
    object * args[] = { a0, a1, a2 }; \
    return call_js_import(SLOT, 3, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_4(object * a0, object * a1, object * a2, object * a3) { \
    object * args[] = { a0, a1, a2, a3 }; \
    return call_js_import(SLOT, 4, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_5(object * a0, object * a1, object * a2, object * a3, object * a4) { \
    object * args[] = { a0, a1, a2, a3, a4 }; \
    return call_js_import(SLOT, 5, args); \
} \
extern "C" object * vir_js_import_slot_##SLOT##_6(object * a0, object * a1, object * a2, object * a3, object * a4, object * a5) { \
    object * args[] = { a0, a1, a2, a3, a4, a5 }; \
    return call_js_import(SLOT, 6, args); \
}

VIR_JS_TRAMPOLINES_FOR_SLOT(0)
VIR_JS_TRAMPOLINES_FOR_SLOT(1)
VIR_JS_TRAMPOLINES_FOR_SLOT(2)
VIR_JS_TRAMPOLINES_FOR_SLOT(3)
VIR_JS_TRAMPOLINES_FOR_SLOT(4)
VIR_JS_TRAMPOLINES_FOR_SLOT(5)
VIR_JS_TRAMPOLINES_FOR_SLOT(6)
VIR_JS_TRAMPOLINES_FOR_SLOT(7)
VIR_JS_TRAMPOLINES_FOR_SLOT(8)
VIR_JS_TRAMPOLINES_FOR_SLOT(9)
VIR_JS_TRAMPOLINES_FOR_SLOT(10)
VIR_JS_TRAMPOLINES_FOR_SLOT(11)
VIR_JS_TRAMPOLINES_FOR_SLOT(12)
VIR_JS_TRAMPOLINES_FOR_SLOT(13)
VIR_JS_TRAMPOLINES_FOR_SLOT(14)
VIR_JS_TRAMPOLINES_FOR_SLOT(15)

#undef VIR_JS_TRAMPOLINES_FOR_SLOT

#define VIR_JS_TRAMPOLINE_CASE(SLOT, ARITY) \
    if (slot == SLOT && arity == ARITY) { \
        return reinterpret_cast<void *>(vir_js_import_slot_##SLOT##_##ARITY); \
    }

#define VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(SLOT) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 0) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 1) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 2) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 3) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 4) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 5) \
    VIR_JS_TRAMPOLINE_CASE(SLOT, 6)

static void * host_import_trampoline_for(uint32_t slot, uint32_t arity) {
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(0)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(1)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(2)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(3)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(4)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(5)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(6)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(7)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(8)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(9)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(10)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(11)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(12)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(13)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(14)
    VIR_JS_TRAMPOLINE_CASES_FOR_SLOT(15)
    return nullptr;
}

#undef VIR_JS_TRAMPOLINE_CASES_FOR_SLOT
#undef VIR_JS_TRAMPOLINE_CASE

static std::string g_call_result;
static std::string g_call_error;

static char const * known_symbol_stem(name const & n) {
    if (char const * symbol = vir::find_host_import_symbol(n.raw())) {
        return symbol;
    }
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

namespace vir {

void * host_import_trampoline(char const * symbol) {
    int32_t slot = host_import_slot_for_symbol(symbol);
    if (slot < 0) {
        return nullptr;
    }
    return host_import_trampoline_for(
        static_cast<uint32_t>(slot),
        host_import_arity(static_cast<uint32_t>(slot)));
}

} // namespace vir

static uint64_t vir_mix_hash(uint64_t h, uint64_t k) {
    return lean_uint64_mix_hash(h, k);
}

static uint64_t vir_nat_hash(object * n) {
    return lean_uint64_of_nat(n);
}

static uint64_t vir_level_mk_data(uint64_t h, uint64_t depth, bool has_mvar, bool has_param) {
    uint32_t h1 = static_cast<uint32_t>(h);
    uint64_t d = std::min<uint64_t>(depth, 16777215);
    return static_cast<uint64_t>(h1)
        | (static_cast<uint64_t>(has_mvar ? 1 : 0) << 32)
        | (static_cast<uint64_t>(has_param ? 1 : 0) << 33)
        | (d << 40);
}

static uint64_t vir_level_data(object * value) {
    if (lean_is_scalar(value)) {
        return vir_level_mk_data(2221, 0, false, false);
    }
    return lean_ctor_get_uint64(value, lean_ctor_num_objs(value) * sizeof(void *));
}

static uint64_t vir_level_hash(object * value) {
    return static_cast<uint32_t>(vir_level_data(value));
}

static uint32_t vir_level_depth(object * value) {
    return static_cast<uint32_t>(vir_level_data(value) >> 40);
}

static bool vir_level_has_mvar(object * value) {
    return ((vir_level_data(value) >> 32) & 1) == 1;
}

static bool vir_level_has_param(object * value) {
    return ((vir_level_data(value) >> 33) & 1) == 1;
}

static object * vir_mk_ctor_with_data(
    unsigned tag,
    std::initializer_list<object *> fields,
    uint64_t data,
    unsigned scalar_extra = 0) {
    object * obj = lean_alloc_ctor(tag, fields.size(), sizeof(uint64_t) + scalar_extra);
    unsigned idx = 0;
    for (object * field : fields) {
        lean_ctor_set(obj, idx, field);
        idx++;
    }
    lean_ctor_set_uint64(obj, fields.size() * sizeof(void *), data);
    return obj;
}

extern "C" uint64_t lean_level_mk_data(uint64_t h, object * depth, uint8_t has_mvar, uint8_t has_param) {
    return vir_level_mk_data(h, lean_uint64_of_nat(depth), has_mvar != 0, has_param != 0);
}

extern "C" object * lean_level_mk_succ(obj_arg value) {
    uint64_t value_data = vir_level_data(value);
    uint64_t data = vir_level_mk_data(
        vir_mix_hash(2243, static_cast<uint32_t>(value_data)),
        vir_level_depth(value) + 1,
        ((value_data >> 32) & 1) == 1,
        ((value_data >> 33) & 1) == 1);
    return vir_mk_ctor_with_data(static_cast<unsigned>(level_kind::Succ), { value }, data);
}

extern "C" object * lean_level_mk_max(obj_arg lhs, obj_arg rhs) {
    uint64_t data = vir_level_mk_data(
        vir_mix_hash(2251, vir_mix_hash(vir_level_hash(lhs), vir_level_hash(rhs))),
        std::max<uint32_t>(vir_level_depth(lhs), vir_level_depth(rhs)) + 1,
        vir_level_has_mvar(lhs) || vir_level_has_mvar(rhs),
        vir_level_has_param(lhs) || vir_level_has_param(rhs));
    return vir_mk_ctor_with_data(static_cast<unsigned>(level_kind::Max), { lhs, rhs }, data);
}

extern "C" object * lean_level_mk_imax(obj_arg lhs, obj_arg rhs) {
    uint64_t data = vir_level_mk_data(
        vir_mix_hash(2267, vir_mix_hash(vir_level_hash(lhs), vir_level_hash(rhs))),
        std::max<uint32_t>(vir_level_depth(lhs), vir_level_depth(rhs)) + 1,
        vir_level_has_mvar(lhs) || vir_level_has_mvar(rhs),
        vir_level_has_param(lhs) || vir_level_has_param(rhs));
    return vir_mk_ctor_with_data(static_cast<unsigned>(level_kind::IMax), { lhs, rhs }, data);
}

extern "C" object * lean_level_mk_param(obj_arg name) {
    uint64_t data = vir_level_mk_data(vir_mix_hash(2239, lean_name_hash(name)), 0, false, true);
    return vir_mk_ctor_with_data(static_cast<unsigned>(level_kind::Param), { name }, data);
}

extern "C" object * lean_level_mk_mvar(obj_arg name) {
    uint64_t data = vir_level_mk_data(vir_mix_hash(2237, lean_name_hash(name)), 0, true, false);
    return vir_mk_ctor_with_data(static_cast<unsigned>(level_kind::MVar), { name }, data);
}

static uint64_t vir_expr_mk_data(
    uint64_t hash,
    uint64_t loose_bvar_range,
    uint32_t approx_depth = 0,
    bool has_fvar = false,
    bool has_expr_mvar = false,
    bool has_level_mvar = false,
    bool has_level_param = false) {
    uint32_t h = static_cast<uint32_t>(hash);
    uint32_t d = std::min<uint32_t>(approx_depth, 255);
    uint64_t range = std::min<uint64_t>(loose_bvar_range, 1048575);
    return static_cast<uint64_t>(h)
        | (static_cast<uint64_t>(d) << 32)
        | (static_cast<uint64_t>(has_fvar ? 1 : 0) << 40)
        | (static_cast<uint64_t>(has_expr_mvar ? 1 : 0) << 41)
        | (static_cast<uint64_t>(has_level_mvar ? 1 : 0) << 42)
        | (static_cast<uint64_t>(has_level_param ? 1 : 0) << 43)
        | (range << 44);
}

static uint64_t vir_expr_data(object * value) {
    return lean_ctor_get_uint64(value, lean_ctor_num_objs(value) * sizeof(void *));
}

static uint64_t vir_expr_hash(object * value) {
    return static_cast<uint32_t>(vir_expr_data(value));
}

static uint32_t vir_expr_approx_depth_from_data(uint64_t data) {
    return static_cast<uint32_t>((data >> 32) & 255);
}

static uint32_t vir_expr_approx_depth(object * value) {
    return vir_expr_approx_depth_from_data(vir_expr_data(value));
}

static uint32_t vir_expr_loose_bvar_range_from_data(uint64_t data) {
    return static_cast<uint32_t>(data >> 44);
}

static uint32_t vir_expr_loose_bvar_range(object * value) {
    return vir_expr_loose_bvar_range_from_data(vir_expr_data(value));
}

static bool vir_expr_has_fvar_from_data(uint64_t data) {
    return ((data >> 40) & 1) == 1;
}

static bool vir_expr_has_expr_mvar_from_data(uint64_t data) {
    return ((data >> 41) & 1) == 1;
}

static bool vir_expr_has_level_mvar_from_data(uint64_t data) {
    return ((data >> 42) & 1) == 1;
}

static bool vir_expr_has_level_param_from_data(uint64_t data) {
    return ((data >> 43) & 1) == 1;
}

static uint64_t vir_level_list_hash(object * value) {
    uint64_t hash = 7;
    object * cursor = value;
    while (!lean_is_scalar(cursor)) {
        hash = vir_mix_hash(hash, vir_level_hash(lean_ctor_get(cursor, 0)));
        cursor = lean_ctor_get(cursor, 1);
    }
    return hash;
}

static bool vir_level_list_has_mvar(object * value) {
    object * cursor = value;
    while (!lean_is_scalar(cursor)) {
        if (vir_level_has_mvar(lean_ctor_get(cursor, 0))) return true;
        cursor = lean_ctor_get(cursor, 1);
    }
    return false;
}

static bool vir_level_list_has_param(object * value) {
    object * cursor = value;
    while (!lean_is_scalar(cursor)) {
        if (vir_level_has_param(lean_ctor_get(cursor, 0))) return true;
        cursor = lean_ctor_get(cursor, 1);
    }
    return false;
}

extern "C" uint64_t lean_expr_mk_data(
    uint64_t hash,
    object * bvar_range,
    uint32_t approx_depth,
    uint8_t has_fvar,
    uint8_t has_expr_mvar,
    uint8_t has_level_mvar,
    uint8_t has_level_param) {
    return vir_expr_mk_data(
        hash,
        lean_uint64_of_nat(bvar_range),
        approx_depth,
        has_fvar != 0,
        has_expr_mvar != 0,
        has_level_mvar != 0,
        has_level_param != 0);
}

extern "C" uint64_t lean_expr_mk_app_data(uint64_t f_data, uint64_t a_data) {
    uint32_t depth = std::max(vir_expr_approx_depth_from_data(f_data), vir_expr_approx_depth_from_data(a_data)) + 1;
    if (depth > 255) depth = 255;
    uint32_t range = std::max(vir_expr_loose_bvar_range_from_data(f_data), vir_expr_loose_bvar_range_from_data(a_data));
    uint32_t hash = static_cast<uint32_t>(vir_mix_hash(f_data, a_data));
    return ((f_data | a_data) & (static_cast<uint64_t>(15) << 40))
        | static_cast<uint64_t>(hash)
        | (static_cast<uint64_t>(depth) << 32)
        | (static_cast<uint64_t>(range) << 44);
}

extern "C" object * lean_expr_mk_bvar(obj_arg idx) {
    uint64_t idx_hash = vir_nat_hash(idx);
    uint64_t data = vir_expr_mk_data(vir_mix_hash(7, idx_hash), idx_hash + 1);
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::BVar), { idx }, data);
}

extern "C" object * lean_expr_mk_fvar(obj_arg name) {
    uint64_t data = vir_expr_mk_data(vir_mix_hash(13, lean_name_hash(name)), 0, 0, true);
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::FVar), { name }, data);
}

extern "C" object * lean_expr_mk_mvar(obj_arg name) {
    uint64_t data = vir_expr_mk_data(vir_mix_hash(17, lean_name_hash(name)), 0, 0, false, true);
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::MVar), { name }, data);
}

extern "C" object * lean_expr_mk_sort(obj_arg level) {
    uint64_t data = vir_expr_mk_data(
        vir_mix_hash(11, vir_level_hash(level)),
        0,
        0,
        false,
        false,
        vir_level_has_mvar(level),
        vir_level_has_param(level));
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::Sort), { level }, data);
}

extern "C" object * lean_expr_mk_const(obj_arg decl_name, obj_arg levels) {
    uint64_t data = vir_expr_mk_data(
        vir_mix_hash(5, vir_mix_hash(lean_name_hash(decl_name), vir_level_list_hash(levels))),
        0,
        0,
        false,
        false,
        vir_level_list_has_mvar(levels),
        vir_level_list_has_param(levels));
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::Const), { decl_name, levels }, data);
}

extern "C" object * lean_expr_mk_app(obj_arg fn, obj_arg arg) {
    uint64_t data = lean_expr_mk_app_data(vir_expr_data(fn), vir_expr_data(arg));
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::App), { fn, arg }, data);
}

static object * vir_expr_mk_binding(unsigned tag, obj_arg name, obj_arg type, obj_arg body, uint8_t binder_info) {
    uint64_t type_data = vir_expr_data(type);
    uint64_t body_data = vir_expr_data(body);
    uint32_t depth = std::max(vir_expr_approx_depth_from_data(type_data), vir_expr_approx_depth_from_data(body_data)) + 1;
    uint32_t body_range = vir_expr_loose_bvar_range_from_data(body_data);
    uint64_t data = vir_expr_mk_data(
        vir_mix_hash(depth, vir_mix_hash(static_cast<uint32_t>(type_data), static_cast<uint32_t>(body_data))),
        std::max<uint32_t>(vir_expr_loose_bvar_range_from_data(type_data), body_range == 0 ? 0 : body_range - 1),
        depth,
        vir_expr_has_fvar_from_data(type_data) || vir_expr_has_fvar_from_data(body_data),
        vir_expr_has_expr_mvar_from_data(type_data) || vir_expr_has_expr_mvar_from_data(body_data),
        vir_expr_has_level_mvar_from_data(type_data) || vir_expr_has_level_mvar_from_data(body_data),
        vir_expr_has_level_param_from_data(type_data) || vir_expr_has_level_param_from_data(body_data));
    object * obj = vir_mk_ctor_with_data(tag, { name, type, body }, data, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *) + sizeof(uint64_t), binder_info);
    return obj;
}

extern "C" object * lean_expr_mk_lambda(obj_arg name, obj_arg type, obj_arg body, uint8_t binder_info) {
    return vir_expr_mk_binding(static_cast<unsigned>(expr_kind::Lambda), name, type, body, binder_info);
}

extern "C" object * lean_expr_mk_forall(obj_arg name, obj_arg type, obj_arg body, uint8_t binder_info) {
    return vir_expr_mk_binding(static_cast<unsigned>(expr_kind::Pi), name, type, body, binder_info);
}

extern "C" object * lean_expr_mk_let(obj_arg name, obj_arg type, obj_arg value, obj_arg body, uint8_t nondep) {
    uint64_t type_data = vir_expr_data(type);
    uint64_t value_data = vir_expr_data(value);
    uint64_t body_data = vir_expr_data(body);
    uint32_t depth = std::max(std::max(
        vir_expr_approx_depth_from_data(type_data),
        vir_expr_approx_depth_from_data(value_data)),
        vir_expr_approx_depth_from_data(body_data)) + 1;
    uint32_t body_range = vir_expr_loose_bvar_range_from_data(body_data);
    uint64_t data = vir_expr_mk_data(
        vir_mix_hash(depth, vir_mix_hash(static_cast<uint32_t>(type_data), vir_mix_hash(static_cast<uint32_t>(value_data), static_cast<uint32_t>(body_data)))),
        std::max<uint32_t>(
            std::max<uint32_t>(vir_expr_loose_bvar_range_from_data(type_data), vir_expr_loose_bvar_range_from_data(value_data)),
            body_range == 0 ? 0 : body_range - 1),
        depth,
        vir_expr_has_fvar_from_data(type_data) || vir_expr_has_fvar_from_data(value_data) || vir_expr_has_fvar_from_data(body_data),
        vir_expr_has_expr_mvar_from_data(type_data) || vir_expr_has_expr_mvar_from_data(value_data) || vir_expr_has_expr_mvar_from_data(body_data),
        vir_expr_has_level_mvar_from_data(type_data) || vir_expr_has_level_mvar_from_data(value_data) || vir_expr_has_level_mvar_from_data(body_data),
        vir_expr_has_level_param_from_data(type_data) || vir_expr_has_level_param_from_data(value_data) || vir_expr_has_level_param_from_data(body_data));
    object * obj = vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::Let), { name, type, value, body }, data, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 4 * sizeof(void *) + sizeof(uint64_t), nondep);
    return obj;
}

extern "C" object * lean_expr_mk_lit(obj_arg literal) {
    uint64_t literal_hash = 0;
    if (lean_obj_tag(literal) == 0) {
        literal_hash = vir_nat_hash(lean_ctor_get(literal, 0));
    } else {
        literal_hash = lean_string_hash(lean_ctor_get(literal, 0));
    }
    uint64_t data = vir_expr_mk_data(vir_mix_hash(3, literal_hash), 0);
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::Lit), { literal }, data);
}

extern "C" object * lean_expr_mk_proj(obj_arg type_name, obj_arg idx, obj_arg structure) {
    uint64_t structure_data = vir_expr_data(structure);
    uint32_t depth = vir_expr_approx_depth_from_data(structure_data) + 1;
    uint64_t data = vir_expr_mk_data(
        vir_mix_hash(depth, vir_mix_hash(lean_name_hash(type_name), vir_mix_hash(vir_nat_hash(idx), static_cast<uint32_t>(structure_data)))),
        vir_expr_loose_bvar_range_from_data(structure_data),
        depth,
        vir_expr_has_fvar_from_data(structure_data),
        vir_expr_has_expr_mvar_from_data(structure_data),
        vir_expr_has_level_mvar_from_data(structure_data),
        vir_expr_has_level_param_from_data(structure_data));
    return vir_mk_ctor_with_data(static_cast<unsigned>(expr_kind::Proj), { type_name, idx, structure }, data);
}

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

extern "C" void vir_ensure_ir_interpreter_initialized(void) {
    lean::ensure_ir_interpreter_initialized();
}

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
    if (lean::object * decl = lean::vir::find_package_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_ir_find_env_decl_boxed(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_boxed_decl(n)) {
        return lean::mk_some(decl);
    }
    return lean_box(0);
}

extern "C" uint32_t vir_upstream_target_pointer_bytes(void) {
    return sizeof(void *);
}

static void cleanup_call_args(std::vector<lean::vir_arg> const & args) {
    for (lean::vir_arg const & arg : args) {
        if (arg.owned) lean_dec(arg.value);
    }
}

static uint8_t decode_call_effect(lean::vir_reader & reader) {
    uint8_t effect = 0;
    if (reader.ok && !reader.at_end()) {
        effect = reader.u8();
        if (effect > 1) {
            reader.fail("unsupported call effect tag " + std::to_string(effect));
        }
    }
    return effect;
}

extern "C" char const * vir_call(
    char const * name_text,
    uint32_t name_len,
    uint8_t const * request,
    uint32_t request_len,
    uint8_t result_tag) {
    (void) result_tag;
    lean::g_call_result.clear();
    lean::g_call_error.clear();
    if (request == nullptr && request_len != 0) {
        lean::g_call_error = "call payload pointer is null";
        return nullptr;
    }
    if (!lean::vir::package_loaded()) {
        lean::g_call_error = "no IR package has been loaded";
        return nullptr;
    }

    lean::name fn = lean::name_from_dotted(name_text, name_len);
    bool has_boxed_decl = lean::vir::find_package_boxed_decl(fn.to_obj_arg()) != nullptr;

    lean::vir_reader reader(request, request_len);
    uint32_t argc = reader.u32();
    std::vector<lean::vir_arg> decoded_args;
    std::vector<lean::object *> args;
    decoded_args.reserve(argc);
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
        decoded_args.push_back(lean::decode_argument(reader, has_boxed_decl));
        args.push_back(decoded_args.back().value);
    }
    lean::vir_type result_type = lean::decode_type(reader);
    uint8_t effect = decode_call_effect(reader);
    if (!reader.ok) {
        lean::g_call_error = reader.error();
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    if (!has_boxed_decl && lean::needs_boxed_wasm32_call_boundary_type(result_type)) {
        lean::g_call_error = "top-level Float, Float32, UInt64, and trivial wrappers over them require a boxed declaration at the wasm32 interpreter boundary";
        cleanup_call_args(decoded_args);
        return nullptr;
    }
    if (!reader.at_end()) {
        lean::g_call_error = "trailing bytes after call payload";
        cleanup_call_args(decoded_args);
        return nullptr;
    }

    lean::ensure_ir_interpreter_initialized();
    if (effect == 1) {
        args.push_back(lean_io_mk_world());
    }
    lean::elab_environment env(lean_box(0));
    lean::options opts(lean_box(0));
    lean::object * result = lean::ir::run_boxed(env, opts, fn, args.size(), args.data());
    if (effect == 1) {
        if (!lean_io_result_is_ok(result)) {
            lean_dec(result);
            lean::g_call_error = "IO action failed";
            return nullptr;
        }
        result = lean_io_result_take_value(result);
    }
    lean::vir_writer writer;
    lean::encode_result(writer, result_type, result, has_boxed_decl);
    if (lean::call_result_is_owned(result_type, has_boxed_decl)) {
        lean_dec(result);
    }
    lean::g_call_result = writer.take();
    return lean::g_call_result.data();
}

extern "C" uint32_t vir_call_result_size(void) {
    return static_cast<uint32_t>(lean::g_call_result.size());
}

extern "C" char const * vir_call_error(void) {
    return lean::g_call_error.c_str();
}

extern "C" uint32_t vir_call_error_size(void) {
    return static_cast<uint32_t>(lean::g_call_error.size());
}
