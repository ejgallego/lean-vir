/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <initializer_list>
#include <limits>
#include <string>

#include "kernel/expr.h"
#include "name_utils.h"
#include "resource_abi.h"
#include "runtime/object.h"

static std::string g_obj_decimal_result;
static std::string g_obj_string_result;

extern "C" lean::object * lean_level_mk_succ(lean::object *);
extern "C" lean::object * lean_level_mk_mvar(lean::object *);
extern "C" lean::object * lean_level_mk_param(lean::object *);
extern "C" lean::object * lean_level_mk_max(lean::object *, lean::object *);
extern "C" lean::object * lean_level_mk_imax(lean::object *, lean::object *);

extern "C" lean::object * lean_expr_mk_bvar(lean::object *);
extern "C" lean::object * lean_expr_mk_fvar(lean::object *);
extern "C" lean::object * lean_expr_mk_mvar(lean::object *);
extern "C" lean::object * lean_expr_mk_sort(lean::object *);
extern "C" lean::object * lean_expr_mk_const(lean::object *, lean::object *);
extern "C" lean::object * lean_expr_mk_app(lean::object *, lean::object *);
extern "C" lean::object * lean_expr_mk_lambda(lean::object *, lean::object *, lean::object *, uint8_t);
extern "C" lean::object * lean_expr_mk_forall(lean::object *, lean::object *, lean::object *, uint8_t);
extern "C" lean::object * lean_expr_mk_let(lean::object *, lean::object *, lean::object *, lean::object *, uint8_t);
extern "C" lean::object * lean_expr_mk_lit(lean::object *);
extern "C" lean::object * lean_expr_mk_proj(lean::object *, lean::object *, lean::object *);
extern "C" uint32_t vir_closure_root(
    lean::object * value,
    uint32_t arity,
    uint8_t is_io);

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

static lean::object * mk_ctor_owned(unsigned tag, std::initializer_list<lean::object *> fields) {
    lean::object * obj = lean_alloc_ctor(tag, fields.size(), 0);
    unsigned idx = 0;
    for (lean::object * field : fields) {
        lean_ctor_set(obj, idx, field);
        idx++;
    }
    return obj;
}

static lean::object * mk_nat_from_decimal(char const * text, uint32_t len) {
    if (!is_decimal(text, len)) {
        return nullptr;
    }
    std::string decimal(text, len);
    lean::mpz value(decimal.c_str());
    return lean::mk_nat_obj(value);
}

