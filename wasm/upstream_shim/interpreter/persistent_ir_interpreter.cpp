/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "interpreter_bridge.h"

// The upstream interpreter keeps its nullary-value and declaration caches in
// an implementation-private class. Include the pinned implementation unchanged
// so this translation unit can give that class a package-scoped lifetime.
#include "library/ir_interpreter.cpp"

namespace lean::vir {
namespace {

class package_interpreter_session {
    elab_environment m_env;
    options m_opts;
    ir::interpreter m_interpreter;

public:
    package_interpreter_session():
        m_env(lean_box(0)),
        m_opts(lean_box(0)),
        m_interpreter(m_env, m_opts) {}

    object * call(name const & fn, size_t argc, object ** args) {
        if (optional<name> decl_with_sorry = ir::get_sorry_dep(m_env, fn)) {
            throw exception(
                sstream() << "cannot evaluate code because '" << *decl_with_sorry
                          << "' uses 'sorry' and/or contains errors");
        }
        time_task task("interpretation", m_opts, fn);
        scope_trace_env trace_scope(m_env, m_opts);
        flet<ir::interpreter *> interpreter_scope(ir::g_interpreter, &m_interpreter);
        return m_interpreter.call_boxed(fn, argc, args);
    }

    object * apply(object * fn, unsigned argc, object ** args) {
        // Supported package closures capture this session's fixed env/options.
        // Keep the package interpreter active across C/JS callback boundaries.
        if (ir::g_interpreter != nullptr) {
            return apply_n(fn, argc, args);
        }
        flet<ir::interpreter *> interpreter_scope(ir::g_interpreter, &m_interpreter);
        return apply_n(fn, argc, args);
    }

    bool is_active() const { return ir::g_interpreter == &m_interpreter; }

    object * initialize(name const & decl, name const & init) {
        flet<ir::interpreter *> interpreter_scope(ir::g_interpreter, &m_interpreter);
        return m_interpreter.run_init(decl, init);
    }
};

package_interpreter_session * g_package_interpreter = nullptr;
unsigned g_session_depth = 0;
bool g_reset_pending = false;
char const * g_entry_error = nullptr;

bool prepare_entry() {
    g_entry_error = nullptr;
    if (g_reset_pending) {
        g_entry_error = "package interpreter reset is pending";
        return false;
    }
    if (ir::g_interpreter != nullptr &&
        (g_package_interpreter == nullptr || !g_package_interpreter->is_active())) {
        g_entry_error = "foreign active interpreter is unsupported by package execution";
        return false;
    }
    if (g_package_interpreter == nullptr) {
        g_package_interpreter = new package_interpreter_session();
    }
    return true;
}

void release_arguments(size_t argc, object ** args) {
    for (size_t i = 0; i < argc; ++i) lean_dec(args[i]);
}

// A nested failure/reset cannot delete the interpreter underneath an outer
// evaluation. Retire it when the last entry unwinds instead.
struct session_entry {
    session_entry() { ++g_session_depth; }
    ~session_entry() {
        if (--g_session_depth == 0 && g_reset_pending) {
            g_reset_pending = false;
            reset_package_interpreter();
        }
    }
};

} // namespace

object * run_package_interpreter_function(
    object * fn_obj,
    size_t argc,
    object ** args) {
    if (!prepare_entry()) {
        release_arguments(argc, args);
        return nullptr;
    }
    name fn(fn_obj, true);
    session_entry entry;
    try {
        return g_package_interpreter->call(fn, argc, args);
    } catch (...) {
        // A failed evaluation may leave the interpreter's private argument or
        // call stacks partially populated. Do not reuse that session.
        reset_package_interpreter();
        throw;
    }
}

object * apply_package_closure(object * fn, unsigned argc, object ** args) {
    if (!prepare_entry()) {
        lean_dec(fn);
        release_arguments(argc, args);
        return nullptr;
    }
    session_entry entry;
    try {
        return g_package_interpreter->apply(fn, argc, args);
    } catch (...) {
        reset_package_interpreter();
        throw;
    }
}

char const * package_interpreter_entry_error() { return g_entry_error; }

object * run_package_interpreter_initializer(object * decl_obj, object * init_obj) {
    if (!prepare_entry()) {
        return lean_io_result_mk_error(lean_mk_io_user_error(lean_mk_string(g_entry_error)));
    }
    session_entry entry;
    name decl(decl_obj, true);
    name init(init_obj, true);
    try {
        object * result = g_package_interpreter->initialize(decl, init);
        // Upstream run_init catches evaluation exceptions and returns IO error.
        // Failed initialization must not leave a possibly damaged cached session.
        if (!lean_io_result_is_ok(result)) reset_package_interpreter();
        return result;
    } catch (...) {
        reset_package_interpreter();
        throw;
    }
}

void reset_package_interpreter() {
    if (g_session_depth != 0) {
        g_reset_pending = true;
        return;
    }
    delete g_package_interpreter;
    g_package_interpreter = nullptr;
}

} // namespace lean::vir
