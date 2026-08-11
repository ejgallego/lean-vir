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
};

package_interpreter_session * g_package_interpreter = nullptr;

} // namespace

object * run_package_interpreter_function(
    object * fn_obj,
    size_t argc,
    object ** args) {
    if (g_package_interpreter == nullptr) {
        g_package_interpreter = new package_interpreter_session();
    }
    name fn(fn_obj, true);
    try {
        return g_package_interpreter->call(fn, argc, args);
    } catch (...) {
        // A failed evaluation may leave the interpreter's private argument or
        // call stacks partially populated. Do not reuse that session.
        reset_package_interpreter();
        throw;
    }
}

void reset_package_interpreter() {
    delete g_package_interpreter;
    g_package_interpreter = nullptr;
}

} // namespace lean::vir
