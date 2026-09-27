/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Run the same cases against pinned native Lean and the actual Wasm link inputs.
// Printed metadata is pointer-size independent; ownership checks run in both.
#include <lean/lean.h>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>

using O = lean_object;
extern "C" {
O * lean_name_mk_string(O *, O *);
O * lean_name_mk_numeral(O *, O *);
O * lean_level_mk_succ(O *);
O * lean_level_mk_param(O *);
O * lean_level_mk_mvar(O *);
O * lean_level_mk_max(O *, O *);
O * lean_level_mk_imax(O *, O *);
unsigned lean_level_hash(O *);
unsigned lean_level_depth(O *);
uint8_t lean_level_has_mvar(O *);
uint8_t lean_level_has_param(O *);
O * lean_expr_mk_bvar(O *);
O * lean_expr_mk_fvar(O *);
O * lean_expr_mk_mvar(O *);
O * lean_expr_mk_sort(O *);
O * lean_expr_mk_const(O *, O *);
O * lean_expr_mk_app(O *, O *);
O * lean_expr_mk_lambda(O *, O *, O *, uint8_t);
O * lean_expr_mk_forall(O *, O *, O *, uint8_t);
O * lean_expr_mk_let(O *, O *, O *, O *, uint8_t);
O * lean_expr_mk_lit(O *);
O * lean_expr_mk_proj(O *, O *, O *);
uint64_t lean_expr_hash(O *);
uint8_t lean_expr_binder_info(O *);
uint8_t lean_expr_has_fvar(O *);
uint8_t lean_expr_has_expr_mvar(O *);
uint8_t lean_expr_has_level_mvar(O *);
uint8_t lean_expr_has_level_param(O *);
}

static void check(bool ok, char const * label) {
    if (!ok) { fprintf(stderr, "constructor ownership failure: %s\n", label); exit(1); }
}
static O * copy(O * o) { lean_inc(o); return o; }
static void rc(O * o, int expected) { check(lean_internal_get_rc(o) == expected, "reference count"); }
static O * name(char const * s) { return lean_name_mk_string(lean_box(0), lean_mk_string(s)); }
static void report(char const * label, O * o) {
    printf("%s %u %u %016llx\n", label, lean_obj_tag(o), lean_ctor_num_objs(o),
        static_cast<unsigned long long>(lean_ctor_get_uint64(o, lean_ctor_num_objs(o) * sizeof(void *))));
}
template <class F> static void accessor(F f, O * o) {
    f(copy(o));
    rc(o, 1);
}
static void expr(char const * label, O * o) {
    report(label, o);
    accessor(lean_expr_hash, o);
    accessor(lean_expr_has_fvar, o);
    accessor(lean_expr_has_expr_mvar, o);
    accessor(lean_expr_has_level_mvar, o);
    accessor(lean_expr_has_level_param, o);
    if (lean_obj_tag(o) == 6 || lean_obj_tag(o) == 7) {
        printf("binder %u\n", lean_expr_binder_info(copy(o)));
        rc(o, 1);
    }
    if (lean_obj_tag(o) >= 6 && lean_obj_tag(o) <= 8)
        printf("scalar %u\n", lean_ctor_get_uint8(o, lean_ctor_num_objs(o) * sizeof(void *) + 8));
    lean_dec(o);
}
static void level(char const * label, O * o) {
    report(label, o);
    accessor(lean_level_hash, o);
    accessor(lean_level_depth, o);
    accessor(lean_level_has_mvar, o);
    accessor(lean_level_has_param, o);
    lean_dec(o);
}
static O * bvar(unsigned n = 0) { return lean_expr_mk_bvar(lean_box(n)); }
static O * nat_lit(char const * n) {
    O * lit = lean_alloc_ctor(0, 1, 0);
    lean_ctor_set(lit, 0, lean_cstr_to_nat(n));
    return lean_expr_mk_lit(lit);
}

template <class T> static int init_count = 0;
template <class T> static T init_scalar() { ++init_count<T>; return T(37); }
static int object_init_count = 0;
static O * init_object() { ++object_init_count; return lean_mk_string("once"); }

template <class T, class F> static void scalar_once(F cold) {
    lean_once_cell_t tok = LEAN_ONCE_CELL_INITIALIZER;
    T loc = 0;
    int before = init_count<T>;
    check(cold(&loc, &tok, init_scalar<T>) == T(37), "once initial value");
    check(cold(&loc, &tok, init_scalar<T>) == T(37), "once repeated value");
    check(init_count<T> == before + 1 && tok.state == 1, "once scalar initialized once");
}

