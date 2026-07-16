/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "runtime/io.h"
#include "runtime/object.h"

static uint8_t g_vir_io_initializing = 0;

extern "C" void vir_set_io_initializing(uint8_t value) {
    g_vir_io_initializing = value ? 1 : 0;
}

extern "C" uint8_t vir_get_io_initializing(void) {
    return g_vir_io_initializing;
}

extern "C" uint8_t lean_io_initializing(void) {
    return g_vir_io_initializing;
}

extern "C" lean_object * lean_st_mk_ref(lean_object * value) {
    lean_ref_object * ref = reinterpret_cast<lean_ref_object *>(lean_alloc_small_object(sizeof(lean_ref_object)));
    lean_set_st_header(reinterpret_cast<lean_object *>(ref), LeanRef, 0);
    ref->m_value = value;
    return reinterpret_cast<lean_object *>(ref);
}

extern "C" lean_object * lean_st_ref_get(lean_object * ref) {
    lean_object * value = lean_to_ref(ref)->m_value;
    lean_inc(value);
    return value;
}

extern "C" lean_object * lean_st_ref_set(lean_object * ref, lean_object * value) {
    lean_ref_object * ref_obj = lean_to_ref(ref);
    lean_object * old_value = ref_obj->m_value;
    ref_obj->m_value = value;
    lean_dec(old_value);
    return lean_box(0);
}

extern "C" lean_object * lean_st_ref_take(lean_object * ref) {
    lean_ref_object * ref_obj = lean_to_ref(ref);
    lean_object * value = ref_obj->m_value;
    ref_obj->m_value = nullptr;
    return value;
}

extern "C" lean::obj_res lean_io_eprintln(lean::obj_arg s) {
    lean_dec(s);
    return lean_io_result_mk_ok(lean_box(0));
}

extern "C" void lean_io_result_show_error(lean::b_obj_arg) {}
