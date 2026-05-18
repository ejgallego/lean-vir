#include "decl_provider.h"

#include <stddef.h>

#include <initializer_list>

#include "library/ir_types.h"
#include "util/name.h"

namespace lean {
extern "C" obj_res lean_name_mk_string(obj_arg prefix, obj_arg suffix);
}

namespace lean::vir {
namespace {

using ir::type;

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

static object * mk_name_part(object * prefix, char const * part) {
    object * suffix = lean_mk_string(part);
    object * result = lean_name_mk_string(prefix, suffix);
    lean_dec(suffix);
    return result;
}

static object * mk_name1(char const * a) {
    return mk_name_part(lean_box(0), a);
}

static object * mk_name2(char const * a, char const * b) {
    object * n = mk_name1(a);
    object * result = mk_name_part(n, b);
    lean_dec(n);
    return result;
}

static object * mk_nat(size_t n) {
    return lean_usize_to_nat(n);
}

static object * mk_array(std::initializer_list<object *> fields) {
    object * array = lean_alloc_array(fields.size(), fields.size());
    size_t idx = 0;
    for (object * field : fields) {
        lean_inc(field);
        lean_array_set_core(array, idx, field);
        idx++;
    }
    return array;
}

static object * mk_arg_var(size_t var) {
    return mk_ctor(0, { mk_nat(var) });
}

static object * mk_lit_nat(size_t value) {
    object * lit_val = mk_ctor(0, { mk_nat(value) });
    object * expr = mk_ctor(11, { lit_val });
    lean_dec(lit_val);
    return expr;
}

static object * mk_fap(object * fn, object * args) {
    return mk_ctor(6, { fn, args });
}

static object * mk_param(size_t var, type t, bool borrow) {
    object * obj = mk_ctor(0, { mk_nat(var), lean_box(static_cast<unsigned>(t)) }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 2 * sizeof(void *), borrow ? 1 : 0);
    return obj;
}

static object * mk_ctor_info(object * n, size_t tag, size_t size = 0, size_t usize = 0, size_t ssize = 0) {
    return mk_ctor(0, { n, mk_nat(tag), mk_nat(size), mk_nat(usize), mk_nat(ssize) });
}

static object * mk_ctor_alt(object * ctor_info, object * body) {
    return mk_ctor(0, { ctor_info, body });
}

static object * mk_ret(object * arg) {
    return mk_ctor(10, { arg });
}

static object * mk_dec(size_t var, object * cont) {
    object * obj = mk_ctor(7, { mk_nat(var), mk_nat(1), cont }, sizeof(uint8_t));
    lean_ctor_set_uint8(obj, 3 * sizeof(void *), 1);
    return obj;
}

static object * mk_case(object * type_name, size_t var, type var_type, object * alts) {
    return mk_ctor(9, { type_name, mk_nat(var), lean_box(static_cast<unsigned>(var_type)), alts });
}

static object * mk_vdecl(size_t var, type var_type, object * expr, object * cont) {
    return mk_ctor(0, { mk_nat(var), lean_box(static_cast<unsigned>(var_type)), expr, cont });
}

static object * mk_fun_decl(object * fn, object * params, type result_type, object * body) {
    return mk_ctor(0, { fn, params, lean_box(static_cast<unsigned>(result_type)), body });
}

static object * mk_extern_decl(object * fn, object * params, type result_type) {
    return mk_ctor(1, { fn, params, lean_box(static_cast<unsigned>(result_type)) });
}

struct fixture {
    object * name_bool;
    object * name_bool_false;
    object * name_bool_true;
    object * name_fib;
    object * name_fib_boxed;
    object * name_nat_add;
    object * name_nat_dec_eq;
    object * name_nat_sub;
    object * decl_fib;
    object * decl_fib_boxed;
    object * decl_nat_add;
    object * decl_nat_dec_eq;
    object * decl_nat_sub;
};

static fixture * g_fixture = nullptr;

static fixture * get_fixture() {
    if (g_fixture) {
        return g_fixture;
    }

    auto * f = new fixture();

    f->name_bool = mk_name1("Bool");
    f->name_bool_false = mk_name2("Bool", "false");
    f->name_bool_true = mk_name2("Bool", "true");
    f->name_fib = mk_name1("fib");
    f->name_fib_boxed = mk_name2("fib", "_boxed");
    f->name_nat_add = mk_name2("Nat", "add");
    f->name_nat_dec_eq = mk_name2("Nat", "decEq");
    f->name_nat_sub = mk_name2("Nat", "sub");

    object * arg_x1 = mk_arg_var(1);
    object * arg_x2 = mk_arg_var(2);
    object * arg_x4 = mk_arg_var(4);
    object * arg_x5 = mk_arg_var(5);
    object * arg_x7 = mk_arg_var(7);
    object * arg_x8 = mk_arg_var(8);
    object * arg_x9 = mk_arg_var(9);
    object * arg_x10 = mk_arg_var(10);
    object * arg_x11 = mk_arg_var(11);

    object * expr_lit_0 = mk_lit_nat(0);
    object * expr_lit_1 = mk_lit_nat(1);

    object * expr_dec_eq_x1_x2 = mk_fap(f->name_nat_dec_eq, mk_array({ arg_x1, arg_x2 }));
    object * expr_sub_x1_x4 = mk_fap(f->name_nat_sub, mk_array({ arg_x1, arg_x4 }));
    object * expr_dec_eq_x5_x2 = mk_fap(f->name_nat_dec_eq, mk_array({ arg_x5, arg_x2 }));
    object * expr_sub_x5_x4 = mk_fap(f->name_nat_sub, mk_array({ arg_x5, arg_x4 }));
    object * expr_fib_x7 = mk_fap(f->name_fib, mk_array({ arg_x7 }));
    object * expr_add_x7_x4 = mk_fap(f->name_nat_add, mk_array({ arg_x7, arg_x4 }));
    object * expr_fib_x9 = mk_fap(f->name_fib, mk_array({ arg_x9 }));
    object * expr_add_x8_x10 = mk_fap(f->name_nat_add, mk_array({ arg_x8, arg_x10 }));

    object * body_ret_x2 = mk_ret(arg_x2);
    object * body_ret_x4 = mk_ret(arg_x4);
    object * body_ret_x11 = mk_ret(arg_x11);
    object * body_dec_x8 = mk_dec(8, body_ret_x11);
    object * body_dec_x10 = mk_dec(10, body_dec_x8);
    object * body_let_x11 = mk_vdecl(11, type::TObject, expr_add_x8_x10, body_dec_x10);
    object * body_dec_x9 = mk_dec(9, body_let_x11);
    object * body_let_x10 = mk_vdecl(10, type::TObject, expr_fib_x9, body_dec_x9);
    object * body_let_x9 = mk_vdecl(9, type::TObject, expr_add_x7_x4, body_let_x10);
    object * body_dec_x7 = mk_dec(7, body_let_x9);
    object * body_let_x8 = mk_vdecl(8, type::TObject, expr_fib_x7, body_dec_x7);
    object * body_dec_x5_false = mk_dec(5, body_let_x8);
    object * body_let_x7 = mk_vdecl(7, type::TObject, expr_sub_x5_x4, body_dec_x5_false);
    object * body_dec_x5_true = mk_dec(5, body_ret_x4);

    object * ctor_false = mk_ctor_info(f->name_bool_false, 0);
    object * ctor_true = mk_ctor_info(f->name_bool_true, 1);
    object * alts_case_x6 = mk_array({
        mk_ctor_alt(ctor_true, body_dec_x5_true),
        mk_ctor_alt(ctor_false, body_let_x7),
    });

    object * body_case_x6 = mk_case(f->name_bool, 6, type::UInt8, alts_case_x6);
    object * body_let_x6 = mk_vdecl(6, type::UInt8, expr_dec_eq_x5_x2, body_case_x6);
    object * body_let_x5 = mk_vdecl(5, type::TObject, expr_sub_x1_x4, body_let_x6);
    object * body_let_x4 = mk_vdecl(4, type::Tagged, expr_lit_1, body_let_x5);

    object * alts_case_x3 = mk_array({
        mk_ctor_alt(ctor_true, body_ret_x2),
        mk_ctor_alt(ctor_false, body_let_x4),
    });
    object * body_case_x3 = mk_case(f->name_bool, 3, type::UInt8, alts_case_x3);
    object * body_let_x3 = mk_vdecl(3, type::UInt8, expr_dec_eq_x1_x2, body_case_x3);
    object * body_let_x2 = mk_vdecl(2, type::Tagged, expr_lit_0, body_let_x3);

    object * fib_params = mk_array({
        mk_param(1, type::TObject, true),
    });
    f->decl_fib = mk_fun_decl(f->name_fib, fib_params, type::TObject, body_let_x2);

    object * expr_boxed_call = mk_fap(f->name_fib, mk_array({ arg_x1 }));
    object * boxed_ret_x2 = mk_ret(arg_x2);
    object * boxed_dec_x1 = mk_dec(1, boxed_ret_x2);
    object * boxed_body = mk_vdecl(2, type::TObject, expr_boxed_call, boxed_dec_x1);
    object * boxed_params = mk_array({
        mk_param(1, type::TObject, false),
    });
    f->decl_fib_boxed = mk_fun_decl(f->name_fib_boxed, boxed_params, type::TObject, boxed_body);

    object * nat_binary_params = mk_array({
        mk_param(1, type::TObject, true),
        mk_param(2, type::TObject, true),
    });
    f->decl_nat_add = mk_extern_decl(f->name_nat_add, nat_binary_params, type::TObject);
    f->decl_nat_sub = mk_extern_decl(f->name_nat_sub, nat_binary_params, type::TObject);
    f->decl_nat_dec_eq = mk_extern_decl(f->name_nat_dec_eq, nat_binary_params, type::UInt8);

    g_fixture = f;
    return f;
}

} // namespace

object * find_static_decl(object * n) {
    fixture * f = get_fixture();
    if (lean_name_eq(n, f->name_fib)) {
        return f->decl_fib;
    }
    if (lean_name_eq(n, f->name_fib_boxed)) {
        return f->decl_fib_boxed;
    }
    if (lean_name_eq(n, f->name_nat_add)) {
        return f->decl_nat_add;
    }
    if (lean_name_eq(n, f->name_nat_dec_eq)) {
        return f->decl_nat_dec_eq;
    }
    if (lean_name_eq(n, f->name_nat_sub)) {
        return f->decl_nat_sub;
    }
    return nullptr;
}

object * find_static_boxed_decl(object * n) {
    fixture * f = get_fixture();
    if (lean_name_eq(n, f->name_fib)) {
        return f->decl_fib_boxed;
    }
    return nullptr;
}

uint32_t static_decl_count() {
    (void)get_fixture();
    return 5;
}

} // namespace lean::vir