static void once_providers() {
    scalar_once<uint8_t>(lean_uint8_once_cold);
    scalar_once<uint16_t>(lean_uint16_once_cold);
    scalar_once<uint32_t>(lean_uint32_once_cold);
    scalar_once<uint64_t>(lean_uint64_once_cold);
    scalar_once<size_t>(lean_usize_once_cold);
    scalar_once<float>(lean_float32_once_cold);
    scalar_once<double>(lean_float_once_cold);
    lean_once_cell_t tok = LEAN_ONCE_CELL_INITIALIZER;
    O * loc = nullptr;
    O * value = lean_obj_once(&loc, &tok, init_object);
    check(lean_obj_once(&loc, &tok, init_object) == value, "once object fast path");
    check(lean_obj_once_cold(&loc, &tok, init_object) == value, "once object cold path");
    check(object_init_count == 1 && tok.state == 1, "once object initialized once");
    check(lean_is_persistent(value), "once object persistent");
    puts("once providers: 8 initialized once, object persistent");
}

int main() {
    once_providers();
    O * prefix = name("αβ₁");
    O * suffix = lean_mk_string("child");
    O * child = lean_name_mk_string(copy(prefix), copy(suffix));
    rc(prefix, 2); rc(suffix, 2);
    report("name.string", child);
    lean_dec(child);
    rc(prefix, 1); rc(suffix, 1);
    lean_dec(suffix);
    for (char const * digits : {"0", "18446744073709551615", "18446744073709551616",
            "10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"}) {
        O * n = lean_cstr_to_nat(digits);
        O * named = lean_name_mk_numeral(copy(prefix), copy(n));
        rc(prefix, 2);
        if (!lean_is_scalar(n)) rc(n, 2);
        report("name.numeral", named);
        lean_dec(named);
        rc(prefix, 1);
        if (!lean_is_scalar(n)) rc(n, 1);
        lean_dec(n);
        expr("expr.nat", nat_lit(digits));
    }
    lean_dec(prefix);
    for (char const * id : {"x", "αβ₁"}) {
        expr("fvar", lean_expr_mk_fvar(name(id)));
        expr("mvar", lean_expr_mk_mvar(name(id)));
        level("level.mvar", lean_level_mk_mvar(name(id)));
        level("level.param", lean_level_mk_param(name(id)));
    }
    expr("fvar.anon", lean_expr_mk_fvar(lean_box(0)));
    level("succ", lean_level_mk_succ(lean_box(0)));
    level("max", lean_level_mk_max(lean_level_mk_param(name("u")), lean_level_mk_mvar(name("v"))));
    level("imax", lean_level_mk_imax(lean_level_mk_mvar(name("u")), lean_level_mk_succ(lean_box(0))));
    expr("bvar", bvar()); expr("bvar.max", bvar(1048574));
    expr("sort", lean_expr_mk_sort(lean_level_mk_mvar(name("u"))));
    O * levels = lean_alloc_ctor(1, 2, 0);
    lean_ctor_set(levels, 0, lean_level_mk_param(name("u")));
    lean_ctor_set(levels, 1, lean_box(0));
    expr("const", lean_expr_mk_const(name("C"), levels));
    O * shared = lean_expr_mk_fvar(name("x"));
    O * app = lean_expr_mk_app(copy(shared), bvar(4));
    rc(shared, 2);
    expr("app", app);
    rc(shared, 1); lean_dec(shared);
    for (uint8_t binder = 0; binder < 5; ++binder) {
        expr("lam", lean_expr_mk_lambda(name("x"), bvar(), bvar(4), binder));
        expr("forall", lean_expr_mk_forall(name("x"), bvar(), bvar(4), binder));
    }
    for (uint8_t nondep = 0; nondep < 2; ++nondep)
        expr("let", lean_expr_mk_let(name("x"), bvar(), nat_lit("2"), bvar(4), nondep));
    O * str = lean_alloc_ctor(1, 1, 0);
    lean_ctor_set(str, 0, lean_mk_string("héllo"));
    expr("string", lean_expr_mk_lit(str));
    expr("proj", lean_expr_mk_proj(name("Prod"), lean_cstr_to_nat("18446744073709551616"), bvar(4)));
    puts("constructor metadata and ownership ok");
}
