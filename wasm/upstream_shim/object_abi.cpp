/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <limits>
#include <string>

#include "runtime/object.h"

static std::string g_obj_decimal_result;

static bool is_decimal(char const * text, uint32_t len) {
    if (text == nullptr || len == 0) {
        return false;
    }
    for (uint32_t i = 0; i < len; i++) {
        if (text[i] < '0' || text[i] > '9') {
            return false;
        }
    }
    return true;
}

static bool is_signed_decimal(char const * text, uint32_t len) {
    if (text == nullptr || len == 0) {
        return false;
    }
    uint32_t first_digit = text[0] == '-' ? 1 : 0;
    return first_digit < len && is_decimal(text + first_digit, len - first_digit);
}

static bool parse_u64(char const * text, uint32_t len, uint64_t & out) {
    if (!is_decimal(text, len)) {
        return false;
    }
    uint64_t value = 0;
    for (uint32_t i = 0; i < len; i++) {
        uint64_t digit = static_cast<uint64_t>(text[i] - '0');
        if (value > (std::numeric_limits<uint64_t>::max() - digit) / 10) {
            return false;
        }
        value = value * 10 + digit;
    }
    out = value;
    return true;
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

extern "C" lean::object * vir_obj_array(lean::object ** values, uint32_t len) {
    if (values == nullptr && len != 0) {
        return nullptr;
    }
    for (uint32_t i = 0; i < len; i++) {
        if (values[i] == nullptr) {
            return nullptr;
        }
    }
    lean::object * array = lean_alloc_array(len, len);
    for (uint32_t i = 0; i < len; i++) {
        lean_array_set_core(array, i, values[i]);
    }
    return array;
}

extern "C" lean::object * vir_obj_nat(char const * text, uint32_t len) {
    if (!is_decimal(text, len)) {
        return nullptr;
    }
    std::string decimal(text, len);
    lean::mpz value(decimal.c_str());
    return lean::mk_nat_obj(value);
}

extern "C" char const * vir_obj_nat_decimal(lean::object * value) {
    g_obj_decimal_result = lean_is_scalar(value)
        ? std::to_string(lean_unbox(value))
        : lean::mpz_value(value).to_string();
    return g_obj_decimal_result.c_str();
}

extern "C" lean::object * vir_obj_int(char const * text, uint32_t len) {
    if (!is_signed_decimal(text, len)) {
        return nullptr;
    }
    std::string decimal(text, len);
    return lean_cstr_to_int(decimal.c_str());
}

extern "C" char const * vir_obj_int_decimal(lean::object * value) {
    g_obj_decimal_result = lean_is_scalar(value)
        ? std::to_string(lean_scalar_to_int(value))
        : lean::mpz_value(value).to_string();
    return g_obj_decimal_result.c_str();
}

extern "C" lean::object * vir_obj_uint64(char const * text, uint32_t len) {
    uint64_t value = 0;
    if (!parse_u64(text, len, value)) {
        return nullptr;
    }
    return lean_box_uint64(value);
}

extern "C" char const * vir_obj_uint64_decimal(lean::object * value) {
    g_obj_decimal_result = std::to_string(lean_unbox_uint64(value));
    return g_obj_decimal_result.c_str();
}

extern "C" lean::object * vir_obj_usize(char const * text, uint32_t len) {
    uint64_t value = 0;
    if (!parse_u64(text, len, value) || value > std::numeric_limits<size_t>::max()) {
        return nullptr;
    }
    return lean_box_usize(static_cast<size_t>(value));
}

extern "C" char const * vir_obj_usize_decimal(lean::object * value) {
    g_obj_decimal_result = std::to_string(lean_unbox_usize(value));
    return g_obj_decimal_result.c_str();
}

extern "C" uint32_t vir_obj_decimal_size(void) {
    return static_cast<uint32_t>(g_obj_decimal_result.size());
}

extern "C" void vir_obj_inc(lean::object * value) {
    lean_inc(value);
}

extern "C" void vir_obj_dec(lean::object * value) {
    lean_dec(value);
}
