/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package/decl_provider.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <algorithm>
#include <initializer_list>
#include <limits>
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
}

static uint8_t g_vir_io_initializing = 0;

extern "C" void vir_set_io_initializing(uint8_t value) {
    g_vir_io_initializing = value ? 1 : 0;
}

extern "C" uint8_t vir_get_io_initializing(void) {
    return g_vir_io_initializing;
}

static lean_object * box_object_binary(lean_object * a, lean_object * b, lean_object * (*fn)(lean_object *, lean_object *)) {
    lean_object * result = fn(a, b);
    lean_dec(a);
    lean_dec(b);
    return result;
}

static lean_object * box_object_unary(lean_object * a, lean_object * (*fn)(lean_object *)) {
    lean_object * result = fn(a);
    lean_dec(a);
    return result;
}

static lean_object * box_object_predicate(lean_object * a, lean_object * b, uint8_t (*fn)(lean_object *, lean_object *)) {
    uint8_t result = fn(a, b);
    lean_dec(a);
    lean_dec(b);
    return lean_box(result);
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

static lean_object * box_uint32_binary(lean_object * a, lean_object * b, uint32_t (*fn)(uint32_t, uint32_t)) {
    uint32_t result = fn(lean_unbox_uint32(a), lean_unbox_uint32(b));
    lean_dec(a);
    lean_dec(b);
    return lean_box_uint32(result);
}

static lean_object * box_uint32_unary(lean_object * a, uint32_t (*fn)(uint32_t)) {
    uint32_t result = fn(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box_uint32(result);
}

static lean_object * box_uint32_predicate(lean_object * a, lean_object * b, uint8_t (*fn)(uint32_t, uint32_t)) {
    uint8_t result = fn(lean_unbox_uint32(a), lean_unbox_uint32(b));
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
    return box_object_binary(a, b, lean_nat_add);
}

extern "C" lean_object * lean_nat_sub___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_sub);
}

extern "C" lean_object * lean_nat_dec_eq___boxed(lean_object * a, lean_object * b) {
    return box_object_predicate(a, b, lean_nat_dec_eq);
}

extern "C" lean_object * lean_nat_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_object_predicate(a, b, lean_nat_dec_le);
}

extern "C" lean_object * lean_nat_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_object_predicate(a, b, lean_nat_dec_lt);
}

extern "C" lean_object * lean_nat_mul___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_mul);
}

extern "C" lean_object * lean_nat_div___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_div);
}

extern "C" lean_object * lean_nat_mod___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_mod);
}

extern "C" lean_object * lean_nat_pow___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_pow);
}

extern "C" lean_object * lean_nat_log2___boxed(lean_object * a) {
    return box_object_unary(a, lean_nat_log2);
}

extern "C" lean_object * lean_nat_shiftl___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_shiftl);
}

extern "C" lean_object * lean_nat_shiftr___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_nat_shiftr);
}

extern "C" lean_object * lean_nat_to_int___boxed(lean_object * a) {
    return lean_nat_to_int(a);
}

extern "C" lean_object * lean_int_add___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_int_add);
}

extern "C" lean_object * lean_int_sub___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_int_sub);
}

extern "C" lean_object * lean_int_mul___boxed(lean_object * a, lean_object * b) {
    return box_object_binary(a, b, lean_int_mul);
}

extern "C" lean_object * lean_int_neg___boxed(lean_object * a) {
    return box_object_unary(a, lean_int_neg);
}

extern "C" lean_object * lean_int_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_object_predicate(a, b, lean_int_dec_lt);
}

extern "C" lean_object * lean_int_dec_eq___boxed(lean_object * a, lean_object * b) {
    return box_object_predicate(a, b, lean_int_dec_eq);
}

extern "C" lean_object * lean_int_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_object_predicate(a, b, lean_int_dec_le);
}

extern "C" lean_object * lean_nat_abs___boxed(lean_object * a) {
    return box_object_unary(a, lean_nat_abs);
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
    return box_usize_binary(a, b, lean_usize_add);
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
    return box_usize_predicate(a, b, lean_usize_dec_eq);
}

extern "C" lean_object * lean_usize_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_usize_predicate(a, b, lean_usize_dec_lt);
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

