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
lean_object * lean_string_utf8_set(lean_object * str, lean_object * pos, uint32_t c);
uint8_t lean_string_is_valid_pos(lean_object * str, lean_object * pos);
}

static uint8_t g_vir_io_initializing = 0;

extern "C" void vir_set_io_initializing(uint8_t value) {
    g_vir_io_initializing = value ? 1 : 0;
}

extern "C" uint8_t vir_get_io_initializing(void) {
    return g_vir_io_initializing;
}

static size_t nat_to_size_or_max(lean_object * n) {
    return lean_is_scalar(n) ? lean_unbox(n) : SIZE_MAX;
}

static size_t substring_repaired_pos(lean_object * s, lean_object * p) {
    size_t end = lean_string_size(s) - 1;
    return lean_string_is_valid_pos(s, p) ? nat_to_size_or_max(p) : end;
}

extern "C" lean_object * lean_system_platform_nbits___boxed(lean_object * unit) {
    lean_dec(unit);
    return lean_box(sizeof(void*) == 8 ? 64 : 32);
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

// The raw function returns a borrowed element. Lean's standard boxed-wrapper
// emission does not retain that result before releasing the borrowed array, so
// this ownership adapter must remain explicit.
extern "C" lean_object * lean_array_uget_borrowed___boxed(lean_object * type, lean_object * array, lean_object * index, lean_object * proof) {
    lean_dec(type);
    lean_object * result = lean_array_uget_borrowed(array, lean_unbox_usize(index));
    lean_inc(result);
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

extern "C" lean_object * lean_array_get_borrowed___boxed(lean_object * type, lean_object * default_value, lean_object * array, lean_object * index) {
    lean_dec(type);
    lean_object * result = lean_array_get(default_value, array, index);
    lean_dec(default_value);
    lean_dec(array);
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

extern "C" lean_object * l_USize_ofNatLT___boxed(lean_object * a, lean_object * proof) {
    size_t result = lean_usize_of_nat(a);
    lean_dec(a);
    lean_dec(proof);
    return lean_box_usize(result);
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

extern "C" lean_object * lean_string_compare___boxed(lean_object * a, lean_object * b) {
    lean_object * result = lean_string_eq(a, b)
        ? lean_box(1)
        : lean_box(lean_string_lt(a, b) ? 0 : 2);
    lean_dec(a);
    lean_dec(b);
    return result;
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

extern "C" lean_object * lean_uint8_to_uint32___boxed(lean_object * a) {
    uint32_t result = static_cast<uint32_t>(lean_unbox(a));
    lean_dec(a);
    return lean_box_uint32(result);
}

extern "C" lean_object * l_UInt32_ofNatLT___boxed(lean_object * a, lean_object * proof) {
    uint32_t result = lean_uint32_of_nat(a);
    lean_dec(a);
    lean_dec(proof);
    return lean_box_uint32(result);
}

extern "C" lean_object * l_UInt64_ofNatLT___boxed(lean_object * a, lean_object * proof) {
    uint64_t result = lean_uint64_of_nat(a);
    lean_dec(a);
    lean_dec(proof);
    return lean_box_uint64(result);
}

extern "C" lean_object * lean_uint64_to_uint8___boxed(lean_object * a) {
    uint8_t result = static_cast<uint8_t>(lean_unbox_uint64(a));
    lean_dec(a);
    return lean_box(result);
}

extern "C" lean_object * lean_is_reserved_name___boxed(lean_object * env, lean_object * n) {
    lean::elab_environment ienv(lean_box(0));
    lean::options opts(lean_box(0));
    lean_object * args[] = { env, n };
    return lean::ir::run_boxed(ienv, opts, lean::name({ "Lean", "isReservedName" }), 2, args);
}

extern "C" lean_object * lean_eval_check_meta___boxed(lean_object * env, lean_object * const_name) {
    lean_dec(env);
    lean_dec(const_name);
    lean_object * result = lean_alloc_ctor(1, 1, 0);
    lean_ctor_set(result, 0, lean_box(0));
    return result;
}
