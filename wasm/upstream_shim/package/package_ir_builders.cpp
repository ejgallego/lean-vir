/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package_ir_builders.h"

#include <initializer_list>

namespace lean {
extern "C" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix);
extern "C" obj_res lean_name_mk_numeral(obj_arg prefix, obj_arg suffix);
}

namespace lean::vir::package_ir {
namespace {

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

static object * mk_nat(size_t n) {
    return lean_usize_to_nat(n);
}

}

object * mk_name_str(object * prefix, std::string const & part) {
    object * suffix = lean_mk_string(part.c_str());
    object * result = lean_name_mk_string(prefix, suffix);
    lean_dec(prefix);
    lean_dec(suffix);
    return result;
}

object * mk_name_num(object * prefix, size_t value) {
    object * suffix = mk_nat(value);
    object * result = lean_name_mk_numeral(prefix, suffix);
    lean_dec(prefix);
    lean_dec(suffix);
    return result;
}

object * mk_array(std::vector<object *> const & fields) {
    object * array = lean_alloc_array(fields.size(), fields.size());
    size_t idx = 0;
    for (object * field : fields) {
        lean_inc(field);
        lean_array_set_core(array, idx, field);
        idx++;
    }
    return array;
}

object * mk_arg_var(size_t var) {
    return mk_ctor(0, { mk_nat(var) });
}

object * mk_arg_erased() {
    return lean_box(1);
}

object * mk_lit_num(object * value) {
    object * lit_val = mk_ctor(0, { value });
    lean_dec(value);
    object * expr = mk_ctor(11, { lit_val });
    lean_dec(lit_val);
    return expr;
}

object * mk_lit_num(size_t value) {
    return mk_lit_num(mk_nat(value));
}

object * mk_lit_str(std::string const & value) {
    object * str = lean_mk_string(value.c_str());
    object * lit_val = mk_ctor(1, { str });
    lean_dec(str);
    object * expr = mk_ctor(11, { lit_val });
    lean_dec(lit_val);
    return expr;
}

object * mk_ctor_info(object * n, size_t tag, size_t size, size_t usize, size_t ssize) {
    return mk_ctor(0, { n, mk_nat(tag), mk_nat(size), mk_nat(usize), mk_nat(ssize) });
}

object * mk_ctor_expr(object * ctor_info, object * args) {
    return mk_ctor(0, { ctor_info, args });
}

object * mk_reset(size_t n, size_t var) {
    return mk_ctor(1, { mk_nat(n), mk_nat(var) });
}

object * mk_reuse(size_t var, object * ctor_info, bool update_header, object * args) {
    object * obj = mk_ctor(2, { mk_nat(var), ctor_info, args }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), update_header ? 1 : 0);
    return obj;
}

object * mk_proj(size_t idx, size_t var) {
    return mk_ctor(3, { mk_nat(idx), mk_nat(var) });
}

object * mk_uproj(size_t idx, size_t var) {
    return mk_ctor(4, { mk_nat(idx), mk_nat(var) });
}

object * mk_sproj(size_t idx, size_t offset, size_t var) {
    return mk_ctor(5, { mk_nat(idx), mk_nat(offset), mk_nat(var) });
}

object * mk_fap(object * fn, object * args) {
    return mk_ctor(6, { fn, args });
}

object * mk_pap(object * fn, object * args) {
    return mk_ctor(7, { fn, args });
}

object * mk_ap(size_t var, object * args) {
    return mk_ctor(8, { mk_nat(var), args });
}

object * mk_box(type t, size_t var) {
    return mk_ctor(9, { lean_box(static_cast<unsigned>(t)), mk_nat(var) });
}

object * mk_unbox(size_t var) {
    return mk_ctor(10, { mk_nat(var) });
}

object * mk_is_shared(size_t var) {
    return mk_ctor(12, { mk_nat(var) });
}

object * mk_param(size_t var, type t, bool borrow) {
    object * obj = mk_ctor(0, { mk_nat(var), lean_box(static_cast<unsigned>(t)) }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 2 * sizeof(void *), borrow ? 1 : 0);
    return obj;
}

object * mk_ctor_alt(object * ctor_info, object * body) {
    return mk_ctor(0, { ctor_info, body });
}

object * mk_default_alt(object * body) {
    return mk_ctor(1, { body });
}

object * mk_vdecl(size_t var, type var_type, object * expr, object * cont) {
    return mk_ctor(0, { mk_nat(var), lean_box(static_cast<unsigned>(var_type)), expr, cont });
}

object * mk_jdecl(size_t jp, object * params, object * body, object * cont) {
    return mk_ctor(1, { mk_nat(jp), params, body, cont });
}

object * mk_set(size_t target, size_t idx, object * arg, object * cont) {
    return mk_ctor(2, { mk_nat(target), mk_nat(idx), arg, cont });
}

object * mk_set_tag(size_t target, size_t tag, object * cont) {
    return mk_ctor(3, { mk_nat(target), mk_nat(tag), cont });
}

object * mk_uset(size_t target, size_t idx, size_t source, object * cont) {
    return mk_ctor(4, { mk_nat(target), mk_nat(idx), mk_nat(source), cont });
}

object * mk_sset(size_t target, size_t idx, size_t offset, size_t source, type t, object * cont) {
    return mk_ctor(5, { mk_nat(target), mk_nat(idx), mk_nat(offset), mk_nat(source), lean_box(static_cast<unsigned>(t)), cont });
}

object * mk_inc(size_t var, size_t amount, bool maybe_scalar, object * cont) {
    object * obj = mk_ctor(6, { mk_nat(var), mk_nat(amount), cont }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), maybe_scalar ? 1 : 0);
    return obj;
}

object * mk_dec(size_t var, size_t amount, bool maybe_scalar, object * cont) {
    object * obj = mk_ctor(7, { mk_nat(var), mk_nat(amount), cont }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), maybe_scalar ? 1 : 0);
    return obj;
}

object * mk_del(size_t var, object * cont) {
    return mk_ctor(8, { mk_nat(var), cont });
}

object * mk_case(object * type_name, size_t var, type var_type, object * alts) {
    return mk_ctor(9, { type_name, mk_nat(var), lean_box(static_cast<unsigned>(var_type)), alts });
}

object * mk_ret(object * arg) {
    return mk_ctor(10, { arg });
}

object * mk_jmp(size_t jp, object * args) {
    return mk_ctor(11, { mk_nat(jp), args });
}

object * mk_unreachable() {
    return lean_box(12);
}

object * mk_fun_decl(object * fn, object * params, type result_type, object * body) {
    return mk_ctor(0, { fn, params, lean_box(static_cast<unsigned>(result_type)), body });
}

object * mk_extern_decl(object * fn, object * params, type result_type) {
    return mk_ctor(1, { fn, params, lean_box(static_cast<unsigned>(result_type)), lean_box(0) });
}

}
