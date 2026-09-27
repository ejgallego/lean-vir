/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "package_ir_builders.h"

#include <stdio.h>

namespace {

bool has_erased_none_field(lean::object * decl, size_t field, char const * label) {
    lean::object * value = lean_ctor_get(decl, field);
    if (!lean_is_scalar(value) || lean_unbox(value) != 0) {
        fprintf(stderr, "%s must be represented directly by its one erased field\n", label);
        return false;
    }
    return true;
}

} // namespace

int main() {
    using lean::ir::type;
    using namespace lean::vir::package_ir;

    // Builders consume their prefix. Keep one caller reference to verify
    // the generated Name provider owns exactly the transferred reference.
    lean::object * prefix = mk_name_str(lean_box(0), "Prefix");
    lean_inc(prefix);
    lean::object * named = mk_name_str(prefix, "suffix");
    bool names_ok = lean_internal_get_rc(prefix) == 2;
    lean_dec(named);
    names_ok = names_ok && lean_internal_get_rc(prefix) == 1;
    lean_inc(prefix);
    named = mk_name_num(prefix, 42);
    names_ok = names_ok && lean_internal_get_rc(prefix) == 2;
    lean_dec(named);
    names_ok = names_ok && lean_internal_get_rc(prefix) == 1;
    lean_dec(prefix);
    if (!names_ok) {
        fputs("Name builders must transfer child ownership exactly once\n", stderr);
        return 1;
    }

    lean::object * fdecl = mk_fun_decl(
        lean_box(0),
        lean_alloc_array(0, 0),
        type::Object,
        mk_unreachable());
    bool ok = has_erased_none_field(fdecl, 4, "DeclInfo.sorryDep?");
    lean_dec(fdecl);

    lean::object * extern_decl = mk_extern_decl(
        lean_box(0),
        lean_alloc_array(0, 0),
        type::Object);
    ok = has_erased_none_field(extern_decl, 3, "ExternAttrData.entries") && ok;
    lean_dec(extern_decl);

    if (!ok) {
        return 1;
    }
    puts("package IR one-field structure layout ok");
    return 0;
}
