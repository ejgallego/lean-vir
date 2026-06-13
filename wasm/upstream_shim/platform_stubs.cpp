/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"

#include <cstdlib>
#include <string>

#include "kernel/trace.h"
#include "library/elab_environment.h"
#include "library/init_attribute.h"
#include "library/time_task.h"
#include "runtime/io.h"
#include "runtime/object.h"
#include "util/name.h"
#include "util/option_declarations.h"
#include "util/options.h"

namespace lean {

static object * mk_option_some_borrowed(object * value) {
    object * result = lean_alloc_ctor(1, 1, 0);
    lean_inc(value);
    lean_ctor_set(result, 0, value);
    return result;
}

static optional<name> find_package_init_name_ref(name const & n) {
    if (object * init_name = vir::find_package_init_name(n.raw())) {
        return optional<name>(name(init_name, true));
    }
    return optional<name>();
}

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

// Option registration is side-effect-only metadata for this build: package
// execution uses default option values and does not expose option declaration
// discovery.
void register_option(name const &, name const &, data_value_kind, char const *, char const *) {}

} // namespace lean

extern "C" lean::object * lean_decl_get_sorry_dep(lean::object *, lean::object *) {
    return lean_box(0);
}

// Keep the upstream interpreter's same-module initializer guard aligned with
// the package initializer table. Returning `none` here lets unreachable init
// globals be evaluated as ordinary constants if the init table misses them.
extern "C" lean::object * lean_get_regular_init_fn_name_for(lean::object *, lean::object * n) {
    if (lean::object * init_name = lean::vir::find_package_init_name(n)) {
        return lean::mk_option_some_borrowed(init_name);
    }
    return lean_box(0);
}

extern "C" lean::object * lean_get_export_name_for(lean::object *, lean::object *) {
    return lean_box(0);
}

extern "C" double lean_float_of_nat(lean_obj_arg a) {
    double result = lean_is_scalar(a) ?
        static_cast<double>(lean_unbox(a)) :
        std::strtod(lean::mpz_value(a).to_string().c_str(), nullptr);
    lean_dec(a);
    return result;
}

extern "C" float lean_float32_of_nat(lean_obj_arg a) {
    float result = lean_is_scalar(a) ?
        static_cast<float>(lean_unbox(a)) :
        std::strtof(lean::mpz_value(a).to_string().c_str(), nullptr);
    lean_dec(a);
    return result;
}

extern "C" lean::obj_res lean_io_eprintln(lean::obj_arg s) {
    lean_dec(s);
    return lean_io_result_mk_ok(lean_box(0));
}

extern "C" void lean_io_result_show_error(lean::b_obj_arg) {}
