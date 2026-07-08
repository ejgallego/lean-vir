/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>

#include <algorithm>
#include <initializer_list>

#include "kernel/expr.h"
#include "runtime/object.h"
#include "util/name.h"

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

static void set_name_hash(object * name, uint64_t hash) {
    lean_ctor_set_uint64(name, NAME_HASH_OFFSET, hash);
}

} // namespace

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


} // namespace lean
