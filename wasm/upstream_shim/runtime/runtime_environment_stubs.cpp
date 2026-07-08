/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <string>

#include "kernel/trace.h"
#include "library/elab_environment.h"
#include "library/init_attribute.h"
#include "library/time_task.h"
#include "runtime/object.h"
#include "util/name.h"
#include "util/option_declarations.h"
#include "util/options.h"

namespace lean {

// Runtime-budget and tracing hooks are intentionally inert in this single
// threaded demo build. They should become real WASI/runtime integrations before
// exposing cancellation, heartbeat, or trace-sensitive workloads.
void check_system(char const *, bool) {}

void reset_heartbeat() {}

void save_stack_info(bool) {}

void notify_assertion_violation(char const *, int, char const *) {
    __builtin_trap();
}

bool options::get_bool(name const &, bool default_value) const {
    return default_value;
}

time_task::time_task(std::string const & category, options const &, name):
    m_category(category),
    m_timeit(),
    m_parent_task(nullptr) {
}

time_task::~time_task() {}

scope_trace_env::scope_trace_env(elab_environment const &, options const &):
    m_old_opts(nullptr) {
}

scope_trace_env::~scope_trace_env() {}

environment elab_environment::to_kernel_env() const {
    lean_inc(raw());
    return environment(raw());
}

// Option registration is side-effect-only metadata for this build: package
// execution uses default option values and does not expose option declaration
// discovery.
void register_option(name const &, name const &, data_value_kind, char const *, char const *) {}

} // namespace lean

extern "C" lean::object * lean_decl_get_sorry_dep(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" lean::object * lean_get_export_name_for(lean::object *, lean::object *) {
    return lean_box(0);
}

