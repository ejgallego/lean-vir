/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>

#include <initializer_list>
#include <string>

#include "runtime/name_utils.h"
#include "runtime/object.h"

static std::string g_obj_name_string_result;

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
        g_obj_name_string_result.clear();
    } else {
        g_obj_name_string_result = lean::name(value, true).to_string();
    }
    return g_obj_name_string_result.c_str();
}

extern "C" uint32_t vir_obj_name_string_size(void) {
    return static_cast<uint32_t>(g_obj_name_string_result.size());
}