extern "C" lean_object * lean_string_pushn___boxed(lean_object * s, lean_object * c, lean_object * n) {
    uint32_t ch = lean_unbox_uint32(c);
    size_t count = nat_to_size_or_max(n);
    lean_dec(c);
    lean_dec(n);
    if (count == SIZE_MAX) {
        lean_dec(s);
        __builtin_trap();
    }
    for (size_t i = 0; i < count; i++) {
        s = lean_string_push(s, ch);
    }
    return s;
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

extern "C" lean_object * lean_string_posof___boxed(lean_object * s, lean_object * c) {
    uint32_t needle = lean_unbox_uint32(c);
    lean_dec(c);

    lean_object * pos = lean_box(0);
    while (!lean_string_utf8_at_end(s, pos)) {
        if (lean_string_utf8_get(s, pos) == needle) {
            lean_dec(s);
            return pos;
        }
        lean_object * next = lean_string_utf8_next(s, pos);
        lean_dec(pos);
        pos = next;
    }

    lean_dec(s);
    return pos;
}

extern "C" lean_object * lean_string_offsetofpos___boxed(lean_object * s, lean_object * pos) {
    size_t target = nat_to_size_or_max(pos);
    lean_object * current = lean_box(0);
    size_t offset = 0;

    while (nat_to_size_or_max(current) < target && !lean_string_utf8_at_end(s, current)) {
        lean_object * next = lean_string_utf8_next(s, current);
        lean_dec(current);
        current = next;
        offset++;
    }

    lean_dec(current);
    lean_dec(pos);
    lean_dec(s);
    return lean_box(offset);
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

extern "C" lean_object * lean_string_compare___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_string_eq(a, b)
        ? lean_box(1)
        : lean_box(lean_string_lt(a, b) ? 0 : 2);
    lean_dec(a);
    lean_dec(b);
    return result;
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

extern "C" lean_object * lean_uint16_to_uint32___boxed(lean_object * a) {
    uint32_t result = lean_uint16_to_uint32(static_cast<uint16_t>(lean_unbox(a)));
    lean_dec(a);
    return lean_box_uint32(result);
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

extern "C" lean_object * lean_uint32_to_uint16___boxed(lean_object * a) {
    uint16_t result = lean_uint32_to_uint16(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box(result);
}

extern "C" lean_object * lean_uint32_to_uint64___boxed(lean_object * a) {
    uint64_t result = lean_uint32_to_uint64(lean_unbox_uint32(a));
    lean_dec(a);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_uint32_add___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_add);
}

extern "C" lean_object * lean_uint32_sub___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_sub);
}

extern "C" lean_object * lean_uint32_mul___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_mul);
}

extern "C" lean_object * lean_uint32_div___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_div);
}

extern "C" lean_object * lean_uint32_mod___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_mod);
}

extern "C" lean_object * lean_uint32_land___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_land);
}

extern "C" lean_object * lean_uint32_lor___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_lor);
}

extern "C" lean_object * lean_uint32_xor___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_xor);
}

extern "C" lean_object * lean_uint32_shift_left___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_shift_left);
}

extern "C" lean_object * lean_uint32_shift_right___boxed(lean_object * a, lean_object * b) {
    return box_uint32_binary(a, b, lean_uint32_shift_right);
}

extern "C" lean_object * lean_uint32_complement___boxed(lean_object * a) {
    return box_uint32_unary(a, lean_uint32_complement);
}

extern "C" lean_object * lean_uint32_neg___boxed(lean_object * a) {
    return box_uint32_unary(a, lean_uint32_neg);
}

extern "C" lean_object * lean_uint32_dec_eq___boxed(lean_object * a, lean_object * b) {
    return box_uint32_predicate(a, b, lean_uint32_dec_eq);
}

extern "C" lean_object * lean_uint32_dec_lt___boxed(lean_object * a, lean_object * b) {
    return box_uint32_predicate(a, b, lean_uint32_dec_lt);
}

extern "C" lean_object * lean_uint32_dec_le___boxed(lean_object * a, lean_object * b) {
    return box_uint32_predicate(a, b, lean_uint32_dec_le);
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
