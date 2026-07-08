/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"

#include "library/elab_environment.h"
#include "runtime/object.h"
#include "util/name.h"

namespace lean {
namespace {

object * mk_option_some_borrowed(object * value) {
    object * result = lean_alloc_ctor(1, 1, 0);
    lean_inc(value);
    lean_ctor_set(result, 0, value);
    return result;
}

optional<name> find_package_init_name_ref(name const & n) {
    if (object * init_name = vir::find_package_init_name(n.raw())) {
        return optional<name>(name(init_name, true));
    }
    return optional<name>();
}

} // namespace

name const & get_uint32_name() {
    static name * n = nullptr;
    if (!n) {
        n = new name("UInt32");
    }
    return *n;
}

optional<name> get_init_fn_name_for(elab_environment const &, name const & n) {
    return find_package_init_name_ref(n);
}

} // namespace lean

// Keep the upstream interpreter's same-module initializer guard aligned with
// the package initializer table. Returning `none` here lets unreachable init
// globals be evaluated as ordinary constants if the init table misses them.
extern "C" lean::object * lean_get_regular_init_fn_name_for(lean::object *, lean::object * n) {
    if (lean::object * init_name = lean::vir::find_package_init_name(n)) {
        return lean::mk_option_some_borrowed(init_name);
    }
    return lean_box(0);
}