static lean::object * mk_name_from_dotted_string(char const * text, uint32_t len) {
    if (text == nullptr && len != 0) {
        return nullptr;
    }
    lean::name name = lean::name_from_dotted(text, len);
    lean_inc(name.raw());
    return name.raw();
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

extern "C" uint32_t vir_obj_array_size(lean::object * value) {
    return static_cast<uint32_t>(lean_array_size(value));
}

extern "C" lean::object * vir_obj_array_get(lean::object * value, uint32_t index) {
    if (index >= lean_array_size(value)) {
        return nullptr;
    }
    return lean_array_uget(value, index);
}

extern "C" lean::object * vir_obj_ctor(uint32_t tag, lean::object ** fields, uint32_t len) {
    if (fields == nullptr && len != 0) {
        return nullptr;
    }
    if (tag > std::numeric_limits<uint8_t>::max()) {
        return nullptr;
    }
    for (uint32_t i = 0; i < len; i++) {
        if (fields[i] == nullptr) {
            return nullptr;
        }
    }
    lean::object * obj = lean_alloc_ctor(static_cast<uint8_t>(tag), len, 0);
    for (uint32_t i = 0; i < len; i++) {
        lean_ctor_set(obj, i, fields[i]);
    }
    return obj;
}

extern "C" lean::object * vir_obj_ctor_layout(
    uint32_t tag,
    lean::object ** object_fields,
    uint32_t object_field_count,
    size_t const * usize_fields,
    uint32_t usize_field_count,
    uint8_t const * scalar_fields,
    uint32_t scalar_byte_size) {
    if (tag > std::numeric_limits<uint8_t>::max()) {
        return nullptr;
    }
    if (object_fields == nullptr && object_field_count != 0) {
        return nullptr;
    }
    if (usize_fields == nullptr && usize_field_count != 0) {
        return nullptr;
    }
    if (scalar_fields == nullptr && scalar_byte_size != 0) {
        return nullptr;
    }
    for (uint32_t i = 0; i < object_field_count; i++) {
        if (object_fields[i] == nullptr) {
            return nullptr;
        }
    }
    if (
        usize_field_count >
            (std::numeric_limits<unsigned>::max() - scalar_byte_size) / sizeof(size_t)) {
        return nullptr;
    }
    unsigned scalar_size = static_cast<unsigned>(usize_field_count * sizeof(size_t) + scalar_byte_size);
    lean::object * obj = lean_alloc_ctor(static_cast<uint8_t>(tag), object_field_count, scalar_size);
    for (uint32_t i = 0; i < object_field_count; i++) {
        lean_ctor_set(obj, i, object_fields[i]);
    }
    for (uint32_t i = 0; i < usize_field_count; i++) {
        lean_ctor_set_usize(obj, object_field_count + i, usize_fields[i]);
    }
    if (scalar_byte_size != 0) {
        memcpy(lean_ctor_scalar_cptr(obj) + usize_field_count * sizeof(size_t), scalar_fields, scalar_byte_size);
    }
    return obj;
}

extern "C" lean::object * vir_obj_list(lean::object ** values, uint32_t len) {
    if (values == nullptr && len != 0) {
        return nullptr;
    }
    for (uint32_t i = 0; i < len; i++) {
        if (values[i] == nullptr) {
            return nullptr;
        }
    }
    lean::object * out = lean_box(0);
    for (uint32_t i = len; i > 0; i--) {
        lean::object * cons = lean_alloc_ctor(1, 2, 0);
        lean_ctor_set(cons, 0, values[i - 1]);
        lean_ctor_set(cons, 1, out);
        out = cons;
    }
    return out;
}

extern "C" uint32_t vir_obj_list_is_nil(lean::object * value) {
    return lean_is_scalar(value) && lean_unbox(value) == 0 ? 1 : 0;
}

extern "C" lean::object * vir_obj_list_head(lean::object * value) {
    if (lean_is_scalar(value) || lean_ctor_num_objs(value) < 2) {
        return nullptr;
    }
    lean::object * head = lean_ctor_get(value, 0);
    lean_inc(head);
    return head;
}

extern "C" lean::object * vir_obj_list_tail(lean::object * value) {
    if (lean_is_scalar(value) || lean_ctor_num_objs(value) < 2) {
        return nullptr;
    }
    lean::object * tail = lean_ctor_get(value, 1);
    lean_inc(tail);
    return tail;
}

extern "C" lean::object * vir_obj_scalar(uint32_t value) {
    return lean_box(value);
}

extern "C" uint32_t vir_obj_is_scalar(lean::object * value) {
    return lean_is_scalar(value) ? 1 : 0;
}

extern "C" uint32_t vir_obj_scalar_value(lean::object * value) {
    return static_cast<uint32_t>(lean_unbox(value));
}

extern "C" uint32_t vir_obj_tag(lean::object * value) {
    return static_cast<uint32_t>(lean_obj_tag(value));
}

extern "C" lean::object * vir_obj_field(lean::object * value, uint32_t index) {
    if (lean_is_scalar(value) || index >= lean_ctor_num_objs(value)) {
        return nullptr;
    }
    lean::object * field = lean_ctor_get(value, index);
    lean_inc(field);
    return field;
}

extern "C" char const * vir_obj_ctor_usize_decimal(lean::object * value, uint32_t index) {
    if (lean_is_scalar(value) || index < lean_ctor_num_objs(value)) {
        return nullptr;
    }
    g_obj_decimal_result = std::to_string(lean_ctor_get_usize(value, index));
    return g_obj_decimal_result.c_str();
}

extern "C" uint8_t const * vir_obj_ctor_scalar_data(lean::object * value, uint32_t usize_field_count) {
    if (lean_is_scalar(value)) {
        return nullptr;
    }
    return lean_ctor_scalar_cptr(value) + usize_field_count * sizeof(size_t);
}

extern "C" lean::object * vir_obj_nat(char const * text, uint32_t len) {
    return mk_nat_from_decimal(text, len);
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

extern "C" lean::object * vir_obj_uint32(uint32_t value) {
    return lean_box_uint32(value);
}

extern "C" uint32_t vir_obj_uint32_value(lean::object * value) {
    return lean_unbox_uint32(value);
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

extern "C" lean::object * vir_obj_float(double value) {
    return lean_box_float(value);
}

extern "C" double vir_obj_float_value(lean::object * value) {
    return lean_unbox_float(value);
}

extern "C" lean::object * vir_obj_float32(float value) {
    return lean_box_float32(value);
}

extern "C" float vir_obj_float32_value(lean::object * value) {
    return lean_unbox_float32(value);
}

extern "C" lean::object * vir_obj_resource(__externref_t value) {
    return lean::vir_resource_object_from_externref(value);
}

extern "C" __externref_t vir_obj_resource_externref(lean::object * value) {
    return lean::vir_resource_externref(value);
}

extern "C" uint32_t vir_obj_closure_root(
    lean::object * value,
    uint32_t arity,
    uint8_t is_io) {
    if (value == nullptr) {
        return 0;
    }
    return vir_closure_root(value, arity, is_io);
}

extern "C" lean::object * vir_obj_level_zero(void) {
    return lean_box(0);
}

extern "C" lean::object * vir_obj_level_succ(lean::object * value) {
    if (value == nullptr) return nullptr;
    return lean_level_mk_succ(value);
}

extern "C" lean::object * vir_obj_level_max(lean::object * lhs, lean::object * rhs) {
    if (lhs == nullptr || rhs == nullptr) return nullptr;
    return lean_level_mk_max(lhs, rhs);
}

extern "C" lean::object * vir_obj_level_imax(lean::object * lhs, lean::object * rhs) {
    if (lhs == nullptr || rhs == nullptr) return nullptr;
    return lean_level_mk_imax(lhs, rhs);
}

extern "C" lean::object * vir_obj_level_param(char const * text, uint32_t len) {
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_level_mk_param(name);
}

extern "C" lean::object * vir_obj_level_mvar(char const * text, uint32_t len) {
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_level_mk_mvar(name);
}

extern "C" lean::object * vir_obj_literal_nat(char const * text, uint32_t len) {
    lean::object * value = mk_nat_from_decimal(text, len);
    if (value == nullptr) return nullptr;
    return mk_ctor_owned(0, { value });
}

extern "C" lean::object * vir_obj_literal_string(char const * text, uint32_t len) {
    return mk_ctor_owned(1, { lean_mk_string_from_bytes(text, len) });
}

extern "C" lean::object * vir_obj_expr_bvar(char const * text, uint32_t len) {
    lean::object * index = mk_nat_from_decimal(text, len);
    if (index == nullptr) return nullptr;
    return lean_expr_mk_bvar(index);
}

extern "C" lean::object * vir_obj_expr_fvar(char const * text, uint32_t len) {
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_expr_mk_fvar(name);
}

extern "C" lean::object * vir_obj_expr_mvar(char const * text, uint32_t len) {
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_expr_mk_mvar(name);
}

extern "C" lean::object * vir_obj_expr_sort(lean::object * level) {
    if (level == nullptr) return nullptr;
    return lean_expr_mk_sort(level);
}

extern "C" lean::object * vir_obj_expr_const(char const * text, uint32_t len, lean::object * levels) {
    if (levels == nullptr) return nullptr;
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_expr_mk_const(name, levels);
}

extern "C" lean::object * vir_obj_expr_app(lean::object * fn, lean::object * arg) {
    if (fn == nullptr || arg == nullptr) return nullptr;
    return lean_expr_mk_app(fn, arg);
}

extern "C" lean::object * vir_obj_expr_lambda(
    char const * text,
    uint32_t len,
    lean::object * type,
    lean::object * body,
    uint8_t binder_info) {
    if (type == nullptr || body == nullptr) return nullptr;
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_expr_mk_lambda(name, type, body, binder_info);
}

extern "C" lean::object * vir_obj_expr_forall(
    char const * text,
    uint32_t len,
    lean::object * type,
    lean::object * body,
    uint8_t binder_info) {
    if (type == nullptr || body == nullptr) return nullptr;
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_expr_mk_forall(name, type, body, binder_info);
}

extern "C" lean::object * vir_obj_expr_let(
    char const * text,
    uint32_t len,
    lean::object * type,
    lean::object * value,
    lean::object * body,
    uint8_t nondep) {
    if (type == nullptr || value == nullptr || body == nullptr) return nullptr;
    lean::object * name = mk_name_from_dotted_string(text, len);
    if (name == nullptr) return nullptr;
    return lean_expr_mk_let(name, type, value, body, nondep);
}

extern "C" lean::object * vir_obj_expr_lit(lean::object * literal) {
    if (literal == nullptr) return nullptr;
    return lean_expr_mk_lit(literal);
}

extern "C" lean::object * vir_obj_expr_proj(
    char const * type_name_text,
    uint32_t type_name_len,
    char const * index_text,
    uint32_t index_len,
    lean::object * structure) {
    if (structure == nullptr) return nullptr;
    lean::object * type_name = mk_name_from_dotted_string(type_name_text, type_name_len);
    lean::object * index = mk_nat_from_decimal(index_text, index_len);
    if (type_name == nullptr || index == nullptr) {
        if (type_name != nullptr) lean_dec(type_name);
        if (index != nullptr) lean_dec(index);
        return nullptr;
    }
    return lean_expr_mk_proj(type_name, index, structure);
}

extern "C" uint8_t vir_obj_expr_scalar_u8(lean::object * value, uint32_t object_fields) {
    if (value == nullptr || lean_is_scalar(value)) return 0;
    if (lean_ctor_num_objs(value) > object_fields) {
        return static_cast<uint8_t>(lean_unbox(lean_ctor_get(value, object_fields)));
    }
    return lean_ctor_get_uint8(value, lean_ctor_num_objs(value) * sizeof(void *) + sizeof(uint64_t));
}

extern "C" char const * vir_obj_name_string(lean::object * value) {
    if (value == nullptr) {
        g_obj_string_result.clear();
    } else {
        g_obj_string_result = lean::name(value, true).to_string();
    }
    return g_obj_string_result.c_str();
}

extern "C" uint32_t vir_obj_name_string_size(void) {
    return static_cast<uint32_t>(g_obj_string_result.size());
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
