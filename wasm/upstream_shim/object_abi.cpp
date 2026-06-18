/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <string>

#include "runtime/object.h"

namespace lean {

static std::string g_native_conversion_result;

static std::string nat_to_decimal_for_native(object * value) {
    if (lean_is_scalar(value)) {
        return std::to_string(lean_unbox(value));
    }
    return mpz_value(value).to_string();
}

} // namespace lean

extern "C" uint32_t vir_native_bool_flip(uint32_t value) {
    lean::object * boxed = lean_box(value == 0 ? 0 : 1);
    uint32_t result = lean_unbox(boxed) == 0 ? 1 : 0;
    lean_dec(boxed);
    return result;
}

extern "C" char const * vir_native_nat_bump(char const * text, uint32_t len) {
    std::string input(text, text + len);
    lean::object * value = lean_cstr_to_nat(input.c_str());
    lean::object * result = lean_nat_succ(value);
    lean::g_native_conversion_result = lean::nat_to_decimal_for_native(result);
    lean_dec(value);
    lean_dec(result);
    return lean::g_native_conversion_result.c_str();
}

extern "C" char const * vir_native_string_roundtrip(char const * text, uint32_t len) {
    lean::object * value = lean_mk_string_from_bytes(text, len);
    size_t size = lean_string_size(value);
    uint32_t out_len = static_cast<uint32_t>(size == 0 ? 0 : size - 1);
    lean::g_native_conversion_result.assign(lean_string_cstr(value), out_len);
    lean_dec(value);
    return lean::g_native_conversion_result.c_str();
}

extern "C" uint32_t vir_native_uint32_bump(uint32_t value) {
    lean::object * boxed = lean_box_uint32(value);
    uint32_t result = lean_uint32_add(lean_unbox_uint32(boxed), 1);
    lean_dec(boxed);
    lean::object * result_boxed = lean_box_uint32(result);
    uint32_t out = lean_unbox_uint32(result_boxed);
    lean_dec(result_boxed);
    return out;
}

extern "C" double vir_native_float_scale(double value) {
    lean::object * boxed = lean_box_float(value);
    double result = lean_float_scaleb(lean_unbox_float(boxed), lean_box(2));
    lean_dec(boxed);
    lean::object * result_boxed = lean_box_float(result);
    double out = lean_unbox_float(result_boxed);
    lean_dec(result_boxed);
    return out;
}

extern "C" uint32_t vir_native_conversion_result_size(void) {
    return static_cast<uint32_t>(lean::g_native_conversion_result.size());
}

extern "C" lean::object * vir_obj_bool(uint32_t value) {
    return lean_box(value == 0 ? 0 : 1);
}

extern "C" uint32_t vir_obj_get_bool(lean::object * value) {
    return lean_unbox(value) == 0 ? 0 : 1;
}

extern "C" lean::object * vir_obj_uint32(uint32_t value) {
    return lean_box_uint32(value);
}

extern "C" uint32_t vir_obj_get_uint32(lean::object * value) {
    return lean_unbox_uint32(value);
}

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
