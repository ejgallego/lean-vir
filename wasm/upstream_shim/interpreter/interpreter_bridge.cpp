/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "interpreter_bridge.h"

#include "package/decl_provider.h"
#include "runtime/name_utils.h"

#include <stddef.h>
#include <stdint.h>

#include "library/elab_environment.h"
#include "library/ir_interpreter.h"
#include "runtime/object.h"

extern "C" {
extern lean_object * l_ByteArray_empty;
}

namespace lean {
namespace {

object * mk_some_borrowed(object * value) {
    object * obj = lean_alloc_ctor(1, 1, 0);
    lean_inc(value);
    lean_ctor_set(obj, 0, value);
    return obj;
}

} // namespace

namespace vir {

void ensure_ir_interpreter_initialized() {
    static bool initialized = false;
    if (!initialized) {
        initialize_ir_interpreter();
        l_ByteArray_empty = lean_mk_empty_byte_array(lean_box(0));
        lean_mark_persistent(l_ByteArray_empty);
        initialized = true;
    }
}

static object * run_interpreter_function(name const & fn, size_t argc, object ** args) {
    ensure_ir_interpreter_initialized();
    elab_environment env(lean_box(0));
    options opts(lean_box(0));
    return ir::run_boxed(env, opts, fn, argc, args);
}

object * run_interpreter_function(object * fn_obj, size_t argc, object ** args) {
    name fn(fn_obj, true);
    return run_interpreter_function(fn, argc, args);
}

} // namespace vir
} // namespace lean

extern "C" void vir_ensure_ir_interpreter_initialized(void) {
    lean::vir::ensure_ir_interpreter_initialized();
}

extern "C" lean::object * lean_ir_find_env_decl(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_decl(n)) {
        return lean::mk_some_borrowed(decl);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_ir_find_env_decl_boxed(lean::object *, lean::object * n) {
    if (lean::object * decl = lean::vir::find_package_boxed_decl(n)) {
        return lean::mk_some_borrowed(decl);
    }
    return lean_box(0);
}

extern "C" uint32_t vir_upstream_target_pointer_bytes(void) {
    return sizeof(void *);
}
