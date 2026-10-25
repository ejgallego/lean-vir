/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>

#include <string>

#include "kernel/trace.h"
#include "library/elab_environment.h"
#include "library/init_attribute.h"
#include "library/time_task.h"
#include "runtime/exception.h"
#include "runtime/object.h"
#include "util/name.h"
#include "util/option_declarations.h"
#include "util/options.h"

// wasm-ld bounds of the linear-memory shadow stack, which grows down.
extern "C" unsigned char __stack_low;
extern "C" unsigned char __stack_high;

namespace lean {

// Exhausting the shadow stack would otherwise surface as an anonymous
// out-of-bounds trap. Keep enough headroom below each checkpoint for the
// callees that run until the next one, and for raising the exception itself.
void check_system(char const * component_name, bool) {
    uintptr_t low = reinterpret_cast<uintptr_t>(&__stack_low);
    uintptr_t high = reinterpret_cast<uintptr_t>(&__stack_high);
    uintptr_t reserve = (high - low) / 4;
    if (reserve > 64 * 1024) reserve = 64 * 1024;
    uintptr_t current = reinterpret_cast<uintptr_t>(__builtin_frame_address(0));
    if (current < low + reserve) {
        // Not stack_space_exception: its text recommends native `lean` flags.
        throw throwable(std::string("deep recursion was detected at '") +
                        (component_name != nullptr ? component_name : "lean") + "': the " +
                        std::to_string((high - low) / 1024) + " KiB Wasm stack is nearly exhausted");
    }
}

// Heartbeat, cancellation and tracing hooks are intentionally inert in this
// single threaded build. They should become real WASI/runtime integrations
// before exposing cancellation, heartbeat, or trace-sensitive workloads.
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

