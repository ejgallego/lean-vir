/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "runtime/object.h"

extern "C" lean::object * vir_obj_string(char const * text, uint32_t len) {
    return lean_mk_string_from_bytes(text, len);
}

extern "C" char const * vir_obj_string_data(lean::object * value) {
    return lean_string_cstr(value);
}

extern "C" uint32_t vir_obj_string_size(lean::object * value) {
    size_t size = lean_string_size(value);
    return static_cast<uint32_t>(size == 0 ? 0 : size - 1);
}

extern "C" lean::object * vir_obj_byte_array(uint8_t const * values, uint32_t len) {
    lean::object * array = lean_alloc_sarray(1, len, len);
    if (len != 0) {
        memcpy(lean_sarray_cptr(array), values, len);
    }
    return array;
}

extern "C" uint8_t const * vir_obj_byte_array_data(lean::object * value) {
    return lean_sarray_cptr(value);
}

extern "C" uint32_t vir_obj_byte_array_size(lean::object * value) {
    return static_cast<uint32_t>(lean_sarray_size(value));
}

extern "C" void vir_obj_inc(lean::object * value) {
    lean_inc(value);
}

extern "C" void vir_obj_dec(lean::object * value) {
    lean_dec(value);
}
